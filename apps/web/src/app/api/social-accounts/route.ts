import { prisma, accessibleBrandIds, platformStatus } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Token'lar asla döndürülmez */
export const GET = api(async ({ user, req }) => {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const ids = await accessibleBrandIds(user);
  const where = brandId && ids.includes(brandId) ? { brandId } : { brandId: { in: ids } };
  const accounts = await prisma.socialAccount.findMany({
    where,
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
    select: { id: true, brandId: true, platform: true, externalId: true, displayName: true, username: true, avatarUrl: true, status: true, scopes: true, autoPublish: true, lastError: true, lastCheckedAt: true, connectedAt: true, directPostAudited: true, token: { select: { expiresAt: true, lastRefreshedAt: true } } },
  });
  return ok({ accounts, platforms: platformStatus() });
});
