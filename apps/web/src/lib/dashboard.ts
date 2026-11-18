import "server-only";
import { DateTime } from "luxon";
import { prisma, latestSnapshots, topVideos, monthRange, dayRange, DEFAULT_TZ, VARIABLE_PROVIDERS } from "@asf/core";

const IN_PROGRESS = ["QUEUED", "SCRIPTING", "FETCHING_MEDIA", "VOICING", "RENDERING", "QUALITY_CHECK"] as const;
const PRODUCED = { notIn: ["FAILED", "CANCELLED", "QC_FAILED", ...IN_PROGRESS] as any };

/** Bütün göstergeler gerçek veritabanından hesaplanır. Veri yoksa 0 / "—" gösterilir. */
export async function dashboardData(brandIds: string[]) {
  const scope = { brandId: { in: brandIds } };
  const day = dayRange();
  const month = monthRange();
  const now = DateTime.now().setZone(DEFAULT_TZ);

  const [today, monthCount, pendingVideos, pendingJobs, okPub, failPub, usage, videosMonth] = await Promise.all([
    prisma.video.count({ where: { ...scope, createdAt: { gte: day.start, lte: day.end }, status: PRODUCED } }),
    prisma.video.count({ where: { ...scope, createdAt: { gte: month.start, lte: month.end }, status: PRODUCED } }),
    prisma.video.count({ where: { ...scope, status: { in: [...IN_PROGRESS] } } }),
    prisma.publishJob.count({ where: { ...scope, status: { in: ["PENDING", "SCHEDULED", "AWAITING_CONSENT", "RUNNING", "PROCESSING"] } } }),
    prisma.publishResult.count({ where: { ...scope, success: true, createdAt: { gte: month.start } } }),
    prisma.publishJob.count({ where: { ...scope, status: { in: ["FAILED", "BLOCKED"] }, updatedAt: { gte: month.start } } }),
    prisma.aIUsageLog.aggregate({ _sum: { costUsd: true }, where: { ...scope, provider: { in: VARIABLE_PROVIDERS }, createdAt: { gte: month.start, lte: month.end } } }),
    prisma.video.findMany({ where: { ...scope, createdAt: { gte: month.start }, completedAt: { not: null } }, select: { costUsd: true } }),
  ]);
  const monthCost = Number(usage._sum.costUsd ?? 0);
  const avgCost = videosMonth.length ? videosMonth.reduce((a, v) => a + Number(v.costUsd), 0) / videosMonth.length : null;

  // Etkileşim (en güncel anlık görüntüler)
  const snaps = await latestSnapshots(brandIds);
  const totals = { views: 0, likes: 0, comments: 0, shares: 0, hasData: snaps.length > 0 };
  const perPlatform: Record<string, { views: number; likes: number; comments: number; shares: number }> = {};
  for (const s of snaps) {
    totals.views += s.views ?? 0;
    totals.likes += s.likes ?? 0;
    totals.comments += s.comments ?? 0;
    totals.shares += s.shares ?? 0;
    const p = (perPlatform[s.platform] ??= { views: 0, likes: 0, comments: 0, shares: 0 });
    p.views += s.views ?? 0;
    p.likes += s.likes ?? 0;
    p.comments += s.comments ?? 0;
    p.shares += s.shares ?? 0;
  }

  // Takipçi değişimi (son 30 gün, hesap bazında ilk-son farkı)
  const fol = await prisma.analyticsSnapshot.findMany({ where: { ...scope, followers: { not: null }, capturedAt: { gte: now.minus({ days: 30 }).toJSDate() } }, orderBy: { capturedAt: "asc" }, select: { socialAccountId: true, followers: true } });
  const firstLast = new Map<string, [number, number]>();
  for (const f of fol) {
    const cur = firstLast.get(f.socialAccountId);
    firstLast.set(f.socialAccountId, [cur ? cur[0] : f.followers!, f.followers!]);
  }
  const followerDelta = firstLast.size ? [...firstLast.values()].reduce((a, [s, e]) => a + (e - s), 0) : null;

  // Platform başarı oranı (bu ay, iş bazında)
  const jobs = await prisma.publishJob.groupBy({ by: ["platform", "status"], where: { ...scope, createdAt: { gte: month.start } }, _count: true });
  const rate: Record<string, { ok: number; fail: number }> = {};
  for (const j of jobs) {
    const r = (rate[j.platform] ??= { ok: 0, fail: 0 });
    if (j.status === "SUCCEEDED") r.ok += j._count;
    if (j.status === "FAILED" || j.status === "BLOCKED") r.fail += j._count;
  }

  // Zaman serileri
  const since = now.minus({ months: 12 }).startOf("month");
  const vids = await prisma.video.findMany({ where: { ...scope, createdAt: { gte: since.toJSDate() }, status: PRODUCED }, select: { createdAt: true } });
  const bucket = (unit: "day" | "week" | "month", count: number, fmt: string) => {
    const m = new Map<string, number>();
    for (let i = count - 1; i >= 0; i--) m.set(now.minus({ [unit + "s"]: i }).startOf(unit).toISODate()!, 0);
    for (const v of vids) {
      const k = DateTime.fromJSDate(v.createdAt, { zone: DEFAULT_TZ }).startOf(unit).toISODate()!;
      if (m.has(k)) m.set(k, m.get(k)! + 1);
    }
    return [...m.entries()].map(([k, value]) => ({ label: DateTime.fromISO(k).setLocale("tr").toFormat(fmt), value }));
  };

  const costs = await prisma.aIUsageLog.findMany({ where: { ...scope, createdAt: { gte: now.minus({ months: 5 }).startOf("month").toJSDate() } }, select: { createdAt: true, costUsd: true } });
  const costMap = new Map<string, number>();
  for (let i = 5; i >= 0; i--) costMap.set(now.minus({ months: i }).startOf("month").toISODate()!, 0);
  for (const c of costs) {
    const k = DateTime.fromJSDate(c.createdAt, { zone: DEFAULT_TZ }).startOf("month").toISODate()!;
    if (costMap.has(k)) costMap.set(k, costMap.get(k)! + Number(c.costUsd));
  }

  return {
    kpi: { today, monthCount, pendingVideos, pendingJobs, okPub, failPub, monthCost, avgCost, followerDelta, totals },
    successRate: Object.entries(rate).map(([platform, r]) => ({ platform, ok: r.ok, fail: r.fail, rate: r.ok + r.fail ? r.ok / (r.ok + r.fail) : null })),
    perPlatform: Object.entries(perPlatform).map(([platform, v]) => ({ platform, ...v, engagement: v.likes + v.comments + v.shares })),
    daily: bucket("day", 30, "dd MMM"),
    weekly: bucket("week", 12, "dd MMM"),
    monthly: bucket("month", 12, "LLL yy"),
    monthlyCost: [...costMap.entries()].map(([k, v]) => ({ label: DateTime.fromISO(k).setLocale("tr").toFormat("LLL yy"), value: Math.round(v * 10000) / 10000 })),
    top: await topVideos(brandIds, 10),
  };
}
