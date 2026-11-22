import path from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { UnrecoverableError } from "bullmq";
import { prisma, Prisma, type Platform, type PublishJob } from "../lib/db";
import { env } from "../lib/env";
import { logger, redactText } from "../lib/logger";
import { AppError, ProviderError, errorMessage, isRetryable } from "../lib/errors";
import { getSetting } from "../lib/settings";
import { storage } from "../storage";
import { notify } from "../notifications/notify";
import { publisherFor } from "../publishers/registry";
import { getValidAccessToken, markAccountError } from "../publishers/tokens";
import type { PublishMetadata, PublishOutcome } from "../publishers/types";
import { queue, QUEUE, DEFAULT_JOB_OPTIONS } from "../queue/queues";
import { audit } from "../lib/audit";

/** TikTok her gönderi için kullanıcı onayı gerektirir (UX yönergeleri) */
export function requiresConsent(platform: Platform) {
  return platform === "TIKTOK";
}

/**
 * Bir video için markanın bağlı her hesabına ayrı yayın işi oluşturur.
 * idempotencyKey = videoId:socialAccountId → aynı video aynı hesaba ikinci kez gönderilmez.
 */
export async function createPublishJobs(videoId: string, opts: { platforms?: Platform[]; scheduledAt?: Date; scheduledAtByPlatform?: Partial<Record<Platform, Date>> } = {}) {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
  if (video.status !== "READY" && video.status !== "PARTIALLY_PUBLISHED" && video.status !== "PUBLISHED" && video.status !== "PUBLISHING") {
    throw new AppError("Yalnızca kalite kontrolünden geçmiş videolar yayın kuyruğuna alınabilir", "NOT_READY", 409);
  }
  if (!video.qcPassed) throw new AppError("Video kalite kontrolünden geçmedi", "QC_FAILED", 409);
  const slotPlatforms = await platformsForSlot(video.brandId, video.scheduleSlot);
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId: video.brandId, status: "CONNECTED", ...(opts.platforms?.length ? {} : { autoPublish: true }), platform: { in: opts.platforms ?? slotPlatforms } },
  });
  const when = opts.scheduledAt ?? (video.scheduleSlot && video.scheduleSlot > new Date() ? video.scheduleSlot : new Date());
  const jobs: PublishJob[] = [];
  for (const acc of accounts) {
    const key = `${videoId}:${acc.id}`;
    try {
      const job = await prisma.publishJob.create({
        data: {
          brandId: video.brandId,
          videoId,
          socialAccountId: acc.id,
          platform: acc.platform,
          scheduledAt: opts.scheduledAtByPlatform?.[acc.platform] ?? when,
          idempotencyKey: key,
          status: requiresConsent(acc.platform) ? "AWAITING_CONSENT" : "SCHEDULED",
        },
      });
      jobs.push(job);
      if (job.status === "SCHEDULED") await enqueuePublish(job);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue; // zaten var
      throw err;
    }
  }
  if (jobs.length) await prisma.video.update({ where: { id: videoId }, data: { status: "PUBLISHING" } });
  if (!accounts.length) logger.warn({ videoId }, "bağlı sosyal hesap yok; yayın işi oluşturulmadı");
  return jobs;
}

async function platformsForSlot(brandId: string, slot: Date | null): Promise<Platform[]> {
  const all: Platform[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"];
  if (!slot) return all;
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { timezone: true } });
  const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: brand?.timezone ?? "Europe/Istanbul" }).format(slot);
  const s = await prisma.schedule.findUnique({ where: { brandId_time: { brandId, time: hhmm } } });
  return s?.platforms?.length ? s.platforms : all;
}

/** Gelecekteki tekil hedef işini (hesap/platform) yeniden planlar. */
export async function reschedulePublishJob(publishJobId: string, userId: string, scheduledAt: Date) {
  if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    throw new AppError("Yayın saati gelecekte olmalı", "INVALID_SCHEDULE", 400);
  }
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId } });
  if (!["SCHEDULED", "AWAITING_CONSENT"].includes(job.status)) {
    throw new AppError("Yalnızca zamanlanmış veya TikTok onayı bekleyen yayın düzenlenebilir", "INVALID_STATE", 409);
  }
  if (job.status === "SCHEDULED") {
    // İş BullMQ'da çalışmaya başladıysa remove hata verir ve plan veritabanında değiştirilmez.
    await queue(QUEUE.publish(job.platform)).remove(`pub-${job.id}`);
  }
  const updated = await prisma.publishJob.update({ where: { id: job.id }, data: { scheduledAt } });
  if (updated.status === "SCHEDULED") await enqueuePublish(updated);
  await audit({ action: "publish.reschedule", userId, brandId: job.brandId, entity: "PublishJob", entityId: job.id, metadata: { scheduledAt: scheduledAt.toISOString(), platform: job.platform } });
  return updated;
}

export async function enqueuePublish(job: Pick<PublishJob, "id" | "platform" | "scheduledAt">) {
  const delay = Math.max(0, job.scheduledAt.getTime() - Date.now());
  await queue(QUEUE.publish(job.platform)).add(
    "publish",
    { publishJobId: job.id },
    { ...DEFAULT_JOB_OPTIONS, jobId: `pub-${job.id}`, delay, attempts: 5, backoff: { type: "exponential", delay: 2 * 60_000 } },
  );
}

/** TikTok: kullanıcı önizlemeyi görüp gizlilik seviyesini seçerek onay verir */
export async function giveConsent(publishJobId: string, userId: string, options: { privacyLevel: string; disableComment?: boolean; disableDuet?: boolean; disableStitch?: boolean; brandContent?: boolean; brandOrganic?: boolean; musicConfirmation: boolean }) {
  if (!options.musicConfirmation) throw new AppError("TikTok Müzik Kullanım Onayı kabul edilmeli", "CONSENT_REQUIRED", 400);
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId } });
  if (job.status !== "AWAITING_CONSENT" && job.status !== "FAILED") throw new AppError("Bu iş onay beklemiyor", "INVALID_STATE", 409);
  const now = new Date();
  const updated = await prisma.publishJob.update({
    where: { id: publishJobId },
    data: {
      status: "SCHEDULED",
      consentGivenAt: now,
      consentById: userId,
      options: { ...options, consentGivenAt: now.toISOString() } as any,
      scheduledAt: job.scheduledAt > now ? job.scheduledAt : now,
      lastError: null,
    },
  });
  await enqueuePublish(updated);
  await audit({ action: "publish.consent", userId, brandId: job.brandId, entity: "PublishJob", entityId: job.id, metadata: { privacyLevel: options.privacyLevel } });
  return updated;
}

function metadataFor(platform: Platform, script: { title: string; hashtags: string[]; platformMetadata: any; narration: string } | null, fallbackTitle: string): PublishMetadata {
  const key = platform.toLowerCase();
  const pm = (script?.platformMetadata ?? {})[key] ?? {};
  const hashtags: string[] = [...new Set([...(pm.hashtags ?? []), ...(script?.hashtags ?? [])])].slice(0, platform === "INSTAGRAM" ? 30 : 15);
  const title = (pm.title || script?.title || fallbackTitle).slice(0, 100);
  const tagStr = hashtags.join(" ");
  const captionBase = pm.caption || script?.title || fallbackTitle;
  const caption = captionBase.includes("#") ? captionBase : `${captionBase}\n\n${tagStr}`;
  const description = `${pm.description || captionBase}\n\n${tagStr}`.trim();
  return { title, caption: caption.slice(0, 2200), description: description.slice(0, 5000), tags: hashtags.map((h) => h.replace(/^#/, "")), hashtags };
}

async function refreshVideoStatus(videoId: string) {
  const jobs = await prisma.publishJob.findMany({ where: { videoId }, select: { status: true } });
  if (!jobs.length) return;
  const ok = jobs.filter((j) => j.status === "SUCCEEDED").length;
  const open = jobs.filter((j) => ["PENDING", "SCHEDULED", "RUNNING", "PROCESSING", "AWAITING_CONSENT"].includes(j.status)).length;
  const status = ok === jobs.length ? "PUBLISHED" : ok > 0 ? "PARTIALLY_PUBLISHED" : open > 0 ? "PUBLISHING" : "READY";
  await prisma.video.update({ where: { id: videoId }, data: { status } });
}

/**
 * Tek bir platform yayın işini çalıştırır. Bir platformdaki hata diğer platform işlerini etkilemez
 * (her platformun kendi kuyruğu ve işi vardır).
 */
export async function runPublishJob(publishJobId: string, attemptsMade = 0): Promise<PublishOutcome | null> {
  const job = await prisma.publishJob.findUnique({ where: { id: publishJobId }, include: { socialAccount: true, video: { include: { script: true } } } });
  if (!job) return null;
  if (["SUCCEEDED", "CANCELLED", "AWAITING_CONSENT", "BLOCKED"].includes(job.status)) {
    logger.info({ publishJobId, status: job.status }, "yayın işi atlandı");
    return null;
  }
  // Çift yayın engeli: aynı video + hesap için başarılı sonuç varsa tekrar gönderme
  const existing = await prisma.publishResult.findFirst({ where: { videoId: job.videoId, socialAccountId: job.socialAccountId, success: true } });
  if (existing) {
    await prisma.publishJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
    return { state: "published", externalPostId: existing.externalPostId, postUrl: existing.postUrl };
  }
  if (!(await getSetting("publishing.enabled"))) {
    throw new ProviderError("Yayınlama sistem ayarlarından durduruldu", "system", "PUBLISHING_DISABLED", true, undefined, "transient");
  }
  const account = job.socialAccount;
  if (account.status !== "CONNECTED") {
    await prisma.publishJob.update({ where: { id: job.id }, data: { status: "BLOCKED", lastError: `Hesap durumu: ${account.status}`, lastErrorCode: account.status } });
    await refreshVideoStatus(job.videoId);
    throw new UnrecoverableError(`Hesap bağlı değil (${account.status})`);
  }
  const video = job.video;
  if (!video.storageKey || !video.qcPassed) {
    await prisma.publishJob.update({ where: { id: job.id }, data: { status: "BLOCKED", lastError: "Video hazır değil veya kalite kontrolünden geçmedi" } });
    throw new UnrecoverableError("Video hazır değil");
  }
  const publisher = publisherFor(job.platform);
  const attempt = job.attempts + 1;
  await prisma.publishJob.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: attempt, startedAt: new Date() } });

  const workDir = path.join(env().WORK_DIR, `pub-${job.id}`);
  try {
    if (!publisher.isConfigured()) {
      throw new ProviderError(`${job.platform} API anahtarları yapılandırılmadı (${publisher.requiredEnv.join(", ")})`, job.platform.toLowerCase(), "NOT_CONFIGURED", false, undefined, "auth");
    }
    const accessToken = await getValidAccessToken(account);
    // Platform durumu ön kontrolü (bağlantı, token, hesap erişimi)
    await publisher.getAccountInfo(account, accessToken);

    const mediaInfo = { sizeBytes: Number(video.sizeBytes ?? 0), durationSec: video.durationSec ?? 0, width: video.width ?? 0, height: video.height ?? 0, fps: video.fps ?? 0 };
    const errs = publisher.validateMedia(mediaInfo, account);
    if (errs.length) throw new ProviderError(`Medya platform kurallarına uymuyor: ${errs.join("; ")}`, job.platform.toLowerCase(), "MEDIA_INVALID", false, undefined, "validation");

    let localPath: string | null = null;
    const manifest = (video.mediaManifest ?? {}) as any;
    const outcome = await publisher.publishVideo({
      account,
      accessToken,
      media: {
        ...mediaInfo,
        publicUrl: await storage().publicUrl(video.storageKey, 6 * 3600),
        getLocalPath: async () => {
          if (localPath) return localPath;
          await mkdir(workDir, { recursive: true });
          localPath = path.join(workDir, "video.mp4");
          await storage().getToFile(video.storageKey!, localPath);
          const st = await stat(localPath);
          if (st.size !== mediaInfo.sizeBytes && mediaInfo.sizeBytes) mediaInfo.sizeBytes = st.size;
          return localPath;
        },
        containsAiImagery: !!manifest.containsAiImagery,
      },
      metadata: metadataFor(job.platform, video.script, video.title ?? "Video"),
      options: (job.options ?? {}) as Record<string, any>,
      externalRef: job.externalRef,
      saveRef: async (ref) => {
        await prisma.publishJob.update({ where: { id: job.id }, data: { externalRef: ref } });
      },
      publishAt: job.scheduledAt > new Date() ? job.scheduledAt : null,
    });

    if (outcome.state === "processing") {
      await prisma.publishJob.update({ where: { id: job.id }, data: { status: "PROCESSING", externalRef: outcome.ref ?? job.externalRef } });
      await queue(QUEUE.publishStatus).add("check", { publishJobId: job.id, checks: 0 }, { delay: 2 * 60_000, jobId: `chk-${job.id}-0`, attempts: 1 });
      return outcome;
    }
    await recordSuccess(job, outcome, attempt);
    return outcome;
  } catch (err) {
    await handlePublishError(job, err, attempt, attemptsMade);
    throw err instanceof ProviderError && !err.retryable ? new UnrecoverableError(err.message) : err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function recordSuccess(job: PublishJob, outcome: PublishOutcome, attempt: number) {
  await prisma.$transaction([
    prisma.publishResult.create({
      data: {
        brandId: job.brandId,
        publishJobId: job.id,
        videoId: job.videoId,
        socialAccountId: job.socialAccountId,
        platform: job.platform,
        success: true,
        externalPostId: outcome.externalPostId ?? null,
        postUrl: outcome.postUrl ?? null,
        privacy: outcome.privacy ?? null,
        response: sanitize(outcome.raw),
        attempt,
      },
    }),
    prisma.publishJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null, lastErrorCode: null } }),
  ]);
  await refreshVideoStatus(job.videoId);
  const privateNote = outcome.state === "private_only" ? " (yalnızca özel/gizli olarak yayınlandı – platform denetimi gerekli)" : outcome.state === "scheduled" ? " (platformda zamanlandı)" : "";
  await notify({
    type: "PUBLISH_SUCCEEDED",
    severity: outcome.state === "private_only" ? "WARNING" : "SUCCESS",
    brandId: job.brandId,
    title: `${job.platform} yayını başarılı`,
    message: `${outcome.postUrl ?? outcome.externalPostId ?? ""}${privateNote}`,
    data: { publishJobId: job.id, videoId: job.videoId, postUrl: outcome.postUrl },
  });
}

async function handlePublishError(job: PublishJob & { socialAccount: any }, err: unknown, attempt: number, attemptsMade: number) {
  const pe = err instanceof ProviderError ? err : null;
  const msg = redactText(errorMessage(err)).slice(0, 1000);
  const retryable = isRetryable(err) && attemptsMade + 1 < job.maxAttempts;
  await prisma.publishResult.create({
    data: {
      brandId: job.brandId,
      publishJobId: job.id,
      videoId: job.videoId,
      socialAccountId: job.socialAccountId,
      platform: job.platform,
      success: false,
      errorCode: pe?.code ?? "ERROR",
      errorMessage: msg,
      response: sanitize(pe?.raw),
      attempt,
    },
  });
  await prisma.publishJob.update({
    where: { id: job.id },
    data: { status: retryable ? "SCHEDULED" : "FAILED", lastError: msg, lastErrorCode: pe?.code ?? "ERROR", finishedAt: retryable ? null : new Date() },
  });
  if (pe?.kind === "auth") await markAccountError(job.socialAccount, pe.code === "TOKEN_EXPIRED" || pe.code.startsWith("META_190") ? "TOKEN_EXPIRED" : "ERROR", msg);
  if (!retryable) {
    await refreshVideoStatus(job.videoId);
    await notify({ type: "PUBLISH_FAILED", severity: "ERROR", brandId: job.brandId, title: `${job.platform} yayını başarısız`, message: msg, data: { publishJobId: job.id, videoId: job.videoId, code: pe?.code } });
  }
  logger.warn({ publishJobId: job.id, platform: job.platform, code: pe?.code, retryable }, "yayın hatası");
}

/** İşlemesi süren yayınları kontrol eder (Instagram container, TikTok publish_id, Facebook video) */
export async function checkPublishStatus(publishJobId: string, checks: number) {
  const job = await prisma.publishJob.findUnique({ where: { id: publishJobId }, include: { socialAccount: true } });
  if (!job || job.status !== "PROCESSING" || !job.externalRef) return;
  const publisher = publisherFor(job.platform);
  try {
    const token = await getValidAccessToken(job.socialAccount);
    // Instagram: container hazırsa yayınlama adımını tamamlamak için işi yeniden çalıştır
    if (job.platform === "INSTAGRAM") {
      await prisma.publishJob.update({ where: { id: job.id }, data: { status: "SCHEDULED" } });
      await queue(QUEUE.publish(job.platform)).add("publish", { publishJobId: job.id }, { jobId: `pub-${job.id}-r${checks}`, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
      return;
    }
    const st = await publisher.getPublishStatus({ account: job.socialAccount, accessToken: token, options: (job.options ?? {}) as any, externalRef: job.externalRef }, job.externalRef);
    if (st.state !== "processing") return recordSuccess(job, st, job.attempts);
  } catch (err) {
    await handlePublishError(job, err, job.attempts, job.maxAttempts);
    return;
  }
  if (checks >= 15) {
    await handlePublishError(job, new ProviderError("Platform işleme süresi aşıldı (30+ dk)", job.platform.toLowerCase(), "PROCESSING_TIMEOUT", false), job.attempts, job.maxAttempts);
    return;
  }
  await queue(QUEUE.publishStatus).add("check", { publishJobId, checks: checks + 1 }, { delay: 2 * 60_000, jobId: `chk-${publishJobId}-${checks + 1}`, attempts: 1 });
}

export async function cancelPublishJob(publishJobId: string, userId?: string) {
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId } });
  if (["SUCCEEDED", "RUNNING", "PROCESSING"].includes(job.status)) throw new AppError("Çalışan veya tamamlanmış iş iptal edilemez", "INVALID_STATE", 409);
  await prisma.publishJob.update({ where: { id: job.id }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await queue(QUEUE.publish(job.platform)).remove(`pub-${job.id}`).catch(() => undefined);
  await refreshVideoStatus(job.videoId);
  await audit({ action: "publish.cancel", userId, brandId: job.brandId, entity: "PublishJob", entityId: job.id });
}

export async function retryPublishJob(publishJobId: string, userId?: string) {
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId } });
  if (!["FAILED", "BLOCKED", "CANCELLED"].includes(job.status)) throw new AppError("Yalnızca başarısız/engellenmiş işler yeniden denenebilir", "INVALID_STATE", 409);
  const success = await prisma.publishResult.findFirst({ where: { videoId: job.videoId, socialAccountId: job.socialAccountId, success: true } });
  if (success) throw new AppError("Bu video bu hesapta zaten yayınlanmış", "DUPLICATE", 409);
  const status = requiresConsent(job.platform) && !job.consentGivenAt ? "AWAITING_CONSENT" : "SCHEDULED";
  const updated = await prisma.publishJob.update({ where: { id: job.id }, data: { status, attempts: 0, scheduledAt: new Date(), lastError: null, finishedAt: null } });
  await queue(QUEUE.publish(job.platform)).remove(`pub-${job.id}`).catch(() => undefined);
  if (status === "SCHEDULED") {
    await queue(QUEUE.publish(job.platform)).add("publish", { publishJobId: job.id }, { ...DEFAULT_JOB_OPTIONS, jobId: `pub-${job.id}-retry-${Date.now()}` });
  }
  await audit({ action: "publish.retry", userId, brandId: job.brandId, entity: "PublishJob", entityId: job.id });
  return updated;
}

function sanitize(raw: unknown): any {
  if (raw === undefined || raw === null) return undefined;
  try {
    return JSON.parse(redactText(JSON.stringify(raw)).replace(/"(access_token|refresh_token|upload_url)":"[^"]*"/g, '"$1":"[REDACTED]"'));
  } catch {
    return undefined;
  }
}
