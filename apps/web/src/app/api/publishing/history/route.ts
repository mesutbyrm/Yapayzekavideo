import { prisma, accessibleBrandIds } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ user, req }) => {
  const ids = await accessibleBrandIds(user);
  const sp = req.nextUrl.searchParams;
  const brandId = sp.get("brandId");
  const platform = sp.get("platform");
  const success = sp.get("success");
  const results = await prisma.publishResult.findMany({
    where: { brandId: brandId && ids.includes(brandId) ? brandId : { in: ids }, ...(platform ? { platform: platform as any } : {}), ...(success ? { success: success === "true" } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, platform: true, success: true, externalPostId: true, postUrl: true, privacy: true, errorCode: true, errorMessage: true, attempt: true, createdAt: true, video: { select: { id: true, title: true } }, socialAccount: { select: { displayName: true } } },
  });
  return ok({ results });
});
