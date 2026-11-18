import { z } from "zod";
import { prisma, audit } from "@asf/core";
import { api, ok } from "@/lib/api";
import { categorySchema } from "@/lib/schemas";


export const GET = api(async ({ req, brand }) => {
  const brandId = req.nextUrl.searchParams.get("brandId") ?? "";
  await brand(brandId);
  return ok({ categories: await prisma.contentCategory.findMany({ where: { brandId }, orderBy: { name: "asc" }, include: { _count: { select: { ideas: true } } } }) });
});

export const POST = api(async ({ json, brand, user, ip }) => {
  const body = await json(categorySchema.extend({ brandId: z.string() }));
  await brand(body.brandId, "write");
  const c = await prisma.contentCategory.create({ data: body });
  await audit({ action: "category.create", userId: user.id, brandId: body.brandId, entityId: c.id, ip });
  return ok({ category: c }, { status: 201 });
});
