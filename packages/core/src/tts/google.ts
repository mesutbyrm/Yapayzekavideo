import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { v1beta1 } from "@google-cloud/text-to-speech";
import { env } from "../lib/env";
import { NotConfiguredError, ProviderError } from "../lib/errors";
import { assertCanSpend, recordUsage } from "../budget/budget";
import { ttsCost } from "../budget/pricing";
import { logger } from "../lib/logger";
import { ffmpeg, probe } from "../video/ffmpeg";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface TtsResult {
  mp3Path: string;
  durationSec: number;
  words: WordTiming[];
  characters: number;
  voice: string;
  speakingRate: number;
  timingSource: "ssml_marks" | "proportional";
}

export interface VoiceOptions {
  voiceName: string;
  gender: "MALE" | "FEMALE";
  speakingRate: number;
  pitch: number;
  languageCode?: string;
}

export const TURKISH_VOICES = [
  { name: "tr-TR-Wavenet-A", gender: "FEMALE" },
  { name: "tr-TR-Wavenet-B", gender: "MALE" },
  { name: "tr-TR-Wavenet-C", gender: "FEMALE" },
  { name: "tr-TR-Wavenet-D", gender: "FEMALE" },
  { name: "tr-TR-Wavenet-E", gender: "MALE" },
  { name: "tr-TR-Standard-A", gender: "FEMALE" },
  { name: "tr-TR-Standard-B", gender: "MALE" },
  { name: "tr-TR-Standard-E", gender: "MALE" },
] as const;

type Client = InstanceType<typeof v1beta1.TextToSpeechClient>;
let client: Client | null = null;

export function ttsConfigured() {
  const e = env();
  return !!(e.GOOGLE_APPLICATION_CREDENTIALS || e.GOOGLE_TTS_CREDENTIALS_JSON);
}

function ttsClient(): Client {
  const e = env();
  if (!ttsConfigured()) throw new NotConfiguredError("Google Cloud Text-to-Speech", ["GOOGLE_APPLICATION_CREDENTIALS veya GOOGLE_TTS_CREDENTIALS_JSON"]);
  if (!client) {
    client = e.GOOGLE_TTS_CREDENTIALS_JSON
      ? new v1beta1.TextToSpeechClient({ credentials: JSON.parse(e.GOOGLE_TTS_CREDENTIALS_JSON) })
      : new v1beta1.TextToSpeechClient();
  }
  return client;
}

export function setTtsClient(c: any) {
  client = c;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function splitWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Her kelimenin önüne SSML <mark> ekler; kelime bazlı zamanlama için */
export function buildSsml(text: string) {
  const words = splitWords(text);
  return { ssml: `<speak>${words.map((w, i) => `<mark name="w${i}"/>${xmlEscape(w)}`).join(" ")}</speak>`, words };
}

/** İşaret zamanlarından kelime aralıkları */
export function timingsFromMarks(words: string[], marks: { markName?: string | null; timeSeconds?: number | null }[], totalSec: number): WordTiming[] {
  const t = new Map(marks.map((m) => [m.markName ?? "", Number(m.timeSeconds ?? 0)]));
  return words.map((w, i) => {
    const start = t.get(`w${i}`) ?? 0;
    const next = t.get(`w${i + 1}`);
    return { word: w, start, end: Math.min(next ?? totalSec, totalSec) };
  });
}

/** Zamanlama yoksa karakter uzunluğuna göre orantılı dağıtım */
export function proportionalTimings(words: string[], totalSec: number, leadIn = 0.05): WordTiming[] {
  const weights = words.map((w) => w.length + 2 + (/[.,!?;:]$/.test(w) ? 3 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  let cur = leadIn;
  const avail = totalSec - leadIn - 0.1;
  return words.map((w, i) => {
    const d = (weights[i] / sum) * avail;
    const r = { word: w, start: cur, end: cur + d };
    cur += d;
    return r;
  });
}

async function synthesizeOnce(text: string, voice: VoiceOptions, outPath: string) {
  const { ssml, words } = buildSsml(text);
  const [resp] = await ttsClient().synthesizeSpeech({
    input: { ssml },
    voice: { languageCode: voice.languageCode ?? "tr-TR", name: voice.voiceName, ssmlGender: voice.gender },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: voice.speakingRate,
      pitch: voice.pitch,
      sampleRateHertz: 48000,
      effectsProfileId: ["handset-class-device"],
    },
    enableTimePointing: ["SSML_MARK"],
  } as any);
  if (!resp.audioContent) throw new ProviderError("TTS boş ses döndürdü", "google_tts", "EMPTY_AUDIO", true);
  await writeFile(outPath, resp.audioContent as Uint8Array);
  return { words, marks: (resp as any).timepoints ?? [], chars: ssml.length };
}

function splitTtsChunks(text: string, maxSsmlBytes = 4_500): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const word of splitWords(text)) {
    const candidate = [...current, word].join(" ");
    if (current.length && Buffer.byteLength(buildSsml(candidate).ssml, "utf8") > maxSsmlBytes) {
      chunks.push(current.join(" "));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

async function synthesizeChunks(text: string, voice: VoiceOptions, workDir: string) {
  const chunks = splitTtsChunks(text);
  const files: string[] = [];
  const words: string[] = [];
  const marks: Array<{ markName: string; timeSeconds: number }> = [];
  let durationSec = 0;
  let characters = 0;
  let wordOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const file = path.join(workDir, "voice_chunk_" + String(i).padStart(3, "0") + ".mp3");
    const part = await withRetry(() => synthesizeOnce(chunks[i], voice, file), 3, "google_tts");
    const chunkDuration = (await probe(file)).durationSec;
    files.push(file);
    words.push(...part.words);
    characters += part.chars;
    for (const mark of part.marks) {
      const localIndex = Number(String(mark.markName ?? "").replace(/^w/, ""));
      if (Number.isFinite(localIndex)) marks.push({ markName: "w" + (wordOffset + localIndex), timeSeconds: durationSec + Number(mark.timeSeconds ?? 0) });
    }
    wordOffset += part.words.length;
    durationSec += chunkDuration;
  }
  const listPath = path.join(workDir, "voice_chunks.txt");
  const rawPath = path.join(workDir, "voice_raw.mp3");
  await writeFile(listPath, files.map((file) => "file '" + file + "'").join("\n") + "\n");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", rawPath], Math.max(120, Math.ceil(durationSec / 2)));
  return { rawPath, words, marks, durationSec, characters };
}

/**
 * Seslendirme: SSML işaretleriyle kelime zamanlaması, otomatik tekrar deneme,
 * hedef süreye sığdırma (konuşma hızı ayarı) ve EBU R128 ses normalizasyonu.
 */
export async function synthesizeNarration(opts: {
  text: string;
  voice: VoiceOptions;
  workDir: string;
  brandId: string;
  videoId?: string | null;
  maxDurationSec: number;
  minDurationSec: number;
}): Promise<TtsResult> {
  const rawPath = path.join(opts.workDir, "voice_raw.mp3");
  const outPath = path.join(opts.workDir, "voice.mp3");
  let rate = opts.voice.speakingRate;
  let words: string[] = [];
  let marks: Array<{ markName: string; timeSeconds: number }> = [];
  let totalChars = 0;
  let rawDurationSec = 0;

  for (let pass = 0; pass < 2; pass++) {
    const est = splitTtsChunks(opts.text).reduce((sum, chunk) => sum + Buffer.byteLength(buildSsml(chunk).ssml, "utf8"), 0);
    await assertCanSpend(opts.brandId, ttsCost(est), "tts.synthesize");
    const r = await synthesizeChunks(opts.text, { ...opts.voice, speakingRate: rate }, opts.workDir);
    words = r.words;
    marks = r.marks;
    totalChars = r.characters;
    rawDurationSec = r.durationSec;
    await recordUsage({ brandId: opts.brandId, videoId: opts.videoId, provider: "GOOGLE_TTS", operation: "tts.synthesize", model: opts.voice.voiceName, characters: r.characters, costUsd: ttsCost(r.characters) });
    const d = (await probe(rawPath)).durationSec;
    // Hedef: maxDuration - 1.5 sn (kapanış kartı için pay)
    const target = opts.maxDurationSec - 1.5;
    if (d > target && pass === 0) {
      rate = Math.min(1.35, Number((rate * (d / target) * 1.02).toFixed(2)));
      logger.info({ d, rate }, "seslendirme uzun, hız artırılarak tekrar üretiliyor");
      continue;
    }
    break;
  }

  // Ses normalizasyonu (EBU R128, -16 LUFS mobil/sosyal standart)
  await ffmpeg(["-i", rawPath, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", outPath], Math.max(120, Math.ceil(rawDurationSec * 2)));
  const durationSec = (await probe(outPath)).durationSec;
  const timings = marks.length >= words.length * 0.8 ? timingsFromMarks(words, marks, durationSec) : proportionalTimings(words, durationSec);
  return {
    mp3Path: outPath,
    durationSec,
    words: timings,
    characters: totalChars,
    voice: opts.voice.voiceName,
    speakingRate: rate,
    timingSource: marks.length >= words.length * 0.8 ? "ssml_marks" : "proportional",
  };
}

export async function withRetry<T>(fn: () => Promise<T>, attempts: number, provider: string): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      last = err;
      const code = err?.code;
      // gRPC: 3 INVALID_ARGUMENT, 7 PERMISSION_DENIED, 16 UNAUTHENTICATED -> tekrar deneme anlamsız
      if ([3, 7, 16].includes(code) || err instanceof NotConfiguredError) {
        throw new ProviderError(`TTS hatası: ${err.message}`, provider, `GRPC_${code}`, false, undefined, code === 3 ? "validation" : "auth");
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new ProviderError(`TTS ${attempts} denemede başarısız: ${(last as Error)?.message}`, provider, "TTS_FAILED", true);
}

export async function readFileBytes(p: string) {
  return readFile(p);
}
