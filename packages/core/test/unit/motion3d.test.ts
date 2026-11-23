import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderMotion3d } from "../../src/video/render";
import { probe } from "../../src/video/ffmpeg";
import { sceneSchema } from "../../src/content/schema";

const hasNumpy = spawnSync("python3", ["-c", "import numpy"]).status === 0;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const brand = { primaryColor: "#7C3AED", secondaryColor: "#0EA5E9", accentColor: "#F59E0B", font: "DejaVu Sans" };

describe("kodla 3D hareketli sahne (motion3d.py)", () => {
  it.skipIf(!hasNumpy || !hasFfmpeg)("sahne tarifinden istenen sürede hareketli klip üretir", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "asf-3d-"));
    const spec = { camera: "orbit", objects: [{ shape: "coin_stack", color: "#f5c542", x: -0.6, y: -0.4, z: 0, size: 0.8, motion: "none" }, { shape: "coin", color: "#f5c542", x: 0.4, y: 0.8, z: 0, size: 0.4, motion: "spin" }] };
    const out = await renderMotion3d({ out: path.join(dir, "a.mp4"), spec, durationSec: 1, brand, index: 0 });
    expect(out).not.toBeNull();
    const p = await probe(out!);
    expect(p.video?.width).toBe(540);
    expect(p.video?.height).toBe(960);
    expect(p.durationSec).toBeGreaterThan(0.9);
    expect(p.durationSec).toBeLessThan(1.2);
  }, 60_000);

  it.skipIf(!hasNumpy)("bilinmeyen şekil/bozuk tarifte varsayılan kompozisyonla yine çizer", () => {
    const r = spawnSync("python3", [path.resolve(__dirname, "../../src/video/motion3d.py"), "--spec", '{"objects":[{"shape":"unicorn"}],"camera":"x"}', "--duration", "0.1", "--fps", "10", "--width", "64", "--height", "96"]);
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(64 * 96 * 3);
  });

  it("senaryoda bozuk scene_3d olursa sahne yine geçerli sayılır (3D tarifi yok sayılır)", () => {
    const base = { duration: 4, visual_description: "para birikimi", subtitle: "Birikim" };
    expect(sceneSchema.parse({ ...base, scene_3d: { camera: "orbit", objects: [{ shape: "coin", color: "#ffcc00", x: 0, y: 0, z: 0, size: 0.5, motion: "spin" }] } }).scene_3d?.objects[0].shape).toBe("coin");
    expect(sceneSchema.parse({ ...base, scene_3d: { camera: "zoom", objects: [] } }).scene_3d).toBeUndefined();
  });
});
