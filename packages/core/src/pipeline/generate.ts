import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { prisma, Prisma, type VideoStatus } from "../lib/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { AppError, BudgetExceededError, errorMessage, isRetryable } from "../lib/errors";
import { getSetting } from "../lib/settings";
import { storage, contentTypeFor } from "../storage";
import { assertCanSpend } from "../budget/budget";
import { estimateVideoCost } from "../budget/pricing";
import { generateScript, pickIdea } from "../content/engine";
import { resolveSceneMedia, pickMusic } from "../media/resolve";
import { synthesizeNarration } from "../tts/google";
import { renderVideo } from "../video/render";
import { ffmpeg } from "../video/ffmpeg";
import { runQualityCheck } from "../qc/quality";
import { notify } from "../notifications/notify";
import { generationLimits } from "./limits";
import { createPublishJobs } from "./publishing";
import { queue, QUEUE, GENERATE_JOB_OPTIONS } from "../queue/queues";
import { audit } from "../lib/audit";
import { reportProgress, type ProgressStage } from "./progress";

/** Yeni video kaydı oluşturur ve üretim kuyruğuna ekler. Limit ve bütçe önceden kontrol edilir. */
async function synthesizeSoundDesign(workDir: string, durationSec: number): Promise<string> {
  const out = path.join(workDir, "sound-design.wav");
  const duration = Math.max(10, Math.ceil(durationSec));
  const tail = Math.max(1, duration - 1);
  await ffmpeg(["-y", "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.018:duration=" + duration, "-f", "lavfi", "-i", "aevalsrc=0.12*sin(2*PI*110*t)*lt(mod(t\\,7)\\,0.16):s=48000:d=" + duration, "-filter_complex", "[0:a]lowpass=f=480,volume=0.28[amb];[1:a]lowpass=f=900,volume=0.55[hit];[amb][hit]amix=inputs=2:duration=longest:normalize=0,afade=t=out:st=" + tail + ":d=1[out]", "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", out], 120);
  return out;
}
export async function enqueueGeneration(brandId: string, opts: { scheduleSlot?: Date | null; trigger: "auto" | "manual"; userId?: string | null; scriptId?: string | null; productionOptions?: { minSeconds?: number; maxSeconds?: number; language?: string; subtitles?: boolean; soundDesign?: boolean }; publishOptions?: { platforms?: string[]; scheduledAt?: string } }) {
  const limits = await generationLimits(brandId);
  if (!limits.allowed) {
    if (opts.trigger === "auto" && /günlük limiti/.test(limits.reason ?? "")) {
      await notify({ type: "DAILY_TARGET_REACHED", severity: "INFO", brandId, title: "Günlük hedef tamamlandı", message: limits.reason!, dedupeKey: `daily-target:${brandId}:${new Date().toISOString().slice(0, 10)}` });
    }
    throw new AppError(limits.reason ?? "Üretim limiti", "LIMIT_REACHED", 429, limits);
  }
  await assertCanSpend(brandId, estimateVideoCost(), "video.generate");
  let video;
  try {
    video = await prisma.video.create({ data: { brandId, scheduleSlot: opts.scheduleSlot ?? null, trigger: opts.trigger, scriptId: opts.scriptId ?? null, status: "QUEUED", mediaManifest: { production: opts.productionOptions ?? {}, publish: opts.publishOptions ?? {} } } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("Bu zaman dilimi için video zaten oluşturulmuş", "DUPLICATE_SLOT", 409);
    }
    throw err;
  }
  await reportProgress(video.id, "QUEUED", 0, "Kuyruğa alındı");
  await queue(QUEUE.generate).add("generate", { videoId: video.id }, { ...GENERATE_JOB_OPTIONS, jobId: `gen-${video.id}` });
  await audit({ action: "video.enqueue", userId: opts.userId, brandId, entity: "Video", entityId: video.id, metadata: { trigger: opts.trigger } });
  return video;
}

const STAGE_START: Record<string, string> = {
  SCRIPTING: "Konu seçiliyor",
  FETCHING_MEDIA: "Sahne görselleri hazırlanıyor",
  VOICING: "Google TTS ile seslendirme",
  RENDERING: "Montaja başlanıyor",
  QUALITY_CHECK: "Kalite kontrol yapılıyor",
};

async function setStatus(videoId: string, status: VideoStatus, extra: Prisma.VideoUpdateInput = {}) {
  await prisma.video.update({ where: { id: videoId }, data: { status, ...extra } });
  if (status in STAGE_START) await reportProgress(videoId, status as ProgressStage, 0, STAGE_START[status]);
  logger.info({ videoId, status }, "video durumu");
}

/**
 * Tam üretim hattı: konu → senaryo → medya → seslendirme → montaj → kalite kontrol → yayın işleri.
 * Geçici dosyalar her durumda temizlenir.
 */
export async function generateVideo(videoId: string, attemptsMade = 0) {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId }, include: { brand: true } });
  if (["READY", "PUBLISHED", "PUBLISHING", "PARTIALLY_PUBLISHED", "CANCELLED"].includes(video.status)) {
    logger.info({ videoId, status: video.status }, "video zaten işlenmiş, atlanıyor");
    return video;
  }
  const brand = video.brand;
  const manifestOptions = (video.mediaManifest ?? {}) as any;
  const productionOptions = manifestOptions.production ?? {};
  const publishOptions = manifestOptions.publish ?? {};
  const workDir = path.join(env().WORK_DIR, videoId);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    // 1-2) Konu + senaryo
    await setStatus(videoId, "SCRIPTING");
    let script = video.scriptId ? await prisma.videoScript.findUnique({ where: { id: video.scriptId } }) : null;
    if (!script) {
      const idea = await pickIdea(brand.id);
      await reportProgress(videoId, "SCRIPTING", 0.4, "Senaryo yazılıyor");
      script = await generateScript(brand.id, idea.id, videoId, productionOptions);
      await prisma.video.update({ where: { id: videoId }, data: { scriptId: script.id, title: script.title } });
    }
    const scenes = script.scenes as unknown as { duration: number; visual_description: string; search_keywords?: string[]; subtitle: string; label?: string; scene_3d?: unknown }[];
    const template = brand.videoTemplate;

    // 3) Medya
    await setStatus(videoId, "FETCHING_MEDIA", { title: script.title });
    const resolved = await resolveSceneMedia({ brandId: brand.id, videoId, scenes, workDir, template, primaryColor: brand.primaryColor, onProgress: (done, total) => reportProgress(videoId, "FETCHING_MEDIA", done / total, `Sahne ${done}/${total}`) });

    // 4) Seslendirme
    await setStatus(videoId, "VOICING");
    const tts = await synthesizeNarration({
      text: script.narration,
      voice: { voiceName: brand.voiceName, gender: brand.voiceGender === "MALE" ? "MALE" : "FEMALE", speakingRate: brand.speakingRate, pitch: brand.voicePitch, languageCode: brand.language },
      workDir,
      brandId: brand.id,
      videoId,
      minDurationSec: productionOptions.minSeconds ?? brand.minDurationSec,
      maxDurationSec: productionOptions.maxSeconds ?? brand.maxDurationSec,
    });

    // 5) Montaj
    await setStatus(videoId, "RENDERING");
    let logoPath: string | null = null;
    if (brand.logoAssetId) {
      const logo = await prisma.mediaAsset.findUnique({ where: { id: brand.logoAssetId } });
      if (logo?.storageKey) {
        logoPath = path.join(workDir, `logo${path.extname(logo.storageKey) || ".png"}`);
        await storage().getToFile(logo.storageKey, logoPath).catch(() => (logoPath = null));
      }
    }
    const music = brand.musicEnabled ? await pickMusic(brand.id, workDir).catch(() => null) : null;
    const shorts = template === "shorts3d" ? await shortsOptions(brand, videoId, script.raw, scenes) : undefined;
    await reportProgress(videoId, "RENDERING", 0.02, "Müzik ve ses tasarımı");
    const designedTrack = productionOptions.soundDesign === false ? null : await synthesizeSoundDesign(workDir, tts.durationSec);
    let backgroundTrack = music?.file ?? null;
    if (designedTrack && backgroundTrack) { const mixed = path.join(workDir, "background-mix.mp3"); await ffmpeg(["-y", "-i", backgroundTrack, "-i", designedTrack, "-t", String(Math.max(10, tts.durationSec)), "-filter_complex", "[0:a]volume=0.42[music];[1:a]volume=0.72[design];[music][design]amix=inputs=2:duration=shortest:normalize=0[out]", "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "4", mixed], 120); backgroundTrack = mixed; }
    else if (designedTrack) backgroundTrack = designedTrack;
    const render = await renderVideo({
      workDir,
      scenes: resolved.map((r, i) => ({ ...r, durationSec: scenes[i].duration, visualDescription: scenes[i].visual_description, scene3d: scenes[i].scene_3d, subtitle: productionOptions.subtitles === false ? "" : scenes[i].subtitle })),
      voicePath: tts.mp3Path,
      voiceDurationSec: tts.durationSec,
      words: tts.words,
      musicPath: backgroundTrack,
      musicVolume: brand.musicVolume,
      logoPath,
      brand: { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor, accentColor: brand.accentColor, font: brand.fontFamily },
      title: script.hook.length <= 40 ? script.hook : script.title,
      cta: script.cta,
      minDurationSec: productionOptions.minSeconds ?? brand.minDurationSec,
      maxDurationSec: productionOptions.maxSeconds ?? brand.maxDurationSec,
      template,
      shorts,
      onProgress: (fraction, detail) => reportProgress(videoId, "RENDERING", 0.05 + fraction * 0.95, detail),
    });

    // 6) Kalite kontrol
    await setStatus(videoId, "QUALITY_CHECK");
    const manifest = {
      scenes: resolved.map((r) => ({ index: r.index, provider: r.provider, kind: r.kind, assetId: r.assetId, license: r.license, licenseUrl: r.licenseUrl, sourceUrl: r.sourceUrl, attribution: r.attribution, commercialUse: r.commercialUse })),
      music: music ? { assetId: music.asset.id, license: music.asset.license, commercialUse: music.asset.commercialUse, attribution: music.asset.attribution } : null,
      voice: { provider: "google_tts", voice: tts.voice, speakingRate: tts.speakingRate, timing: tts.timingSource, durationSec: tts.durationSec },
      containsAiImagery: resolved.some((r) => r.provider === "openai"),
      captions: render.captions.length,
    };
    const qc = await runQualityCheck({
      filePath: render.outputPath,
      minDurationSec: productionOptions.minSeconds ?? brand.minDurationSec,
      maxDurationSec: productionOptions.maxSeconds ?? brand.maxDurationSec,
      maxSizeMb: Number(await getSetting("video.maxSizeMb")),
      captionsCount: render.captions.length,
      media: manifest.scenes,
      contentBlocking: script.status === "REJECTED" ? ["senaryo reddedildi"] : [],
      musicLicensed: music ? music.asset.commercialUse : null,
    });

    // Depolama
    await reportProgress(videoId, "QUALITY_CHECK", 0.6, "Video depolamaya yükleniyor");
    const key = `videos/${brand.id}/${videoId}.mp4`;
    const thumbKey = `videos/${brand.id}/${videoId}.jpg`;
    const up = await storage().putFile(key, render.outputPath, "video/mp4");
    await storage().putFile(thumbKey, render.thumbnailPath, contentTypeFor(render.thumbnailPath));

    const updated = await prisma.video.update({
      where: { id: videoId },
      data: {
        status: qc.passed ? "READY" : "QC_FAILED",
        storageKey: key,
        thumbnailKey: thumbKey,
        durationSec: qc.metrics.durationSec,
        width: qc.metrics.width,
        height: qc.metrics.height,
        fps: qc.metrics.fps,
        sizeBytes: BigInt(up.sizeBytes),
        qcPassed: qc.passed,
        qcReport: qc as any,
        mediaManifest: manifest as any,
        completedAt: new Date(),
        errorMessage: qc.passed ? null : "Kalite kontrolü başarısız: " + qc.checks.filter((c) => !c.passed && c.severity === "error").map((c) => c.label).join(", "),
      },
    });
    if (script.ideaId) await prisma.contentIdea.update({ where: { id: script.ideaId }, data: { status: "USED" } }).catch(() => undefined);

    if (!qc.passed) {
      await notify({ type: "VIDEO_FAILED", severity: "ERROR", brandId: brand.id, title: "Video kalite kontrolünden geçemedi", message: `${script.title}: ${updated.errorMessage}. Video yayın kuyruğuna alınmadı.`, data: { videoId } });
      return updated;
    }

    await notify({ type: "VIDEO_GENERATED", severity: "SUCCESS", brandId: brand.id, title: "Video üretildi", message: `${script.title} (${qc.metrics.durationSec?.toFixed(1)} sn, $${Number(updated.costUsd).toFixed(4)})`, data: { videoId } });

    // 7) Yayın işleri
    if (publishOptions.platforms?.length) await createPublishJobs(videoId, { platforms: publishOptions.platforms as any, scheduledAt: publishOptions.scheduledAt ? new Date(publishOptions.scheduledAt) : undefined });
    else if (brand.autoPublish) await createPublishJobs(videoId);

    const limits = await generationLimits(brand.id);
    if (limits.brandToday >= limits.brandDailyLimit) {
      await notify({ type: "DAILY_TARGET_REACHED", severity: "SUCCESS", brandId: brand.id, title: "Günlük hedef tamamlandı", message: `${brand.name}: bugün ${limits.brandToday}/${limits.brandDailyLimit} video üretildi.`, dedupeKey: `daily-target:${brand.id}:${new Date().toISOString().slice(0, 10)}` });
    }
    return updated;
  } catch (err) {
    const msg = errorMessage(err);
    const willRetry = isRetryable(err) && !(err instanceof BudgetExceededError) && attemptsMade + 1 < (GENERATE_JOB_OPTIONS.attempts ?? 1);
    await prisma.video.update({ where: { id: videoId }, data: { status: willRetry ? "QUEUED" : "FAILED", errorMessage: msg.slice(0, 1000) } });
    if (willRetry) await reportProgress(videoId, "QUEUED", 0, "Hata oluştu, otomatik olarak tekrar denenecek");
    if (!willRetry) {
      await notify({ type: "VIDEO_FAILED", severity: "ERROR", brandId: brand.id, title: "Video üretilemedi", message: `${brand.name}: ${msg}`, data: { videoId } });
    }
    logger.error({ videoId, err: msg, willRetry }, "video üretimi başarısız");
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** shorts3d şablonu için seri adı, bölüm numarası, kapak başlığı ve vurgu kelimeleri */
async function shortsOptions(brand: { id: string; name: string }, videoId: string, raw: unknown, scenes: { label?: string }[]) {
  const r = (raw ?? {}) as { cover_title?: string; highlight_words?: string[]; alert_words?: string[] };
  const done = await prisma.video.count({ where: { brandId: brand.id, id: { not: videoId }, storageKey: { not: null } } });
  const episode = done + 1;
  return {
    seriesName: brand.name,
    episode,
    coverTitle: r.cover_title || null,
    highlights: { yellow: r.highlight_words ?? [], red: r.alert_words ?? [] },
    labels: scenes.map((s) => s.label ?? ""),
    outroSubtitle: `Bölüm ${episode + 1} yakında!`,
  };
}
