import { prisma, accessibleBrandIds } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ user, req }) => {
  const sp = req.nextUrl.searchParams;
  const ids = await accessibleBrandIds(user);
  const brandId = sp.get("brandId");
  const status = sp.get("status");
  const take = Math.min(100, Number(sp.get("take") ?? 30));
  const cursor = sp.get("cursor");
  const videos = await prisma.video.findMany({
    where: { brandId: brandId && ids.includes(brandId) ? brandId : { in: ids }, ...(status ? { status: status as any } : {}) },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, brandId: true, title: true, status: true, durationSec: true, sizeBytes: true, qcPassed: true, costUsd: true, scheduleSlot: true, createdAt: true, errorMessage: true, thumbnailKey: true, trigger: true },
  });
  const next = videos.length > take ? videos.pop()!.id : null;
  return ok({ videos, nextCursor: next });
});
