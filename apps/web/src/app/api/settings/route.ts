import { z } from "zod";
import { getAllSettings, setSetting, audit, SETTING_DEFAULTS, type SettingKey } from "@asf/core";
import { api, ok } from "@/lib/api";

const schema = z.object({
  "generation.enabled": z.boolean(),
  "generation.globalDailyLimit": z.number().int().min(0).max(500),
  "generation.globalMonthlyLimit": z.number().int().min(0).max(15000),
  "budget.monthlyTargetUsd": z.number().min(0).max(100000),
  "budget.monthlyMaxUsd": z.number().min(0).max(100000),
  "budget.warnAtPercent": z.number().int().min(10).max(100),
  "publishing.enabled": z.boolean(),
  "video.maxSizeMb": z.number().int().min(10).max(1000),
  "media.providerOrder": z.array(z.enum(["library", "pexels", "pixabay", "ai_image", "generated"])).min(1),
}).partial();

export const GET = api(async () => ok({ settings: await getAllSettings(), defaults: SETTING_DEFAULTS }));

export const PATCH = api(async ({ json, user, ip }) => {
  const body = await json(schema);
  for (const [k, v] of Object.entries(body)) await setSetting(k as SettingKey, v);
  await audit({ action: "settings.update", userId: user.id, ip, metadata: body });
  return ok({ settings: await getAllSettings() });
}, { admin: true });
