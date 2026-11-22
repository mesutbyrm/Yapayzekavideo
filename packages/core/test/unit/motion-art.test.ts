import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderMotionArt } from "../../src/video/render";

const hasPillow = spawnSync("python3", ["-c", "import PIL"]).status === 0;
const brand = { primaryColor: "#7C3AED", secondaryColor: "#0EA5E9", accentColor: "#F59E0B", font: "DejaVu Sans" };

describe("kodla sahne görseli (motion_art.py)", () => {
  it.skipIf(!hasPillow)("sahne açıklamasından 720x1280 PNG üretir", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "asf-art-"));
    const out = await renderMotionArt({ out: path.join(dir, "a.png"), description: "kedi pencerede uyuyor", brand, index: 0 });
    expect(out).not.toBeNull();
    const buf = await readFile(out!);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(720);
    expect(buf.readUInt32BE(20)).toBe(1280);
  });
  it("Python bulunamazsa hata fırlatmaz, null döner (gradyana düşülür)", async () => {
    const prev = process.env.MOTION_ART_PYTHON;
    process.env.MOTION_ART_PYTHON = "/nonexistent/python";
    const { resetEnvCache } = await import("../../src/lib/env");
    resetEnvCache();
    try {
      const dir = await mkdtemp(path.join(os.tmpdir(), "asf-art-"));
      expect(await renderMotionArt({ out: path.join(dir, "b.png"), description: "x", brand, index: 1 })).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MOTION_ART_PYTHON; else process.env.MOTION_ART_PYTHON = prev;
      resetEnvCache();
    }
  });
});
