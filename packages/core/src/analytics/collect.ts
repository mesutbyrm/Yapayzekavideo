import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { publisherFor } from "../publishers/registry";
import { getValidAccessToken } from "../publishers/tokens";
import { ProviderError } from "../lib/errors";

/**
 * Yayınlanmış gönderilerin metriklerini platformlardan çeker (son 30 gün).
 * Platformun desteklemediği metrikler null kalır. Hesap takipçi sayısı da kaydedilir.
 */
export async function collectAnalytics(brandId?: string) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const results = await prisma.publishResult.findMany({
    where: { success: true, externalPostId: { not: null }, createdAt: { gte: since }, ...(brandId ? { brandId } : {}), socialAccount: { status: "CONNECTED" } },
    include: { socialAccount: true },
  });
  let ok = 0, failed = 0;
  const tokenCache = new Map<string, string>();
  for (const r of results) {
    try {
      let token = tokenCache.get(r.socialAccountId);
      if (!token) {
        token = await getValidAccessToken(r.socialAccount);
        tokenCache.set(r.socialAccountId, token);
      }
      const m = await publisherFor(r.platform).getAnalytics(r.socialAccount, token, r.externalPostId!);
      await prisma.analyticsSnapshot.create({
        data: { brandId: r.brandId, videoId: r.videoId, socialAccountId: r.socialAccountId, platform: r.platform, externalPostId: r.externalPostId, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves, reach: m.reach, raw: (m.raw ?? undefined) as any },
      });
      ok++;
    } catch (err) {
      failed++;
      logger.warn({ resultId: r.id, platform: r.platform, err: err instanceof ProviderError ? err.code : (err as Error).message }, "metrik alınamadı");
    }
  }
  // Takipçi sayıları
  const accounts = await prisma.socialAccount.findMany({ where: { status: "CONNECTED", ...(brandId ? { brandId } : {}) } });
  for (const a of accounts) {
    try {
      const p = publisherFor(a.platform);
      if (!p.getFollowers || !p.isConfigured()) continue;
      const followers = await p.getFollowers(a, await getValidAccessToken(a));
      await prisma.analyticsSnapshot.create({ data: { brandId: a.brandId, socialAccountId: a.id, platform: a.platform, followers } });
    } catch (err) {
      logger.warn({ accountId: a.id, err: (err as Error).message }, "takipçi sayısı alınamadı");
    }
  }
  return { ok, failed, accounts: accounts.length };
}
