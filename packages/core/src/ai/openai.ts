import OpenAI from "openai";
import { env } from "../lib/env";
import { NotConfiguredError, ProviderError } from "../lib/errors";
import { assertCanSpend, recordUsage } from "../budget/budget";
import { anthropicCost, openAiCost } from "../budget/pricing";
import { getProviderApiKeys } from "./provider-keys";

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
  const provider = (keys.activeProvider ?? opts.provider ?? settings.AI_TEXT_PROVIDER) === "anthropic" && anthropicKey ? "anthropic" : "openai";
  const model = (provider === "anthropic" ? keys.models?.anthropic : keys.models?.openai) ?? (provider === "anthropic" ? settings.ANTHROPIC_MODEL : settings.OPENAI_MODEL);
  const outputLimit = opts.maxOutputTokens ?? 4000;
  const estimatedCost = provider === "anthropic" ? anthropicCost(3000, outputLimit) : openAiCost(3000, outputLimit);
  await assertCanSpend(opts.brandId, estimatedCost, opts.operation);
  let rawText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    if (provider === "anthropic") {
      const schemaInstruction = opts.jsonSchema ? " Required JSON Schema: " + JSON.stringify(opts.jsonSchema) : "";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: outputLimit, system: opts.system + String.fromCharCode(10, 10) + "Return exactly one valid JSON object and no Markdown." + schemaInstruction, messages: [{ role: "user", content: opts.user }] }),
        signal: AbortSignal.timeout(90_000),
      });
      const payload = await response.json() as any;
      if (!response.ok) {
        const status = response.status;
        const kind = status === 401 || status === 403 ? "auth" : status === 429 ? "rate_limit" : status === 400 ? "validation" : status >= 500 ? "transient" : "unknown";
        throw new ProviderError("Claude API error: " + (payload?.error?.message ?? response.statusText), "anthropic", payload?.error?.type ?? "ANTHROPIC_ERROR", status === 429 || status >= 500, status, kind);
      }
      rawText = (payload?.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join(String.fromCharCode(10));
      inputTokens = Number(payload?.usage?.input_tokens ?? 0);
      outputTokens = Number(payload?.usage?.output_tokens ?? 0);
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
