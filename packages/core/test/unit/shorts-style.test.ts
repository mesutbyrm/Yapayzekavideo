import { describe, expect, it } from "vitest";
import { buildShortsAss, colorWords, COLORS, layoutCaption, mix, roundedRect, splitCover, buildShortsCaptions, shortsFontsDir } from "../../src/video/shorts-style";
import { aiImagePrompt } from "../../src/media/ai-image";
import { scriptSystem } from "../../src/content/prompts";
import { proportionalTimings, splitWords } from "../../src/tts/google";

const words = proportionalTimings(splitWords("2017'de MIT'li araştırmacılar oyuncak bir kaplumbağayı tüfek gibi gösterdi. Yorumlara yazın!"), 8);

describe("shorts3d stili", () => {
  it("anahtar kelimeleri sarı, uyarı kelimelerini kırmızı boyar (Türkçe ekleri tanır)", () => {
    const c = colorWords(["Bu", "kaplumbağayı", "tüfek", "sandı"], { yellow: ["kaplumbağa"], red: ["tüfek"] }, true);
    expect(c).toEqual([null, COLORS.yellow, COLORS.red, null]);
  });
  it("liste yoksa sayıları ve en uzun kelimeyi otomatik vurgular", () => {
    expect(colorWords(["2017'de", "MIT'li"], {}, true)[0]).toBe(COLORS.yellow);
    expect(colorWords(["oyuncak", "kaplumbağa"], {}, true)).toEqual([null, COLORS.yellow]);
  });
  it("altyazıyı en fazla 2 satıra böler ve sığmazsa küçültür", () => {
    const one = layoutCaption(["İnsan", "gözü"]);
    expect(one.lines).toHaveLength(1);
    const two = layoutCaption(["Bu", "kaplumbağaya"]);
    expect(two.lines).toHaveLength(2);
    expect(two.upper[1]).toBe("KAPLUMBAĞAYA");
    expect(layoutCaption(["Muvaffakiyetsizleştiricileştiriveremeyebileceklerimizdenmişsinizcesine"]).fontSize).toBeLessThan(140);
  });
  it("altyazı kelime grupları en fazla 3 kelime", () => {
    const caps = buildShortsCaptions(words, 0.15, {});
    for (const c of caps) expect(c.text.split(" ").length).toBeLessThanOrEqual(3);
    expect(caps[0].ass).toContain("\\pos(540,1340)");
  });
  it("kapak başlığını iki satıra ayırır", () => {
    expect(splitCover("Bu bir|tüfek mi?!")).toEqual(["BU BİR", "TÜFEK Mİ?!"]);
    expect(splitCover("Kurdu kardan tanıdı")[1]).not.toBeNull();
  });
  it("geçerli ASS üretir: seri/bölüm hapı, ilerleme çubuğu, kapanış kartı", () => {
    const ass = buildShortsAss({
      primaryColor: "#7C3AED", durationSec: 10, seriesName: "Yapay Zekâ Komedisi", episode: 3, coverTitle: "Bu bir|tüfek mi?!", hookEndSec: 2.5,
      words, voiceOffset: 0.15, highlights: { yellow: ["kaplumbağa"] }, chips: [{ start: 3, end: 5, text: "2017 · MIT" }],
      mascotRanges: [{ start: 0, end: 4 }], outro: { start: 8, end: 10, title: "Takip et!", subtitle: "Bölüm 4 yakında!" },
    });
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("YAPAY ZEKÂ KOMEDİSİ");
    expect(ass).toContain("BÖLÜM 3");
    expect(ass).toContain("TÜFEK Mİ?!");
    expect(ass).toContain("TAKİP ET!");
    expect(ass).toContain("2017 · MIT");
    expect(ass).toMatch(/\\t\(0,10000,\\clip\(90,/);
    expect(ass).not.toMatch(/NaN|undefined/);
  });
  it("yardımcılar", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(roundedRect(100, 40, 20).startsWith("m 20 0")).toBe(true);
    expect(shortsFontsDir()).toMatch(/assets\/fonts$/);
  });
  it("şablona göre görsel ve senaryo talimatı", () => {
    expect(aiImagePrompt("a toy turtle", { template: "shorts3d", primaryColor: "#7C3AED" })).toMatch(/3D render.*#7C3AED/);
    expect(aiImagePrompt("a toy turtle")).toMatch(/photorealistic/);
    expect(scriptSystem(50, 62, "Turkish", "portrait", "shorts3d")).toContain("Yorumlara yazın!");
    expect(scriptSystem(20, 30)).not.toContain("Yorumlara yazın!");
  });
});
