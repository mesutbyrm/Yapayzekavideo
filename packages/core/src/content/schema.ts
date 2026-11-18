import { z } from "zod";

export const sceneSchema = z.object({
  duration: z.number().min(1.5).max(12),
  visual_description: z.string().min(3).max(400),
  /** Stok medya araması için İngilizce anahtar kelimeler */
  search_keywords: z.array(z.string().min(2)).min(1).max(6).optional(),
  subtitle: z.string().min(1).max(160),
});

const platformMeta = z
  .object({
    title: z.string().max(150).optional(),
    caption: z.string().max(2200).optional(),
    description: z.string().max(5000).optional(),
    hashtags: z.array(z.string()).max(30).optional(),
  })
  .passthrough();

export const scriptSchema = z.object({
  title: z.string().min(5).max(100),
  hook: z.string().min(5).max(200),
  narration: z.string().min(60).max(900),
  scenes: z.array(sceneSchema).min(3).max(10),
  cta: z.string().min(3).max(120),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u, "Hashtag # ile başlamalı ve boşluk içermemeli")).min(3).max(15),
  platform_metadata: z.object({
    instagram: platformMeta,
    facebook: platformMeta,
    tiktok: platformMeta,
    youtube: platformMeta,
  }),
  /** Model tarafından beyan edilen doğrulanabilirlik notu */
  fact_check_notes: z.string().max(600).optional(),
});

export type VideoScriptJson = z.infer<typeof scriptSchema>;

/** OpenAI structured output için JSON Schema */
export const scriptJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "hook", "narration", "scenes", "cta", "hashtags", "platform_metadata", "fact_check_notes"],
  properties: {
    title: { type: "string" },
    hook: { type: "string" },
    narration: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["duration", "visual_description", "search_keywords", "subtitle"],
        properties: {
          duration: { type: "number" },
          visual_description: { type: "string" },
          search_keywords: { type: "array", items: { type: "string" } },
          subtitle: { type: "string" },
        },
      },
    },
    cta: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    platform_metadata: {
      type: "object",
      additionalProperties: false,
      required: ["instagram", "facebook", "tiktok", "youtube"],
      properties: Object.fromEntries(
        ["instagram", "facebook", "tiktok", "youtube"].map((p) => [
          p,
          {
            type: "object",
            additionalProperties: false,
            required: ["title", "caption", "description", "hashtags"],
            properties: {
              title: { type: "string" },
              caption: { type: "string" },
              description: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
            },
          },
        ]),
      ),
    },
    fact_check_notes: { type: "string" },
  },
} as const;

export const ideasSchema = z.object({
  ideas: z
    .array(
      z.object({
        topic: z.string().min(5).max(160),
        angle: z.string().max(300).optional(),
        category: z.string().max(80).optional(),
        why_now: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const ideasJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "angle", "category", "why_now"],
        properties: {
          topic: { type: "string" },
          angle: { type: "string" },
          category: { type: "string" },
          why_now: { type: "string" },
        },
      },
    },
  },
} as const;

/** Toplam sahne süresinin hedef aralıkta olup olmadığını ve anlatımın süreye sığıp sığmadığını kontrol eder */
export function validateTiming(s: VideoScriptJson, minSec: number, maxSec: number): string[] {
  const errors: string[] = [];
  const total = s.scenes.reduce((a, b) => a + b.duration, 0);
  if (total < minSec || total > maxSec) errors.push(`Toplam sahne süresi ${total.toFixed(1)} sn; ${minSec}-${maxSec} sn olmalı`);
  const words = s.narration.trim().split(/\s+/).length;
  // Türkçe ortalama konuşma hızı ~2.3-2.8 kelime/sn
  const estSec = words / 2.5;
  if (estSec > maxSec + 2) errors.push(`Anlatım çok uzun (~${estSec.toFixed(0)} sn, ${words} kelime)`);
  if (estSec < minSec * 0.6) errors.push(`Anlatım çok kısa (~${estSec.toFixed(0)} sn, ${words} kelime)`);
  if (!s.narration.toLocaleLowerCase("tr").includes(s.hook.toLocaleLowerCase("tr").slice(0, 15))) {
    errors.push("Anlatım hook cümlesi ile başlamalı");
  }
  return errors;
}
