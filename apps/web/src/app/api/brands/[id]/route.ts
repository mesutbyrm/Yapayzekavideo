import { prisma, audit, ensureDefaultSchedules, Prisma, AppError } from "@asf/core";
import { api, ok } from "@/lib/api";
import { brandSchema } from "@/lib/schemas";

export const GET = api(async ({ params, brand }) => {
  const id = String(params.id);
  await brand(id);
  const b = await prisma.brand.findUniqueOrThrow({ where: { id }, include: { schedules: true, categories: true } });
  return ok({ brand: b });
});

export const PATCH = api(async ({ params, brand, json, user, ip }) => {
  const id = String(params.id);
  await brand(id, "write");
  const body = await json(brandSchema.partial());
  if (body.minDurationSec && body.maxDurationSec && body.minDurationSec >= body.maxDurationSec) throw new AppError("Minimum süre maksimumdan küçük olmalı", "VALIDATION", 400);
  const { monthlyBudgetUsd, maxBudgetUsd, website, ...rest } = body;
  const b = await prisma.brand.update({
    where: { id },
    data: {
      ...rest,
      ...(website !== undefined ? { website: website || null } : {}),
      ...(monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: new Prisma.Decimal(monthlyBudgetUsd) } : {}),
      ...(maxBudgetUsd !== undefined ? { maxBudgetUsd: new Prisma.Decimal(maxBudgetUsd) } : {}),
    },
  });
  if (body.publishTimes) await ensureDefaultSchedules(id, body.publishTimes);
  await audit({ action: "brand.update", userId: user.id, brandId: id, ip, metadata: { fields: Object.keys(body) } });
  return ok({ brand: b });
});

export const DELETE = api(async ({ params, brand, user, ip }) => {
  const id = String(params.id);
  await brand(id, "admin");
  await audit({ action: "brand.delete", userId: user.id, brandId: null, ip, metadata: { brandId: id } });
  await prisma.brand.delete({ where: { id } });
  return ok({ ok: true });
});
