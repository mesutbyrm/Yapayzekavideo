import { prisma, accessibleBrandIds, audit, ensureDefaultSchedules, Prisma } from "@asf/core";
import { api, ok } from "@/lib/api";
import { brandSchema, slugify } from "@/lib/schemas";

export const GET = api(async ({ user }) => {
  const ids = await accessibleBrandIds(user);
  const brands = await prisma.brand.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" }, include: { _count: { select: { socialAccounts: true, videos: true } } } });
  return ok({ brands });
});

export const POST = api(async ({ user, json, ip }) => {
  const body = await json(brandSchema);
  let slug = slugify(body.name);
  if (await prisma.brand.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  const { publishTimes, monthlyBudgetUsd, maxBudgetUsd, website, ...rest } = body;
  const brand = await prisma.brand.create({
    data: {
      ...rest,
      website: website || null,
      slug,
      publishTimes: publishTimes ?? ["10:00", "15:00", "20:00"],
      monthlyBudgetUsd: monthlyBudgetUsd !== undefined ? new Prisma.Decimal(monthlyBudgetUsd) : undefined,
      maxBudgetUsd: maxBudgetUsd !== undefined ? new Prisma.Decimal(maxBudgetUsd) : undefined,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  await ensureDefaultSchedules(brand.id, brand.publishTimes);
  await audit({ action: "brand.create", userId: user.id, brandId: brand.id, ip });
  return ok({ brand }, { status: 201 });
});
