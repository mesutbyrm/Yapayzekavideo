import OpenAI from "openai";
import { env } from "../lib/env";
import { NotConfiguredError, ProviderError } from "../lib/errors";
import { assertCanSpend, recordUsage } from "../budget/budget";
import { openAiCost } from "../budget/pricing";

let client: OpenAI | null = null;
export function openai(): OpenAI {
  const key = env().OPENAI_API_KEY;
  if (!key) throw new NotConfiguredError("OpenAI", ["OPENAI_API_KEY"]);
  client ??= new OpenAI({ apiKey: key, timeout: 90_000, maxRetries: 2 });
  return client;
}

/** Testlerde sahte istemci enjekte etmek için */
export function setOpenAiClient(c: OpenAI | null) {
  client = c;
}

export interface JsonChatResult<T> {
  data: T;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
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
}): Promise<JsonChatResult<T>> {
  const model = env().OPENAI_MODEL;
  await assertCanSpend(opts.brandId, openAiCost(3000, opts.maxOutputTokens ?? 2500), opts.operation);
  let res;
  try {
    res = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: opts.jsonSchema
        ? { type: "json_schema", json_schema: { name: opts.schemaName ?? "output", schema: opts.jsonSchema, strict: false } }
        : { type: "json_object" },
      max_completion_tokens: opts.maxOutputTokens ?? 4000,
    });
  } catch (err: any) {
    const status = err?.status as number | undefined;
    throw new ProviderError(
      `OpenAI hatası: ${err?.message ?? err}`,
      "openai",
      err?.code ?? `HTTP_${status ?? "ERR"}`,
      status === undefined || status === 429 || status >= 500,
      status,
      status === 429 ? "rate_limit" : status === 401 ? "auth" : "transient",
    );
  }
  const inputTokens = res.usage?.prompt_tokens ?? 0;
  const outputTokens = res.usage?.completion_tokens ?? 0;
  const costUsd = openAiCost(inputTokens, outputTokens);
  await recordUsage({
    brandId: opts.brandId,
    videoId: opts.videoId,
    provider: "OPENAI",
    operation: opts.operation,
    model: res.model ?? model,
    inputTokens,
    outputTokens,
    costUsd,
  });
  const rawText = res.choices[0]?.message?.content ?? "";
  let data: T;
  try {
    data = JSON.parse(rawText) as T;
  } catch {
    throw new ProviderError("OpenAI geçersiz JSON döndürdü", "openai", "INVALID_JSON", true, undefined, "validation", rawText.slice(0, 500));
  }
  return { data, rawText, inputTokens, outputTokens, costUsd, model: res.model ?? model };
}

/** OpenAI Moderation (ücretsiz uç nokta) */
export async function moderate(text: string): Promise<{ flagged: boolean; categories: string[] }> {
  try {
    const r = await openai().moderations.create({ model: env().OPENAI_MODERATION_MODEL, input: text });
    const result = r.results[0];
    const categories = Object.entries(result?.categories ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    return { flagged: !!result?.flagged, categories };
  } catch (err: any) {
    throw new ProviderError(`Moderasyon hatası: ${err?.message ?? err}`, "openai", "MODERATION_FAILED", true);
  }
}
