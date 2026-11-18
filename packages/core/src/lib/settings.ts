import { prisma } from "./db";

export const SETTING_DEFAULTS = {
  "generation.enabled": true,
  "generation.globalDailyLimit": 3,
  "generation.globalMonthlyLimit": 90,
  "budget.monthlyTargetUsd": 25,
  "budget.monthlyMaxUsd": 50,
  "budget.warnAtPercent": 80,
  "publishing.enabled": true,
  "video.width": 1080,
  "video.height": 1920,
  "video.fps": 30,
  "video.maxSizeMb": 250,
  "media.providerOrder": ["library", "pexels", "pixabay", "ai_image", "generated"],
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof SETTING_DEFAULTS)[K] | any> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as any) : SETTING_DEFAULTS[key];
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.systemSetting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key: SettingKey, value: unknown) {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: value as any },
    create: { key, value: value as any },
  });
}
