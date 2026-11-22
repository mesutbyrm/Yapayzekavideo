import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../lib/errors";

/** Senaryo gibi JSON çıktıları için varsayılan Claude modeli */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Reddedilen istek, kategoriye göre Anthropic'in önerdiği modelde sunucu tarafında yeniden denenir */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Opus 5.5'te düşünme her zaman açık ve max_tokens'tan harcar.
 * JSON yarıda kesilmesin diye çıktı limitinin üstüne pay bırakılır.
 */
const THINKING_HEADROOM = 12_000;

let client: Anthropic | null = null;
let clientKey: string | undefined;
let injected = false;

export function anthropic(apiKey: string): Anthropic {
  if (injected && client) return client;
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });
    clientKey = apiKey;
  }
  return client;
}

/** Testlerde sahte istemci enjekte etmek için */
export function setAnthropicClient(c: Anthropic | null) {
  client = c;
  clientKey = undefined;
  injected = c !== null;
}

export interface ClaudeJsonCall {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  jsonSchema?: Record<string, unknown>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface ClaudeJsonResponse {
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  /** Yanıtı gerçekte üreten model (fallback devreye girdiyse farklı olabilir) */
  model: string;
}

/** Claude'dan tek bir JSON nesnesi ister; kesilme ve reddetme durumlarını ProviderError'a çevirir */
export async function claudeJson(call: ClaudeJsonCall): Promise<ClaudeJsonResponse> {
  const schemaInstruction = call.jsonSchema ? "\nRequired JSON Schema: " + JSON.stringify(call.jsonSchema) : "";
  const system = call.system + "\n\nReturn exactly one valid JSON object and no Markdown." + schemaInstruction;
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await anthropic(call.apiKey).beta.messages.create({
      model: call.model,
      max_tokens: call.maxOutputTokens + THINKING_HEADROOM,
      system,
      messages: [{ role: "user", content: call.user }],
      output_config: { effort: call.effort ?? "medium" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });
  } catch (err) {
    throw toProviderError(err);
  }

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category ?? "unknown";
    throw new ProviderError(`Claude isteği reddetti (${category})`, "anthropic", "REFUSAL", false, undefined, "policy", response.stop_details);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ProviderError("Claude yanıtı token limitinde kesildi", "anthropic", "OUTPUT_TRUNCATED", true, undefined, "validation");
  }

  const rawText = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  return {
    rawText,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
  };
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("Claude API anahtarı geçersiz: " + err.message, "anthropic", "AUTH", false, err.status, "auth");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError("Claude hız limiti: " + err.message, "anthropic", "RATE_LIMIT", true, err.status, "rate_limit");
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new ProviderError("Claude API isteği geçersiz: " + err.message, "anthropic", "BAD_REQUEST", false, err.status, "validation");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("Claude API'ye bağlanılamadı: " + err.message, "anthropic", "CONNECTION", true, undefined, "transient");
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const retryable = status === undefined || status >= 500;
    return new ProviderError("Claude API hatası: " + err.message, "anthropic", "API_ERROR", retryable, status, retryable ? "transient" : "unknown");
  }
  return new ProviderError("Claude API hatası: " + String((err as any)?.message ?? err), "anthropic", "API_ERROR", true, undefined, "unknown");
}
