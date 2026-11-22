import { describe, expect, it } from "vitest";
import { estimateRemainingSec, stagePercent } from "../../src/pipeline/progress";

describe("video ilerleme yüzdesi", () => {
  it("aşama aralıklarını sırayla ve 0–100 arasında verir", () => {
    const order = ["QUEUED", "SCRIPTING", "FETCHING_MEDIA", "VOICING", "RENDERING", "QUALITY_CHECK"];
    const starts = order.map((s) => stagePercent(s, 0));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(stagePercent("QUALITY_CHECK", 1)).toBeLessThan(100);
    expect(stagePercent("READY")).toBe(100);
    expect(stagePercent("FAILED")).toBe(0);
  });

  it("aşama içi ilerlemeyi aralığa yayar ve sınırlar", () => {
    expect(stagePercent("RENDERING", 0)).toBe(35);
    expect(stagePercent("RENDERING", 1)).toBe(95);
    expect(stagePercent("RENDERING", 0.5)).toBe(65);
    expect(stagePercent("RENDERING", 7)).toBe(95);
    expect(stagePercent("RENDERING", -1)).toBe(35);
  });

  it("kalan süreyi geçen süreden tahmin eder", () => {
    const now = Date.parse("2026-01-01T00:02:00Z");
    // 2 dakikada %50 → yaklaşık 2 dakika kaldı
    expect(estimateRemainingSec({ percent: 50, startedAt: "2026-01-01T00:00:00Z" }, null, now)).toBe(120);
    // yüzde düşükken geçmiş ortalamaya düşer
    expect(estimateRemainingSec({ percent: 5, startedAt: "2026-01-01T00:01:00Z" }, 300, now)).toBe(240);
    expect(estimateRemainingSec({ percent: 5, startedAt: null }, null, now)).toBeNull();
    expect(estimateRemainingSec({ percent: 100, startedAt: null }, null, now)).toBe(0);
  });
});
