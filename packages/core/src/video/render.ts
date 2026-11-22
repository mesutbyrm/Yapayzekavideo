import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { ffmpeg, probe, escapeFilterPath } from "./ffmpeg";
import type { ResolvedScene } from "../media/resolve";
import type { WordTiming } from "../tts/google";
import { buildAss, groupWords, type Cue } from "./subtitles";

export const OUTPUT_SPEC = { width: 1080, height: 1920, fps: 30, vcodec: "h264", acodec: "aac" } as const;

export interface RenderInput {
  workDir: string;
  scenes: (ResolvedScene & { subtitle: string; visualDescription?: string; scene3d?: unknown })[];
  voicePath: string;
  voiceDurationSec: number;
  words: WordTiming[];
  musicPath?: string | null;
  musicVolume: number;
  logoPath?: string | null;
  brand: { primaryColor: string; secondaryColor: string; accentColor: string; font: string };
  title: string;
  cta: string;
  minDurationSec: number;
  maxDurationSec: number;
  /** İlerleme bildirimi: fraction 0..1, detail kullanıcıya gösterilecek kısa açıklama */
  onProgress?: (fraction: number, detail: string) => unknown;
}

export interface RenderOutput {
  outputPath: string;
  thumbnailPath: string;
  assPath: string;
  durationSec: number;
  captions: Cue[];
  segments: { index: number; start: number; duration: number; provider: string }[];
}

const XFADE = 0.35;
const OUTRO = 1.8;
const VOICE_DELAY = 0.15;
const TRANSITIONS = ["fade", "smoothleft", "smoothup", "circleopen", "slideleft", "fadeblack"];

const hex = (c: string) => "0x" + c.replace("#", "");

/** motion_art.py yolu tembel çözülür: Next.js derlemesi import.meta.url'i dosya URL'si olarak vermez */
function motionArtScript(): string {
  try {
    return fileURLToPath(new URL("./motion_art.py", import.meta.url));
  } catch {
    return path.resolve(process.cwd(), "../../packages/core/src/video/motion_art.py");
  }
}

function motion3dScript(): string {
  try {
    return fileURLToPath(new URL("./motion3d.py", import.meta.url));
  } catch {
    return path.resolve(process.cwd(), "../../packages/core/src/video/motion3d.py");
  }
}

/** 3D sahne iç çözünürlüğü; ffmpeg 1080x1920'ye büyütür */
const M3D_W = 540, M3D_H = 960;

/**
 * Sahneyi kodla 3D hareketli klip olarak çizer (motion3d.py, numpy ışın izleme):
 * senaryodaki scene_3d tarifi (nesneler, renkler, hareketler, kamera) kare kare render edilir
 * ve ham kareler doğrudan ffmpeg'e akıtılır. Python/numpy yoksa veya hata verirse null döner.
 */
export async function renderMotion3d(opts: { out: string; spec: unknown; durationSec: number; brand: RenderInput["brand"]; index: number }): Promise<string | null> {
  const fps = OUTPUT_SPEC.fps;
  const frames = Math.max(1, Math.ceil(opts.durationSec * fps));
  const pyArgs = [motion3dScript(), "--spec", JSON.stringify(opts.spec ?? {}), "--duration", opts.durationSec.toFixed(3), "--fps", String(fps), "--width", String(M3D_W), "--height", String(M3D_H),
    "--primary", opts.brand.primaryColor, "--secondary", opts.brand.secondaryColor, "--accent", opts.brand.accentColor, "--index", String(opts.index)];
  const ffArgs = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${M3D_W}x${M3D_H}`, "-r", String(fps), "-i", "pipe:0",
    "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", opts.out];
  // Kare başına ~0.2 sn (tek çekirdek) + pay
  const timeoutMs = Math.max(60_000, frames * 600);
  try {
    await new Promise<void>((resolve, reject) => {
      const py = spawn("nice", ["-n", "10", env().MOTION_ART_PYTHON, ...pyArgs], { stdio: ["ignore", "pipe", "pipe"] });
      const ff = spawn("nice", ["-n", "10", env().FFMPEG_PATH, ...ffArgs], { stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      const tail = (d: Buffer) => (err = (err + d).slice(-2000));
      py.stderr.on("data", tail); ff.stderr.on("data", tail);
      py.stdout.pipe(ff.stdin);
      ff.stdin.on("error", () => undefined);
      const timer = setTimeout(() => { py.kill("SIGKILL"); ff.kill("SIGKILL"); }, timeoutMs);
      let pyCode: number | null = null;
      py.on("error", (e) => { clearTimeout(timer); ff.kill("SIGKILL"); reject(e); });
      ff.on("error", (e) => { clearTimeout(timer); py.kill("SIGKILL"); reject(e); });
      py.on("close", (code) => { pyCode = code; });
      ff.on("close", (code) => {
        clearTimeout(timer);
        code === 0 && pyCode === 0 ? resolve() : reject(new Error(`motion3d python=${pyCode} ffmpeg=${code}: ${err}`));
      });
    });
    const st = await stat(opts.out);
    return st.size > 0 ? opts.out : null;
  } catch (err) {
    logger.warn({ scene: opts.index, err: (err as Error).message.slice(0, 400) }, "3D sahne çizilemedi, durağan görsele düşülüyor");
    return null;
  }
}

/** Sınırlı eşzamanlılıkla işler (sahneler paralel çizilir, CPU çekirdeği kadar) */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * Sahne görselini kodla çizer (motion_art.py, Pillow): marka renkleri + sahne açıklamasına göre figür.
 * Python/Pillow yoksa veya hata verirse null döner; çağıran gradyan arka plana düşer.
 */
export async function renderMotionArt(opts: { out: string; description: string; brand: RenderInput["brand"]; index: number }): Promise<string | null> {
  const args = [motionArtScript(), "--out", opts.out, "--description", opts.description.slice(0, 500), "--primary", opts.brand.primaryColor, "--secondary", opts.brand.secondaryColor, "--accent", opts.brand.accentColor, "--index", String(opts.index)];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(env().MOTION_ART_PYTHON, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`motion_art çıkış kodu ${code}: ${stderr}`)); });
    });
    const st = await stat(opts.out);
    return st.size > 0 ? opts.out : null;
  } catch (err) {
    logger.warn({ scene: opts.index, err: (err as Error).message.slice(0, 300) }, "kodla görsel üretilemedi, gradyan arka plan kullanılıyor");
    return null;
  }
}

/** Toplam süre: ses + kapanış; hedef aralığa sıkıştırılır */
export function planDurations(sceneDurations: number[], voiceSec: number, minSec: number, maxSec: number) {
  const total = Math.min(maxSec, Math.max(minSec, voiceSec + VOICE_DELAY + OUTRO + 0.2));
  const contentSec = total - OUTRO;
  const sum = sceneDurations.reduce((a, b) => a + b, 0) || 1;
  const scaled = sceneDurations.map((d) => (d / sum) * contentSec);
  return { total, contentSec, scenes: scaled };
}

async function renderSegment(input: RenderInput, scene: RenderInput["scenes"][number], dur: number, idx: number, clip3d?: string | null): Promise<string> {
  const out = path.join(input.workDir, `seg_${idx}.mp4`);
  const W = OUTPUT_SPEC.width, H = OUTPUT_SPEC.height, fps = OUTPUT_SPEC.fps;
  const frames = Math.ceil(dur * fps);
  let s: ResolvedScene = scene;
  if (s.kind === "GENERATED" && clip3d) {
    // Kodla çizilmiş 3D hareketli klip
    s = { ...s, kind: "VIDEO", filePath: clip3d };
  } else if (s.kind === "GENERATED") {
    // Yedek: tek kare çizim Ken Burns ile canlandırılır
    const art = await renderMotionArt({ out: path.join(input.workDir, `scene_${idx}_art.png`), description: `${scene.visualDescription ?? ""} ${scene.subtitle ?? ""}`, brand: input.brand, index: idx });
    if (art) s = { ...s, kind: "IMAGE", filePath: art };
  }
  const norm = `fps=${fps},setsar=1,format=yuv420p`;
  if (s.kind === "VIDEO" && s.filePath) {
    const p = await probe(s.filePath);
    const start = p.durationSec > dur + 2 ? Math.min(1, (p.durationSec - dur) / 3) : 0;
    await ffmpeg([
      "-ss", start.toFixed(2), "-t", dur.toFixed(3), "-i", s.filePath,
      "-an", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},eq=saturation=1.08:contrast=1.03,${norm}`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out,
    ]);
  } else if (s.kind === "IMAGE" && s.filePath) {
    // Ken Burns yakınlaştırma
    const dir = idx % 2 === 0 ? "in" : "out";
    const z = dir === "in" ? `min(1+0.10*on/${frames},1.10)` : `max(1.10-0.10*on/${frames},1.0)`;
    await ffmpeg([
      "-loop", "1", "-i", s.filePath,
      "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},${norm}`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out,
    ]);
  } else {
    // Ücretsiz hareketli grafik: marka renkleriyle akan gradyan + hafif doku
    const c = [input.brand.primaryColor, input.brand.secondaryColor, input.brand.accentColor];
    const c0 = c[idx % 3], c1 = c[(idx + 1) % 3];
    await ffmpeg([
      "-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=${hex(c0)}:c1=${hex(c1)}:c2=0x111827:nb_colors=3:speed=0.012:type=radial:r=${fps}:d=${dur.toFixed(3)}:seed=${idx + 7}`,
      "-vf", `noise=alls=6:allf=t,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='●':fontcolor=white@0.16:fontsize=240:x='W*0.10+34*sin(t*0.42)':y='H*0.18+52*cos(t*0.38)',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='●':fontcolor=white@0.12:fontsize=150:x='W*0.72+26*cos(t*0.33)':y='H*0.30+42*sin(t*0.46)',vignette=PI/5,${norm}`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out,
    ]);
  }
  return out;
}

async function renderOutro(input: RenderInput, dur: number) {
  const out = path.join(input.workDir, "seg_outro.mp4");
  const W = OUTPUT_SPEC.width, H = OUTPUT_SPEC.height, fps = OUTPUT_SPEC.fps;
  const args = ["-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=${hex(input.brand.primaryColor)}:c1=${hex(input.brand.secondaryColor)}:speed=0.02:r=${fps}:d=${dur.toFixed(3)}`];
  let vf = `[0:v]fps=${fps},setsar=1,format=yuv420p[v]`;
  if (input.logoPath) {
    args.push("-i", input.logoPath);
    vf = `[1:v]scale=420:-1,format=rgba[lg];[0:v][lg]overlay=(W-w)/2:H*0.30-h/2,fps=${fps},setsar=1,format=yuv420p[v]`;
  }
  await ffmpeg([...args, "-filter_complex", vf, "-map", "[v]", "-frames:v", String(Math.ceil(dur * fps)), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out]);
  return out;
}

/**
 * Montaj: sahne kliplerini normalize eder, geçişlerle birleştirir, altyazı/başlık/
 * açılış-kapanış animasyonlarını (ASS) yakar, logo ekler, sesi ve müziği miksler.
 * Çıktı: 1080x1920, 30 FPS, H.264 High, AAC 48 kHz stereo, MP4 (faststart).
 */
export async function renderVideo(input: RenderInput): Promise<RenderOutput> {
  const plan = planDurations(input.scenes.map((s) => s.durationSec), input.voiceDurationSec, input.minDurationSec, input.maxDurationSec);
  const n = input.scenes.length;

  // Geçiş süresi kadar her segment uzatılır (son segment hariç), toplam süre korunur
  const segDur = plan.scenes.map((d, i) => d + (i < n ? XFADE : 0));
  const segFiles: string[] = [];
  const progress = async (fraction: number, detail: string) => { await Promise.resolve(input.onProgress?.(fraction, detail)).catch(() => undefined); };
  // Sahne çizimi montajın büyük kısmıdır (%0–75), son kodlama %75–100.
  // Önce kodla üretilecek 3D sahneler çekirdek sayısı kadar paralel çizilir (%0–55).
  const gen = input.scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "GENERATED");
  const clips: (string | null)[] = new Array(n).fill(null);
  if (gen.length) {
    const limit = Math.max(1, Math.min(4, os.cpus().length - 1));
    let done = 0;
    await progress(0, `3D sahneler çiziliyor (0/${gen.length})`);
    await mapLimit(gen, limit, async ({ s, i }) => {
      clips[i] = await renderMotion3d({ out: path.join(input.workDir, `scene_${i}_3d.mp4`), spec: s.scene3d, durationSec: segDur[i], brand: input.brand, index: i });
      done++;
      await progress((done / gen.length) * 0.55, `3D sahneler çiziliyor (${done}/${gen.length})`);
    });
  }
  const base = gen.length ? 0.55 : 0;
  for (let i = 0; i < n; i++) {
    await progress(base + (i / (n + 1)) * (0.75 - base), `Sahne ${i + 1}/${n} hazırlanıyor`);
    segFiles.push(await renderSegment(input, input.scenes[i], segDur[i], i, clips[i]));
  }
  await progress((n / (n + 1)) * 0.75, "Kapanış sahnesi");
  segFiles.push(await renderOutro(input, OUTRO));
  await progress(0.75, "Altyazı ve geçişler");
  const allDur = [...segDur, OUTRO];

  // xfade zinciri
  const parts: string[] = [];
  let prev = "[0:v]";
  let acc = allDur[0];
  const segments: RenderOutput["segments"] = [];
  let tStart = 0;
  for (let i = 0; i < allDur.length; i++) {
    segments.push({ index: i, start: tStart, duration: i < n ? plan.scenes[i] : OUTRO, provider: i < n ? input.scenes[i].provider : "outro" });
    tStart += i < n ? plan.scenes[i] : OUTRO;
  }
  for (let i = 1; i < allDur.length; i++) {
    const offset = acc - XFADE;
    const tr = i === allDur.length - 1 ? "fade" : TRANSITIONS[i % TRANSITIONS.length];
    const label = `[x${i}]`;
    parts.push(`${prev}[${i}:v]xfade=transition=${tr}:duration=${XFADE}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
    acc = offset + allDur[i];
  }

  // Altyazılar
  const captions = groupWords(input.words, 4, 22, VOICE_DELAY);
  const headlines: Cue[] = segments
    .filter((s) => s.index < n && s.index > 0)
    .map((s) => ({ start: s.start + 0.2, end: s.start + s.duration - 0.1, text: input.scenes[s.index].subtitle }));
  const ass = buildAss({
    font: input.brand.font,
    primaryColor: input.brand.primaryColor,
    accentColor: input.brand.accentColor,
    captions,
    headlines,
    intro: { text: input.title, end: 1.7 },
    outro: { text: input.cta, start: plan.total - OUTRO + 0.1, end: plan.total },
  });
  const assPath = path.join(input.workDir, "subs.ass");
  await writeFile(assPath, ass, "utf8");

  const inputs: string[] = [];
  segFiles.forEach((f) => inputs.push("-i", f));
  const voiceIdx = segFiles.length;
  inputs.push("-i", input.voicePath);
  let musicIdx = -1;
  if (input.musicPath) {
    musicIdx = voiceIdx + 1;
    inputs.push("-stream_loop", "-1", "-i", input.musicPath);
  }
  let logoIdx = -1;
  if (input.logoPath) {
    logoIdx = (musicIdx >= 0 ? musicIdx : voiceIdx) + 1;
    inputs.push("-i", input.logoPath);
  }

  let vchain = `${prev}ass=${escapeFilterPath(assPath)}`;
  if (logoIdx >= 0) {
    parts.push(`[${logoIdx}:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[logo]`);
    vchain += `[vs];[vs][logo]overlay=W-w-48:110:enable='lt(t,${(plan.total - OUTRO).toFixed(2)})'`;
  }
  parts.push(`${vchain},format=yuv420p[vout]`);

  const total = plan.total.toFixed(3);
  const delayMs = Math.round(VOICE_DELAY * 1000);
  parts.push(`[${voiceIdx}:a]adelay=${delayMs}|${delayMs},aresample=48000,apad,atrim=0:${total}[voice]`);
  if (musicIdx >= 0) {
    parts.push(`[${musicIdx}:a]aresample=48000,volume=${input.musicVolume.toFixed(3)},atrim=0:${total},afade=t=in:d=0.6,afade=t=out:st=${(plan.total - 1.2).toFixed(2)}:d=1.2[mus]`);
    parts.push(`[voice]asplit=2[v1][vsc]`);
    parts.push(`[mus][vsc]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[duck]`);
    parts.push(`[v1][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
  } else {
    parts.push(`[voice]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
  }

  const outputPath = path.join(input.workDir, "final.mp4");
  await progress(0.8, "Son kodlama (H.264)");
  await ffmpeg([
    ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-t", total,
    "-r", String(OUTPUT_SPEC.fps),
    "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1", "-preset", "medium", "-crf", "21",
    "-maxrate", "10M", "-bufsize", "20M", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    outputPath,
  ]);

  await progress(0.97, "Kapak görseli");
  const thumbnailPath = path.join(input.workDir, "thumb.jpg");
  await ffmpeg(["-ss", "0.9", "-i", outputPath, "-frames:v", "1", "-q:v", "3", thumbnailPath], 60);
  const p = await probe(outputPath);
  return { outputPath, thumbnailPath, assPath, durationSec: p.durationSec, captions, segments };
}
