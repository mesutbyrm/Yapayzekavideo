import { prisma, storage, audit, AppError } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ params, brand }) => {
  const v = await prisma.video.findUniqueOrThrow({
    where: { id: String(params.id) },
    include: { script: true, publishJobs: { include: { socialAccount: { select: { displayName: true, platform: true } } } }, publishResults: { orderBy: { createdAt: "desc" } }, usageLogs: true },
  });
  await brand(v.brandId);
  return ok({ video: v });
});

export const DELETE = api(async ({ params, brand, user, ip }) => {
  const v = await prisma.video.findUniqueOrThrow({ where: { id: String(params.id) } });
  await brand(v.brandId, "write");
  if (["SCRIPTING", "FETCHING_MEDIA", "VOICING", "RENDERING", "QUALITY_CHECK", "PUBLISHING"].includes(v.status)) throw new AppError("İşlenen video silinemez", "INVALID_STATE", 409);
  if (v.storageKey) await storage().delete(v.storageKey).catch(() => undefined);
  if (v.thumbnailKey) await storage().delete(v.thumbnailKey).catch(() => undefined);
  await prisma.video.update({ where: { id: v.id }, data: { status: "CANCELLED", storageKey: null, thumbnailKey: null } });
  await prisma.publishJob.updateMany({ where: { videoId: v.id, status: { in: ["PENDING", "SCHEDULED", "AWAITING_CONSENT"] } }, data: { status: "CANCELLED" } });
  await audit({ action: "video.delete", userId: user.id, brandId: v.brandId, entity: "Video", entityId: v.id, ip });
  return ok({ ok: true });
});
