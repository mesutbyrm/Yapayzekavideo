import OpenAI from "openai";
import { env } from "../lib/env";
import { NotConfiguredError, ProviderError } from "../lib/errors";
import { assertCanSpend, recordUsage } from "../budget/budget";
import { anthropicCost, openAiCost } from "../budget/pricing";
import { getProviderApiKeys } from "./provider-keys";
import { claudeJson } from "./anthropic";
import { logger } from "../lib/logger";

let client: OpenAI | null = null;
let clientKey: string | undefined;
let injected = false;
export function openai(apiKey: string | undefined = env().OPENAI_API_KEY): OpenAI {
  if (injected && client) return client;
  const key = apiKey;
  if (!key) throw new NotConfiguredError("OpenAI", ["OPENAI_API_KEY"]);
  if (!client || clientKey !== key) { client = new OpenAI({ apiKey: key, timeout: 90_000, maxRetries: 2 }); clientKey = key; }
  return client;
}

const REASONING_HEADROOM = 6000;

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

/** Model JSON'u ```json ... ``` bloğuna sararsa ya da önüne/arkasına metin eklerse yalnızca JSON nesnesini alır */
export function extractJson(raw: string): string {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) return fenced[1];
  if (text.startsWith("{") || text.startsWith("[")) return text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** Testlerde sahte istemci enjekte etmek için */
export function setOpenAiClient(c: OpenAI | null) {
  client = c;
  clientKey = undefined;
  injected = c !== null;
}

export interface JsonChatResult<T> {
  data: T;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
  provider: "OPENAI" | "ANTHROPIC";
}

/**
 * JSON çıktılı sohbet çağrısı. Her çağrıdan önce bütçe kontrol edilir,
 * sonrasında gerçek token kullanımı AIUsageLog'a yazılır.
 */
export async function chatJson<T = unknown>(opts: {
  system: string;
  user: string;
  brandId: string | null;
  videoId?: string | null;
  operation: string;
  schemaName?: string;
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  provider?: "openai" | "anthropic";
}): Promise<JsonChatResult<T>> {
  const settings = env();
  const keys = await getProviderApiKeys();
  const anthropicKey = keys.anthropic ?? settings.ANTHROPIC_API_KEY;
  const openaiKey = keys.openai ?? settings.OPENAI_API_KEY;
  const wanted = keys.activeProvider ?? opts.provider ?? settings.AI_TEXT_PROVIDER;
  const provider = wanted === "anthropic" && anthropicKey ? "anthropic" : "openai";
  if (wanted === "anthropic" && !anthropicKey) {
    logger.warn({ operation: opts.operation }, "Claude seçili ama Anthropic API anahtarı yok; OpenAI kullanılıyor");
  }
  const model = (provider === "anthropic" ? keys.models?.anthropic : keys.models?.openai) ?? (provider === "anthropic" ? settings.ANTHROPIC_MODEL : settings.OPENAI_MODEL);
  const outputLimit = opts.maxOutputTokens ?? 4000;
  const estimatedCost = provider === "anthropic" ? anthropicCost(3000, outputLimit) : openAiCost(3000, outputLimit);
  await assertCanSpend(opts.brandId, estimatedCost, opts.operation);
  let rawText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    if (provider === "anthropic") {
      const r = await claudeJson({ apiKey: anthropicKey!, model, system: opts.system, user: opts.user, maxOutputTokens: outputLimit, jsonSchema: opts.jsonSchema });
      rawText = r.rawText;
      inputTokens = r.inputTokens;
      outputTokens = r.outputTokens;
    } else {
      // Akıl yürüten modeller (gpt-5*, o*) düşünme token'larını da çıktı limitinden harcar; limit dolunca JSON yarıda kesilir.
      // Bu yüzden düşünme düşük tutulur ve bu modellere ek pay verilir.
      const reasoning = isReasoningModel(model);
      const response = await openai(openaiKey).chat.completions.create({
        model,
        messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
        response_format: opts.jsonSchema ? { type: "json_schema", json_schema: { name: opts.schemaName ?? "output", schema: opts.jsonSchema, strict: false } } : { type: "json_object" },
        max_completion_tokens: reasoning ? outputLimit + REASONING_HEADROOM : outputLimit,
        ...(reasoning ? { reasoning_effort: "low" as const } : {}),
      });
      if (response.choices[0]?.finish_reason === "length") {
        throw new ProviderError("OpenAI yanıtı token limitinde kesildi", "openai", "OUTPUT_TRUNCATED", true, undefined, "validation");
      }
      rawText = response.choices[0]?.message?.content ?? "";
      inputTokens = response.usage?.prompt_tokens ?? 0;
      outputTokens = response.usage?.completion_tokens ?? 0;
    }
  } catch (err: any) {
    if (err instanceof ProviderError) throw err;
    const status = err?.status as number | undefined;
    const kind = status === 401 ? "auth" : status === 429 ? "rate_limit" : status === 400 ? "validation" : status && status >= 500 ? "transient" : "unknown";
    throw new ProviderError((provider === "anthropic" ? "Claude" : "OpenAI") + " API error: " + (err?.message ?? err), provider, err?.code ?? err?.type ?? "API_ERROR", status === undefined || status === 429 || status >= 500, status, kind);
  }
  const costUsd = provider === "anthropic" ? anthropicCost(inputTokens, outputTokens) : openAiCost(inputTokens, outputTokens);
  await recordUsage({ brandId: opts.brandId, videoId: opts.videoId, provider: provider === "anthropic" ? "ANTHROPIC" : "OPENAI", operation: opts.operation, model, inputTokens, outputTokens, costUsd });
  let data: T;
  try { data = JSON.parse(extractJson(rawText)) as T; }
  catch { throw new ProviderError((provider === "anthropic" ? "Claude" : "OpenAI") + " geçersiz JSON döndürdü", provider, "INVALID_JSON", true, undefined, "validation", rawText.slice(0, 500)); }
  return { data, rawText, inputTokens, outputTokens, costUsd, model, provider: provider === "anthropic" ? "ANTHROPIC" : "OPENAI" };
}

/** OpenAI Moderation (ücretsiz uç nokta) */
export async function moderate(text: string): Promise<{ flagged: boolean; categories: string[] }> {
  try {
    const keys = await getProviderApiKeys();
    const r = await openai(keys.openai ?? env().OPENAI_API_KEY).moderations.create({ model: env().OPENAI_MODERATION_MODEL, input: text });
    const result = r.results[0];
    const categories = Object.entries(result?.categories ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    return { flagged: !!result?.flagged, categories };
  } catch (err: any) {
    throw new ProviderError(`Moderasyon hatası: ${err?.message ?? err}`, "openai", "MODERATION_FAILED", true);
  }
}
