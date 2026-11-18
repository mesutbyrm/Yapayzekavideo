import { env } from "../lib/env";

export function openAiCost(inputTokens: number, outputTokens: number) {
  const e = env();
  return (inputTokens / 1e6) * e.OPENAI_INPUT_PRICE_PER_1M + (outputTokens / 1e6) * e.OPENAI_OUTPUT_PRICE_PER_1M;
}

export function ttsCost(characters: number) {
  return (characters / 1e6) * env().GOOGLE_TTS_PRICE_PER_1M_CHARS;
}

export function storageCostPerMonth(bytes: number) {
  return (bytes / 1024 ** 3) * env().R2_PRICE_PER_GB_MONTH;
}

/** Bir video için tahmini ücretli maliyet (bütçe ön kontrolü) */
export function estimateVideoCost(opts: { narrationChars?: number; aiImages?: number } = {}) {
  const llm = openAiCost(4000, 2500) * 2; // fikir + senaryo (+ olası yeniden deneme)
  const tts = ttsCost(opts.narrationChars ?? 600);
  const img = (opts.aiImages ?? 0) * env().AI_IMAGE_PRICE_USD;
  return llm + tts + img;
}
