import { prisma, accessibleBrandIds, topVideos, categoryPerformance, latestSnapshots } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ user, req }) => {
  const ids = await accessibleBrandIds(user);
  const brandId = req.nextUrl.searchParams.get("brandId");
  const scope = brandId && ids.includes(brandId) ? [brandId] : ids;
  const snaps = await latestSnapshots(scope);
  const byPlatform: Record<string, { views: number; likes: number; comments: number; shares: number; saves: number; posts: number; supported: Record<string, boolean> }> = {};
  for (const s of snaps) {
    const p = (byPlatform[s.platform] ??= { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, posts: 0, supported: {} });
    p.posts++;
    for (const k of ["views", "likes", "comments", "shares", "saves"] as const) {
      if (s[k] !== null) {
        p[k] += s[k] ?? 0;
        p.supported[k] = true;
      }
    }
  }
  const top = await topVideos(scope, 10);
  const categories = brandId ? await categoryPerformance(brandId) : null;
  const followers = await prisma.analyticsSnapshot.findMany({ where: { brandId: { in: scope }, followers: { not: null } }, orderBy: { capturedAt: "asc" }, select: { platform: true, followers: true, capturedAt: true, socialAccountId: true } });
  return ok({ byPlatform, top, categories, followers });
});
