import { prisma } from "../lib/db";
import { DateTime } from "luxon";
import { DEFAULT_TZ } from "../lib/time";

export type Granularity = "day" | "week" | "month";

/** Maliyet raporu: zaman serisi + provider/marka/video kırılımları */
export async function costReport(brandIds: string[] | null, from: Date, to: Date, granularity: Granularity = "day") {
  const where = { createdAt: { gte: from, lte: to }, ...(brandIds ? { OR: [{ brandId: { in: brandIds } }, { brandId: null }] } : {}) };
  const logs = await prisma.aIUsageLog.findMany({ where, select: { createdAt: true, provider: true, brandId: true, videoId: true, costUsd: true, inputTokens: true, outputTokens: true, characters: true } });
  const series = new Map<string, number>();
  const byProvider = new Map<string, number>();
  const byBrand = new Map<string, number>();
  const byVideo = new Map<string, number>();
  let total = 0, tokensIn = 0, tokensOut = 0, chars = 0;
  for (const l of logs) {
    const c = Number(l.costUsd);
    total += c;
    tokensIn += l.inputTokens ?? 0;
    tokensOut += l.outputTokens ?? 0;
    chars += l.characters ?? 0;
    const d = DateTime.fromJSDate(l.createdAt, { zone: DEFAULT_TZ }).startOf(granularity).toISODate()!;
    series.set(d, (series.get(d) ?? 0) + c);
    byProvider.set(l.provider, (byProvider.get(l.provider) ?? 0) + c);
    if (l.brandId) byBrand.set(l.brandId, (byBrand.get(l.brandId) ?? 0) + c);
    if (l.videoId) byVideo.set(l.videoId, (byVideo.get(l.videoId) ?? 0) + c);
  }
  const brands = await prisma.brand.findMany({ where: { id: { in: [...byBrand.keys()] } }, select: { id: true, name: true } });
  const videos = await prisma.video.findMany({ where: { id: { in: [...byVideo.keys()] } }, select: { id: true, title: true } });
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return {
    totalUsd: r4(total),
    openAiTokens: { input: tokensIn, output: tokensOut },
    ttsCharacters: chars,
    videoCount: byVideo.size,
    avgPerVideoUsd: byVideo.size ? r4([...byVideo.values()].reduce((a, b) => a + b, 0) / byVideo.size) : 0,
    series: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, usd]) => ({ date, usd: r4(usd) })),
    byProvider: [...byProvider.entries()].map(([provider, usd]) => ({ provider, usd: r4(usd) })).sort((a, b) => b.usd - a.usd),
    byBrand: [...byBrand.entries()].map(([id, usd]) => ({ brandId: id, name: brands.find((b) => b.id === id)?.name ?? id, usd: r4(usd) })),
    byVideo: [...byVideo.entries()].map(([id, usd]) => ({ videoId: id, title: videos.find((v) => v.id === id)?.title ?? id, usd: r4(usd) })).sort((a, b) => b.usd - a.usd).slice(0, 50),
  };
}
