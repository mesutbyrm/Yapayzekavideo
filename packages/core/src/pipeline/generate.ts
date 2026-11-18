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
import { runQualityCheck } from "../qc/quality";
import { notify } from "../notifications/notify";
import { generationLimits } from "./limits";
import { createPublishJobs } from "./publishing";
import { queue, QUEUE, GENERATE_JOB_OPTIONS } from "../queue/queues";
import { audit } from "../lib/audit";

/** Yeni video kaydı oluşturur ve üretim kuyruğuna ekler. Limit ve bütçe önceden kontrol edilir. */
export async function enqueueGeneration(brandId: string, opts: { scheduleSlot?: Date | null; trigger: "auto" | "manual"; userId?: string | null; scriptId?: string | null }) {
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
    video = await prisma.video.create({ data: { brandId, scheduleSlot: opts.scheduleSlot ?? null, trigger: opts.trigger, scriptId: opts.scriptId ?? null, status: "QUEUED" } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("Bu zaman dilimi için video zaten oluşturulmuş", "DUPLICATE_SLOT", 409);
    }
    throw err;
  }
  await queue(QUEUE.generate).add("generate", { videoId: video.id }, { ...GENERATE_JOB_OPTIONS, jobId: `gen-${video.id}` });
  await audit({ action: "video.enqueue", userId: opts.userId, brandId, entity: "Video", entityId: video.id, metadata: { trigger: opts.trigger } });
  return video;
}

async function setStatus(videoId: string, status: VideoStatus, extra: Prisma.VideoUpdateInput = {}) {
  await prisma.video.update({ where: { id: videoId }, data: { status, ...extra } });
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
  const workDir = path.join(env().WORK_DIR, videoId);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    // 1-2) Konu + senaryo
    await setStatus(videoId, "SCRIPTING");
    let script = video.scriptId ? await prisma.videoScript.findUnique({ where: { id: video.scriptId } }) : null;
    if (!script) {
      const idea = await pickIdea(brand.id);
      script = await generateScript(brand.id, idea.id, videoId);
      await prisma.video.update({ where: { id: videoId }, data: { scriptId: script.id, title: script.title } });
    }
    const scenes = script.scenes as unknown as { duration: number; visual_description: string; search_keywords?: string[]; subtitle: string }[];

    // 3) Medya
    await setStatus(videoId, "FETCHING_MEDIA", { title: script.title });
    const resolved = await resolveSceneMedia({ brandId: brand.id, videoId, scenes, workDir });

    // 4) Seslendirme
    await setStatus(videoId, "VOICING");
    const tts = await synthesizeNarration({
      text: script.narration,
      voice: { voiceName: brand.voiceName, gender: brand.voiceGender === "MALE" ? "MALE" : "FEMALE", speakingRate: brand.speakingRate, pitch: brand.voicePitch, languageCode: brand.language },
      workDir,
      brandId: brand.id,
      videoId,
      minDurationSec: brand.minDurationSec,
      maxDurationSec: brand.maxDurationSec,
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
    const render = await renderVideo({
      workDir,
      scenes: resolved.map((r, i) => ({ ...r, durationSec: scenes[i].duration, subtitle: scenes[i].subtitle })),
      voicePath: tts.mp3Path,
      voiceDurationSec: tts.durationSec,
      words: tts.words,
      musicPath: music?.file ?? null,
      musicVolume: brand.musicVolume,
      logoPath,
      brand: { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor, accentColor: brand.accentColor, font: brand.fontFamily },
      title: script.hook.length <= 40 ? script.hook : script.title,
      cta: script.cta,
      minDurationSec: brand.minDurationSec,
      maxDurationSec: brand.maxDurationSec,
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
      minDurationSec: brand.minDurationSec,
      maxDurationSec: brand.maxDurationSec,
      maxSizeMb: Number(await getSetting("video.maxSizeMb")),
      captionsCount: render.captions.length,
      media: manifest.scenes,
      contentBlocking: script.status === "REJECTED" ? ["senaryo reddedildi"] : [],
      musicLicensed: music ? music.asset.commercialUse : null,
    });

    // Depolama
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
    if (brand.autoPublish) await createPublishJobs(videoId);

    const limits = await generationLimits(brand.id);
    if (limits.brandToday >= limits.brandDailyLimit) {
      await notify({ type: "DAILY_TARGET_REACHED", severity: "SUCCESS", brandId: brand.id, title: "Günlük hedef tamamlandı", message: `${brand.name}: bugün ${limits.brandToday}/${limits.brandDailyLimit} video üretildi.`, dedupeKey: `daily-target:${brand.id}:${new Date().toISOString().slice(0, 10)}` });
    }
    return updated;
  } catch (err) {
    const msg = errorMessage(err);
    const willRetry = isRetryable(err) && !(err instanceof BudgetExceededError) && attemptsMade + 1 < (GENERATE_JOB_OPTIONS.attempts ?? 1);
    await prisma.video.update({ where: { id: videoId }, data: { status: willRetry ? "QUEUED" : "FAILED", errorMessage: msg.slice(0, 1000) } });
    if (!willRetry) {
      await notify({ type: "VIDEO_FAILED", severity: "ERROR", brandId: brand.id, title: "Video üretilemedi", message: `${brand.name}: ${msg}`, data: { videoId } });
    }
    logger.error({ videoId, err: msg, willRetry }, "video üretimi başarısız");
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
