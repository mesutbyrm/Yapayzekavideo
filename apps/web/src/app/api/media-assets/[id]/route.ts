import { prisma, storage, audit, AppError } from "@asf/core";
import { api, ok } from "@/lib/api";

export const DELETE = api(async ({ params, brand, user, ip }) => {
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: String(params.id) } });
  if (!a.brandId) throw new AppError("Paylaşılan kütüphane varlıkları yalnızca yönetici tarafından silinebilir", "FORBIDDEN", 403);
  await brand(a.brandId, "write");
  if (a.storageKey && a.source !== "STOCK") await storage().delete(a.storageKey).catch(() => undefined);
  await prisma.mediaAsset.delete({ where: { id: a.id } });
  await audit({ action: "media.delete", userId: user.id, brandId: a.brandId, entity: "MediaAsset", entityId: a.id, ip });
  return ok({ ok: true });
});
