import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat HH:mm formatında olmalı");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB olmalı");

export const brandSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(1000).nullish(),
  website: z.string().url().max(300).nullish().or(z.literal("")),
  language: z.string().min(2).max(10).default("tr-TR"),
  targetAudience: z.string().max(500).nullish(),
  primaryColor: color.optional(),
  secondaryColor: color.optional(),
  accentColor: color.optional(),
  fontFamily: z.string().max(60).optional(),
  voiceName: z.string().max(60).optional(),
  voiceGender: z.enum(["MALE", "FEMALE"]).optional(),
  speakingRate: z.number().min(0.7).max(1.4).optional(),
  voicePitch: z.number().min(-10).max(10).optional(),
  videoTemplate: z.string().max(40).optional(),
  dailyVideoTarget: z.number().int().min(0).max(50).optional(),
  monthlyVideoTarget: z.number().int().min(0).max(1500).optional(),
  minDurationSec: z.number().int().min(5).max(170).optional(),
  maxDurationSec: z.number().int().min(6).max(180).optional(),
  publishTimes: z.array(hhmm).max(24).optional(),
  timezone: z.string().max(60).optional(),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
  contentRules: z.string().max(4000).nullish(),
  monthlyBudgetUsd: z.number().min(0).max(10000).optional(),
  maxBudgetUsd: z.number().min(0).max(10000).optional(),
  autoGenerate: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
  musicEnabled: z.boolean().optional(),
  musicVolume: z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
});

export const scheduleSchema = z.object({
  schedules: z.array(
    z.object({
      time: hhmm,
      weekdays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5, 6, 7]),
      platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"])).min(1),
      leadMinutes: z.number().int().min(15).max(720).default(120),
      isActive: z.boolean().default(true),
    }),
  ).max(24),
});

export function slugify(s: string) {
  return (
    s
      .toLocaleLowerCase("tr")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "marka"
  );
}

export const categorySchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).nullish(),
  keywords: z.array(z.string().max(40)).max(20).default([]),
  weight: z.number().int().min(0).max(10).default(1),
  isActive: z.boolean().default(true),
});
