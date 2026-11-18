import { prisma } from "../lib/db";
import { getSetting } from "../lib/settings";
import { dayRange, monthRange } from "../lib/time";

const COUNTED = { notIn: ["FAILED", "CANCELLED", "QC_FAILED"] as any };

export interface LimitStatus {
  allowed: boolean;
  reason?: string;
  brandToday: number;
  brandMonth: number;
  brandDailyLimit: number;
  brandMonthlyLimit: number;
  globalToday: number;
  globalMonth: number;
  globalDailyLimit: number;
  globalMonthlyLimit: number;
}

/** Günlük/aylık üretim limitleri (marka + sistem geneli) */
export async function generationLimits(brandId: string, at = new Date()): Promise<LimitStatus> {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
  const day = dayRange(brand.timezone, at);
  const month = monthRange(brand.timezone, at);
  const [brandToday, brandMonth, globalToday, globalMonth] = await Promise.all([
    prisma.video.count({ where: { brandId, createdAt: { gte: day.start, lte: day.end }, status: COUNTED } }),
    prisma.video.count({ where: { brandId, createdAt: { gte: month.start, lte: month.end }, status: COUNTED } }),
    prisma.video.count({ where: { createdAt: { gte: day.start, lte: day.end }, status: COUNTED } }),
    prisma.video.count({ where: { createdAt: { gte: month.start, lte: month.end }, status: COUNTED } }),
  ]);
  const globalDailyLimit = Number(await getSetting("generation.globalDailyLimit"));
  const globalMonthlyLimit = Number(await getSetting("generation.globalMonthlyLimit"));
  const s: LimitStatus = {
    allowed: true,
    brandToday,
    brandMonth,
    brandDailyLimit: brand.dailyVideoTarget,
    brandMonthlyLimit: brand.monthlyVideoTarget,
    globalToday,
    globalMonth,
    globalDailyLimit,
    globalMonthlyLimit,
  };
  if (!(await getSetting("generation.enabled"))) return { ...s, allowed: false, reason: "Üretim sistem ayarlarından durduruldu" };
  if (!brand.isActive) return { ...s, allowed: false, reason: "Marka pasif" };
  if (brandToday >= brand.dailyVideoTarget) return { ...s, allowed: false, reason: `Marka günlük limiti doldu (${brandToday}/${brand.dailyVideoTarget})` };
  if (brandMonth >= brand.monthlyVideoTarget) return { ...s, allowed: false, reason: `Marka aylık limiti doldu (${brandMonth}/${brand.monthlyVideoTarget})` };
  if (globalToday >= globalDailyLimit) return { ...s, allowed: false, reason: `Sistem günlük limiti doldu (${globalToday}/${globalDailyLimit})` };
  if (globalMonth >= globalMonthlyLimit) return { ...s, allowed: false, reason: `Sistem aylık limiti doldu (${globalMonth}/${globalMonthlyLimit})` };
  return s;
}
