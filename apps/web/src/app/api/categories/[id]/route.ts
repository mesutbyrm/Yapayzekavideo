import { prisma, audit } from "@asf/core";
import { api, ok } from "@/lib/api";
import { categorySchema } from "@/lib/schemas";

export const PATCH = api(async ({ params, json, brand, user, ip }) => {
  const c = await prisma.contentCategory.findUniqueOrThrow({ where: { id: String(params.id) } });
  await brand(c.brandId, "write");
  const body = await json(categorySchema.partial());
  await audit({ action: "category.update", userId: user.id, brandId: c.brandId, entityId: c.id, ip });
  return ok({ category: await prisma.contentCategory.update({ where: { id: c.id }, data: body }) });
});

export const DELETE = api(async ({ params, brand, user, ip }) => {
  const c = await prisma.contentCategory.findUniqueOrThrow({ where: { id: String(params.id) } });
  await brand(c.brandId, "write");
  await prisma.contentCategory.delete({ where: { id: c.id } });
  await audit({ action: "category.delete", userId: user.id, brandId: c.brandId, entityId: c.id, ip });
  return ok({ ok: true });
});
