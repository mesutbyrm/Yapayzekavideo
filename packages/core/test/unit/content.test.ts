import { describe, expect, it } from "vitest";
import { isNearDuplicate, narrationHash, normalizeText, similarity, topicFingerprint } from "../../src/content/fingerprint";
import { scriptSchema, validateTiming } from "../../src/content/schema";
import { narration, validScript } from "../helpers/fixtures";

describe("tekrar engelleme (fingerprint)", () => {
  it("Türkçe karakterleri ve büyük/küçük harfi normalize eder", () => {
    expect(normalizeText("İSTANBUL'un Ağaçları!")).toBe(normalizeText("istanbul'un ağaçları"));
  });
  it("aynı konu farklı yazımla aynı parmak izini üretir", () => {
    expect(topicFingerprint("Ahtapotların üç kalbi")).toBe(topicFingerprint("  ahtapotların ÜÇ kalbi! "));
    expect(narrationHash(narration)).toBe(narrationHash(narration + " "));
  });
  it("benzer konuları yakalar, farklı konuları geçirir", () => {
    expect(similarity("ahtapotların üç kalbi var", "ahtapotların üç kalbi vardır")).toBeGreaterThanOrEqual(0.5);
    // Türkçe ekler: kök bazlı karşılaştırma
    expect(similarity("Ahtapotların kalpleri", "ahtapotlar kalpler")).toBe(1);
    expect(isNearDuplicate("Ahtapotların üç kalbi var", ["Ahtapotların üç kalbi var mı?"])).toBe(true);
    expect(isNearDuplicate("Ay neden hep aynı yüzünü gösterir", ["Ahtapotların üç kalbi var"])).toBe(false);
  });
});

describe("senaryo JSON şeması", () => {
  it("geçerli senaryoyu kabul eder", () => {
    expect(scriptSchema.safeParse(validScript).success).toBe(true);
    expect(validateTiming(validScript, 20, 30)).toEqual([]);
  });
  it("boşluk içeren hashtag'i reddeder", () => {
    expect(scriptSchema.safeParse({ ...validScript, hashtags: ["#iyi", "#kötü etiket", "#x"] }).success).toBe(false);
  });
  it("eksik sahneyi reddeder", () => {
    expect(scriptSchema.safeParse({ ...validScript, scenes: validScript.scenes.slice(0, 2) }).success).toBe(false);
  });
  it("süre dışı senaryoyu ve hook ile başlamayan anlatımı yakalar", () => {
    const long = { ...validScript, scenes: validScript.scenes.map((s) => ({ ...s, duration: 10 })) };
    expect(validateTiming(long, 20, 30).join()).toMatch(/Toplam sahne süresi/);
    expect(validateTiming({ ...validScript, hook: "Tamamen farklı bir giriş cümlesi" }, 20, 30).join()).toMatch(/hook/);
  });
});

import { heuristicSafety } from "../../src/content/safety";
describe("içerik güvenliği (sezgisel)", () => {
  it("temiz içeriği geçirir", () => {
    expect(heuristicSafety(validScript).ok).toBe(true);
  });
  it("yanıltıcı sağlık vaadini ve telif riskini engeller", () => {
    const bad = { ...validScript, narration: validScript.narration + " Bu mucize tedavi kesin iyileştirir. Şarkı sözleri şöyle:" };
    const r = heuristicSafety(bad);
    expect(r.ok).toBe(false);
    expect(r.blocking.some((b) => b.startsWith("yanıltıcı_iddia"))).toBe(true);
    expect(r.blocking.some((b) => b.startsWith("telif_riski"))).toBe(true);
  });
  it("markanın yasaklı ifadelerini engeller", () => {
    expect(heuristicSafety(validScript, ["AHTAPOT"]).blocking).toContain("yasakli_ifade:AHTAPOT");
  });
});
