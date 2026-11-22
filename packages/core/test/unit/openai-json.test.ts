import { describe, expect, it } from "vitest";
import { extractJson, isReasoningModel } from "../../src/ai/openai";

describe("AI JSON yanıt ayrıştırma", () => {
  it("```json bloklarını ve çevresindeki metni temizler", () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(JSON.parse(extractJson('İşte sonuç:\n{"a":{"b":2}}\nUmarım yardımcı olur.'))).toEqual({ a: { b: 2 } });
    expect(extractJson(' {"a":1} ')).toBe('{"a":1}');
  });
  it("akıl yürüten modelleri tanır", () => {
    expect(isReasoningModel("gpt-5-mini")).toBe(true);
    expect(isReasoningModel("o4-mini")).toBe(true);
    expect(isReasoningModel("gpt-4.1-mini")).toBe(false);
  });
});
