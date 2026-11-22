/**
 * Uçtan uca video üretimi: konu → senaryo → medya → TTS → GERÇEK FFmpeg montajı → GERÇEK kalite kontrol → depolama → yayın işleri.
 * MOCK olanlar: OpenAI istemcisi (sabit senaryo döndürür) ve Google TTS istemcisi (FFmpeg ile üretilmiş test sesi döndürür).
 * Görseller ücretsiz "generated" hareketli grafik sağlayıcısından gelir (dış istek yok).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../../src/lib/db";
import { resetEnvCache } from "../../src/lib/env";
import { setSetting } from "../../src/lib/settings";
import { setOpenAiClient } from "../../src/ai/openai";
import { setTtsClient } from "../../src/tts/google";
import { enqueueGeneration, generateVideo } from "../../src/pipeline/generate";
import { storage } from "../../src/storage";
import { probe } from "../../src/video/ffmpeg";
import { closeQueues, redis } from "../../src/queue/queues";
import { makeAccount, makeBrand, resetDb } from "../helpers/db";
import { validScript } from "../helpers/fixtures";

let openAiCalls: string[] = [];
let moderationCalls = 0;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = "MOCK-not-a-real-key";
  process.env.GOOGLE_TTS_CREDENTIALS_JSON = "{}";
  resetEnvCache();
  await resetDb();
  await redis().flushdb();
  await setSetting("media.providerOrder", ["library", "pexels", "pixabay", "ai_image", "generated"]);

  // MOCK OpenAI
  setOpenAiClient({
    chat: {
      completions: {
        create: async (req: any) => {
          const name = req.response_format?.json_schema?.name;
          openAiCalls.push(name);
          const content = name === "ideas" ? { ideas: [{ topic: "Ahtapotların üç kalbi neden var?", category: "Genel Bilgi" }, { topic: "Bal neden bozulmaz?" }] } : validScript;
          return { model: "mock-model", usage: { prompt_tokens: 1200, completion_tokens: 800 }, choices: [{ message: { content: JSON.stringify(content) } }] };
        },
      },
    },
    moderations: { create: async () => { moderationCalls++; return { results: [{ flagged: false, categories: {} }] }; } },
  } as any);

  // MOCK Google TTS: 22 sn konuşma benzeri test sesi (FFmpeg ile üretilir)
  const dir = mkdtempSync(path.join(os.tmpdir(), "asf-tts-"));
  const mp3 = path.join(dir, "voice.mp3");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=22", "-af", "volume=0.5,tremolo=f=4:d=0.7", "-c:a", "libmp3lame", "-b:a", "128k", "-y", mp3]);
  const audio = readFileSync(mp3);
  setTtsClient({
    synthesizeSpeech: async (req: any) => {
      const n = (req.input.ssml.match(/<mark /g) ?? []).length;
      return [{ audioContent: audio, timepoints: Array.from({ length: n }, (_, i) => ({ markName: `w${i}`, timeSeconds: 0.1 + (i * 21.5) / n })) }];
    },
  });
});

afterAll(async () => {
  setOpenAiClient(null);
  setTtsClient(null);
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_TTS_CREDENTIALS_JSON;
  resetEnvCache();
  await closeQueues();
});

describe("video üretim hattı", () => {
  it("dikey 1080x1920 H.264/AAC video üretir, kalite kontrolünden geçirir, maliyeti kaydeder ve yayın işlerini oluşturur", async () => {
    const brand = await makeBrand({ autoPublish: true });
    await makeAccount(brand.id, "YOUTUBE");
    const queued = await enqueueGeneration(brand.id, { trigger: "manual" });
    const v = await generateVideo(queued.id);

    expect(v.status).toBe("READY");
    expect(v.qcPassed).toBe(true);
    const report = v.qcReport as any;
    expect(report.checks.filter((c: any) => !c.passed && c.severity === "error")).toEqual([]);

    const local = path.join(os.tmpdir(), `asf-out-${v.id}.mp4`);
    await storage().getToFile(v.storageKey!, local);
    const p = await probe(local);
    expect(p.video).toMatchObject({ width: 1080, height: 1920, codec: "h264" });
    expect(Math.round(p.video!.fps)).toBe(30);
    expect(p.audio?.codec).toBe("aac");
    expect(p.durationSec).toBeGreaterThanOrEqual(20);
    expect(p.durationSec).toBeLessThanOrEqual(30);

    // Lisans/kaynak kaydı
    const manifest = v.mediaManifest as any;
    expect(manifest.scenes.every((s: any) => s.provider === "generated" && s.commercialUse)).toBe(true);

    // Maliyet: OpenAI + TTS kullanımları gerçek sayılarla loglandı
    const usage = await prisma.aIUsageLog.findMany({ where: { videoId: v.id } });
    expect(usage.map((u) => u.provider).sort()).toEqual(expect.arrayContaining(["OPENAI", "GOOGLE_TTS"]));
    expect(Number(v.costUsd)).toBeGreaterThan(0);
    expect(openAiCalls).toContain("video_script");
    expect(moderationCalls).toBeGreaterThan(0);

    // Yayın işi oluşturuldu
    expect(await prisma.publishJob.count({ where: { videoId: v.id, platform: "YOUTUBE" } })).toBe(1);

    // Aynı senaryo ikinci kez üretilemez (tekrar engeli: narrationHash benzersiz)
    const q2 = await enqueueGeneration(brand.id, { trigger: "manual" });
    await expect(generateVideo(q2.id)).rejects.toThrow();
    expect((await prisma.video.findUniqueOrThrow({ where: { id: q2.id } })).status).not.toBe("READY");
  }, 240_000);
});
