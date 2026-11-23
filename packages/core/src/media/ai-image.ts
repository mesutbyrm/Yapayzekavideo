import { writeFile } from "node:fs/promises";
import { env } from "../lib/env";
import { openai } from "../ai/openai";
import { assertCanSpend, recordUsage } from "../budget/budget";
import { ProviderError } from "../lib/errors";

/**
 * OpenAI görsel üretimi (ücretli; AI_IMAGES_ENABLED=true ise ve bütçe uygunsa).
 * Üretilen görsel video montajında Ken Burns efektiyle hareketlendirilir.
 */
export function aiImagesEnabled() {
  return !!env().AI_IMAGES_ENABLED && !!env().OPENAI_API_KEY;
}

/** Şablona göre görsel üslubu. shorts3d: referans videolardaki parlak, sevimli 3D karakter görünümü */
export function aiImagePrompt(prompt: string, style?: { template?: string; primaryColor?: string }) {
  if (style?.template === "shorts3d") {
    return `${prompt}. Cute stylized 3D render in a Pixar / Blender toy style: one main character or object, glossy soft plastic materials, big expressive eyes if it is a character, centered in the middle of the frame with empty space above and below, soft studio lighting, smooth bright gradient background in the color ${style.primaryColor ?? "#7C3AED"} with soft bokeh light dots, vertical 9:16 composition, no text, no letters, no logos, no watermarks, no real identifiable people.`;
  }
  return `${prompt}. Vertical 9:16 composition, photorealistic, no text, no logos, no watermarks, no real identifiable people.`;
}

export async function generateAiImage(prompt: string, outPath: string, ctx: { brandId: string; videoId?: string | null; template?: string; primaryColor?: string }) {
  const e = env();
  await assertCanSpend(ctx.brandId, e.AI_IMAGE_PRICE_USD, "media.ai_image");
  let res;
  try {
    res = await openai().images.generate({
      model: e.OPENAI_IMAGE_MODEL,
      prompt: aiImagePrompt(prompt, ctx),
      size: "1024x1536",
      n: 1,
      quality: "low",
    } as any);
  } catch (err: any) {
    throw new ProviderError(`AI görsel hatası: ${err?.message ?? err}`, "openai", "IMAGE_FAILED", (err?.status ?? 500) >= 500);
  }
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError("AI görsel boş döndü", "openai", "IMAGE_EMPTY", true);
  await writeFile(outPath, Buffer.from(b64, "base64"));
  await recordUsage({ brandId: ctx.brandId, videoId: ctx.videoId, provider: "AI_IMAGE", operation: "media.ai_image", model: e.OPENAI_IMAGE_MODEL, units: 1, costUsd: e.AI_IMAGE_PRICE_USD });
  return { width: 1024, height: 1536 };
}
