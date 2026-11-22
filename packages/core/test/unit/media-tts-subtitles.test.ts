import { describe, expect, it } from "vitest";
import { assColor, buildAss, groupWords } from "../../src/video/subtitles";
import { buildSsml, proportionalTimings, timingsFromMarks, splitWords } from "../../src/tts/google";
import { baseValidate } from "../../src/publishers/types";
import { openAiCost, ttsCost, estimateVideoCost } from "../../src/budget/pricing";

describe("altyazı", () => {
  const words = proportionalTimings(splitWords("Biliyor muydun? Ahtapotların üç kalbi var ve kanları mavidir."), 6);
  it("mobil için en fazla 4 kelime / 22 karakter gruplar ve noktalamada keser", () => {
    const cues = groupWords(words);
    expect(cues[0].text).toBe("Biliyor muydun?");
    for (const c of cues) {
      expect(c.text.split(" ").length).toBeLessThanOrEqual(4);
      expect(c.end).toBeGreaterThan(c.start);
    }
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end - 1e-9);
  });
  it("renkleri ASS biçimine çevirir ve geçerli ASS üretir", () => {
    expect(assColor("#FF0000")).toBe("&H000000FF");
    const ass = buildAss({ font: "DejaVu Sans", primaryColor: "#7C3AED", accentColor: "#F59E0B", captions: groupWords(words), headlines: [] });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    const caption = ass.split("\n").find((l) => l.includes(",Caption,"))!;
    // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text → metin 10. alandan başlar
    expect(caption).toMatch(/^Dialogue: 2,[^,]+,[^,]+,Caption,,0,0,0,,/);
    expect(caption.replace(/\{[^}]*\}/g, "")).toMatch(/BİLİYOR MUYDUN\?/);
  });
});

describe("TTS yardımcıları", () => {
  it("her kelimeye SSML mark ekler ve XML kaçışı yapar", () => {
    const { ssml, words } = buildSsml("A & B <test>");
    expect(words).toEqual(["A", "&", "B", "<test>"]);
    expect(ssml).toContain('<mark name="w1"/>&amp;');
    expect(ssml).toContain("&lt;test&gt;");
  });
  it("mark zamanlarından kelime aralıkları üretir", () => {
    const t = timingsFromMarks(["a", "b"], [{ markName: "w0", timeSeconds: 0.1 }, { markName: "w1", timeSeconds: 0.6 }], 1.2);
    expect(t).toEqual([{ word: "a", start: 0.1, end: 0.6 }, { word: "b", start: 0.6, end: 1.2 }]);
  });
});

describe("platform medya kuralları", () => {
  const rules = { minDurationSec: 3, maxDurationSec: 90, maxSizeBytes: 100 * 1024 * 1024, aspect: "9:16" as const };
  it("1080x1920 30fps 24 sn videoyu kabul eder", () => {
    expect(baseValidate({ sizeBytes: 8e6, durationSec: 24, width: 1080, height: 1920, fps: 30 }, rules)).toEqual([]);
  });
  it("yatay, uzun ve büyük videoyu reddeder", () => {
    expect(baseValidate({ sizeBytes: 2e9, durationSec: 200, width: 1920, height: 1080, fps: 30 }, rules)).toHaveLength(3);
  });
});

describe("maliyet hesapları", () => {
  it("OpenAI ve TTS maliyetini fiyat tablosuna göre hesaplar", () => {
    expect(openAiCost(1_000_000, 0)).toBeCloseTo(0.25);
    expect(openAiCost(0, 1_000_000)).toBeCloseTo(2.0);
    expect(ttsCost(1_000_000)).toBeGreaterThan(0);
    expect(estimateVideoCost({ narrationChars: 1000 })).toBeGreaterThan(0);
  });
});
