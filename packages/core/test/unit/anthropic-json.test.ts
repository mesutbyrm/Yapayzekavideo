import { afterEach, describe, expect, it } from "vitest";
import { claudeJson, setAnthropicClient } from "../../src/ai/anthropic";
import { ProviderError } from "../../src/lib/errors";

function fakeClient(response: unknown, capture?: { params?: any }) {
  return {
    beta: {
      messages: {
        create: async (params: any) => {
          if (capture) capture.params = params;
          return response;
        },
      },
    },
  } as any;
}

const base = { apiKey: "test", model: "claude-opus-5-5", system: "sys", user: "usr", maxOutputTokens: 4000 };

describe("Claude JSON çağrısı", () => {
  afterEach(() => setAnthropicClient(null));

  it("Opus 5.5 isteğini düşünme payı, effort ve fallback ile gönderir; metni birleştirir", async () => {
    const capture: { params?: any } = {};
    setAnthropicClient(fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"title":"x"}' }],
      usage: { input_tokens: 10, output_tokens: 20 },
    }, capture));
    const r = await claudeJson(base);
    expect(r.rawText).toBe('{"title":"x"}');
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(20);
    expect(capture.params.model).toBe("claude-opus-5-5");
    expect(capture.params.max_tokens).toBeGreaterThan(4000);
    expect(capture.params.output_config).toEqual({ effort: "medium" });
    expect(capture.params.fallbacks).toBe("default");
    expect(capture.params.betas).toContain("server-side-fallback-2026-07-01");
    expect(capture.params.thinking).toBeUndefined();
  });

  it("token limitinde kesilen yanıtı tekrar denenebilir hata olarak bildirir", async () => {
    setAnthropicClient(fakeClient({ model: "claude-opus-5-5", stop_reason: "max_tokens", content: [{ type: "text", text: '{"a":' }], usage: { input_tokens: 1, output_tokens: 1 } }));
    await expect(claudeJson(base)).rejects.toMatchObject({ code: "OUTPUT_TRUNCATED", retryable: true });
  });

  it("reddetmeyi tekrar denenmeyen policy hatası olarak bildirir", async () => {
    setAnthropicClient(fakeClient({ model: "claude-opus-5-5", stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, content: [], usage: { input_tokens: 1, output_tokens: 0 } }));
    const err = await claudeJson(base).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "REFUSAL", retryable: false, kind: "policy" });
  });
});
