import { prisma, audit } from "@asf/core";
import { api, ok } from "@/lib/api";
import { scheduleSchema } from "@/lib/schemas";

export const GET = api(async ({ params, brand }) => {
  const id = String(params.id);
  await brand(id);
  return ok({ schedules: await prisma.schedule.findMany({ where: { brandId: id }, orderBy: { time: "asc" } }) });
});

/** Yayın saatlerini toplu günceller (Europe/Istanbul yerel saat) */
export const PUT = api(async ({ params, brand, json, user, ip }) => {
  const id = String(params.id);
  await brand(id, "write");
  const { schedules } = await json(scheduleSchema);
  const times = schedules.map((s) => s.time);
  await prisma.$transaction([
    prisma.schedule.deleteMany({ where: { brandId: id, time: { notIn: times } } }),
    ...schedules.map((s) => prisma.schedule.upsert({ where: { brandId_time: { brandId: id, time: s.time } }, update: s, create: { ...s, brandId: id } })),
    prisma.brand.update({ where: { id }, data: { publishTimes: schedules.filter((s) => s.isActive).map((s) => s.time).sort() } }),
  ]);
  await audit({ action: "schedule.update", userId: user.id, brandId: id, ip, metadata: { times } });
  return ok({ schedules: await prisma.schedule.findMany({ where: { brandId: id }, orderBy: { time: "asc" } }) });
});
