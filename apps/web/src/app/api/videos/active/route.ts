import { prisma, accessibleBrandIds, readProgress, stagePercent, estimateRemainingSec, STAGE_LABELS, queue, QUEUE, GENERATE_JOB_OPTIONS } from "@asf/core";
import { api, ok } from "@/lib/api";

const ACTIVE = ["QUEUED", "SCRIPTING", "FETCHING_MEDIA", "VOICING", "RENDERING", "QUALITY_CHECK"] as const;
const FINISHED = ["READY", "QC_FAILED", "FAILED"] as const;
/** Bitmiş videolar bu süre boyunca listede kalır, kullanıcı sonucu görebilsin */
const RECENT_MS = 15 * 60_000;

/** Üretimdeki videoların ilerleme yüzdesi, aşaması ve tahmini kalan süresi (panel birkaç saniyede bir sorar) */
export const GET = api(async ({ user, req }) => {
  const ids = await accessibleBrandIds(user);
  const brandId = req.nextUrl.searchParams.get("brandId");
  const brandFilter = brandId && ids.includes(brandId) ? brandId : { in: ids };
  const videos = await prisma.video.findMany({
    where: {
      brandId: brandFilter,
      OR: [{ status: { in: [...ACTIVE] } }, { status: { in: [...FINISHED] }, updatedAt: { gte: new Date(Date.now() - RECENT_MS) } }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, brandId: true, title: true, status: true, errorMessage: true, createdAt: true, updatedAt: true, completedAt: true, durationSec: true, qcPassed: true },
  });

  // Geçmiş başarılı videoların ortalama üretim süresi (kalan süre tahmini için yedek)
  const recentDone = await prisma.video.findMany({
    where: { brandId: brandFilter, status: { in: ["READY", "PUBLISHED", "PARTIALLY_PUBLISHED", "PUBLISHING"] }, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: 10,
    select: { createdAt: true, completedAt: true },
  });
  const spans = recentDone.map((v) => (v.completedAt!.getTime() - v.createdAt.getTime()) / 1000).filter((x) => x > 0 && x < 3 * 3600);
  const typicalTotalSec = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null;

  const progress = await readProgress(videos.map((v) => v.id));
  const q = queue(QUEUE.generate);
  const maxAttempts = GENERATE_JOB_OPTIONS.attempts ?? 1;

  const items = await Promise.all(
    videos.map(async (v) => {
      const p = progress[v.id];
      const active = (ACTIVE as readonly string[]).includes(v.status);
      // Redis kaydı yoksa (ör. eski video) yüzde yalnızca durumdan türetilir
      const samestage = p && p.stage === v.status;
      const percent = !active ? (v.status === "FAILED" ? (p?.percent ?? 0) : 100) : samestage ? p!.percent : stagePercent(v.status, 0);
      let attemptsMade: number | null = null;
      if (active) {
        const job = await q.getJob(`gen-${v.id}`).catch(() => null);
        attemptsMade = job ? job.attemptsMade : null;
      }
      const retrying = v.status === "QUEUED" && !!v.errorMessage;
      return {
        id: v.id,
        brandId: v.brandId,
        title: v.title,
        status: v.status,
        stageLabel: STAGE_LABELS[v.status] ?? v.status,
        detail: retrying ? "Hata oluştu, otomatik olarak tekrar denenecek" : samestage ? p!.detail : null,
        percent,
        active,
        retrying,
        // attemptsMade = biten (başarısız) deneme sayısı; şu anki/sıradaki deneme bir fazlasıdır
        attempt: attemptsMade !== null ? Math.min(maxAttempts, attemptsMade + 1) : null,
        maxAttempts,
        error: v.status === "FAILED" || v.status === "QC_FAILED" || retrying ? v.errorMessage : null,
        startedAt: p?.startedAt ?? null,
        remainingSec: active && !retrying ? estimateRemainingSec({ percent, startedAt: p?.startedAt ?? null }, typicalTotalSec) : null,
        createdAt: v.createdAt,
        completedAt: v.completedAt,
        durationSec: v.durationSec,
      };
    }),
  );
  return ok({ videos: items, typicalTotalSec, serverTime: new Date().toISOString() });
});
