import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { AppError, BudgetExceededError } from "../lib/errors";
import { localDateISO, localSlot, localWeekday } from "../lib/time";
import { enqueueGeneration } from "./generate";

/**
 * Her dakika çalışır. Her aktif marka ve her aktif yayın saati için,
 * yayın saatinden leadMinutes önce video üretimini başlatır.
 * (brandId, scheduleSlot) benzersiz kısıtı aynı slot için ikinci üretimi engeller.
 */
export async function schedulerTick(now = new Date()) {
  const brands = await prisma.brand.findMany({ where: { isActive: true, autoGenerate: true }, include: { schedules: { where: { isActive: true } } } });
  const started: string[] = [];
  for (const brand of brands) {
    const today = localDateISO(now, brand.timezone);
    const weekday = localWeekday(today, brand.timezone);
    for (const s of brand.schedules) {
      if (!s.weekdays.includes(weekday)) continue;
      const slot = localSlot(today, s.time, brand.timezone);
      const startAt = new Date(slot.getTime() - s.leadMinutes * 60_000);
      // Pencere: [slot - lead, slot + 30 dk] – sunucu kısa süreli kapalıysa telafi eder
      if (now < startAt || now.getTime() > slot.getTime() + 30 * 60_000) continue;
      const exists = await prisma.video.findUnique({ where: { brandId_scheduleSlot: { brandId: brand.id, scheduleSlot: slot } } });
      if (exists) continue;
      try {
        const v = await enqueueGeneration(brand.id, { scheduleSlot: slot, trigger: "auto" });
        started.push(v.id);
        logger.info({ brand: brand.slug, slot: slot.toISOString() }, "otomatik üretim başlatıldı");
      } catch (err) {
        if (err instanceof AppError && ["LIMIT_REACHED", "DUPLICATE_SLOT"].includes(err.code)) continue;
        if (err instanceof BudgetExceededError) {
          logger.warn({ brand: brand.slug }, "bütçe sınırı – otomatik üretim atlandı");
          continue;
        }
        logger.error({ brand: brand.slug, err: (err as Error).message }, "otomatik üretim başlatılamadı");
      }
    }
  }
  return started;
}

/** Varsayılan yayın saatlerini (10:00, 15:00, 20:00) markaya uygular */
export async function ensureDefaultSchedules(brandId: string, times: string[]) {
  for (const time of times) {
    await prisma.schedule.upsert({ where: { brandId_time: { brandId, time } }, update: { isActive: true }, create: { brandId, time } });
  }
  await prisma.schedule.updateMany({ where: { brandId, time: { notIn: times } }, data: { isActive: false } });
}
