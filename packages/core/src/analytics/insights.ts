import { prisma } from "../lib/db";

/**
 * Her (video, hesap) için en güncel metrik anlık görüntüsü.
 * Desteklenmeyen metrikler null olarak kalır; tahmin üretilmez.
 */
export async function latestSnapshots(brandIds: string[], since?: Date) {
  const rows = await prisma.analyticsSnapshot.findMany({
    where: { brandId: { in: brandIds }, videoId: { not: null }, ...(since ? { capturedAt: { gte: since } } : {}) },
    orderBy: { capturedAt: "desc" },
  });
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.videoId}:${r.socialAccountId}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()];
}

export async function topVideos(brandIds: string[], limit = 10) {
  const snaps = await latestSnapshots(brandIds);
  const byVideo = new Map<string, { views: number; likes: number; comments: number; shares: number; platforms: Set<string> }>();
  for (const s of snaps) {
    const v = byVideo.get(s.videoId!) ?? { views: 0, likes: 0, comments: 0, shares: 0, platforms: new Set<string>() };
    v.views += s.views ?? 0;
    v.likes += s.likes ?? 0;
    v.comments += s.comments ?? 0;
    v.shares += s.shares ?? 0;
    v.platforms.add(s.platform);
    byVideo.set(s.videoId!, v);
  }
  const ids = [...byVideo.keys()];
  const videos = await prisma.video.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, createdAt: true, thumbnailKey: true, script: { select: { idea: { select: { topic: true, category: { select: { name: true } } } } } } } });
  return videos
    .map((v) => {
      const m = byVideo.get(v.id)!;
      const engagement = m.views > 0 ? (m.likes + m.comments + m.shares) / m.views : null;
      return { id: v.id, title: v.title, createdAt: v.createdAt, topic: v.script?.idea?.topic ?? null, category: v.script?.idea?.category?.name ?? null, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, engagementRate: engagement, platforms: [...m.platforms] };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

/** İçerik motoruna geri besleme: gerçek performansa göre en iyi konular */
export async function topPerformingTopics(brandId: string, limit = 5): Promise<string[]> {
  const top = await topVideos([brandId], limit);
  return top.filter((t) => t.views > 0).map((t) => `${t.topic ?? t.title} (${t.views} izlenme${t.engagementRate !== null ? `, %${(t.engagementRate * 100).toFixed(1)} etkileşim` : ""})`);
}

/** Kategori bazında performans ve öneriler */
export async function categoryPerformance(brandId: string) {
  const top = await topVideos([brandId], 200);
  const agg = new Map<string, { videos: number; views: number; engagement: number[] }>();
  for (const t of top) {
    const k = t.category ?? "Kategorisiz";
    const a = agg.get(k) ?? { videos: 0, views: 0, engagement: [] };
    a.videos++;
    a.views += t.views;
    if (t.engagementRate !== null) a.engagement.push(t.engagementRate);
    agg.set(k, a);
  }
  const rows = [...agg.entries()].map(([category, a]) => ({
    category,
    videos: a.videos,
    avgViews: a.videos ? Math.round(a.views / a.videos) : 0,
    avgEngagement: a.engagement.length ? a.engagement.reduce((x, y) => x + y, 0) / a.engagement.length : null,
  }));
  rows.sort((a, b) => b.avgViews - a.avgViews);
  const recommendations: string[] = [];
  if (rows.length >= 2 && rows[0].videos >= 3) {
    recommendations.push(`"${rows[0].category}" kategorisi ortalama ${rows[0].avgViews} izlenme ile en iyi performansı gösteriyor; bu kategorinin ağırlığını artırmayı düşünün.`);
    const worst = rows[rows.length - 1];
    if (worst.videos >= 3 && worst.avgViews < rows[0].avgViews / 3) recommendations.push(`"${worst.category}" kategorisi düşük performanslı (${worst.avgViews} ort. izlenme); farklı bir açı deneyin veya ağırlığını azaltın.`);
  } else {
    recommendations.push("Güvenilir öneri için her kategoride en az 3 yayınlanmış video ve platform metrikleri gerekli.");
  }
  return { rows, recommendations };
}
