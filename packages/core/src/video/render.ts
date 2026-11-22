import path from "node:path";
import { writeFile } from "node:fs/promises";
import { ffmpeg, probe, escapeFilterPath } from "./ffmpeg";
import type { ResolvedScene } from "../media/resolve";
import type { WordTiming } from "../tts/google";
import { buildAss, groupWords, type Cue } from "./subtitles";
import { buildShortsAss, buildShortsCaptions, mix, shortsFontsDir, SHORTS_TEMPLATE, type Highlights } from "./shorts-style";

export const OUTPUT_SPEC = { width: 1080, height: 1920, fps: 30, vcodec: "h264", acodec: "aac" } as const;

export interface RenderInput {
  workDir: string;
  scenes: (ResolvedScene & { subtitle: string })[];
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
  /** Marka video şablonu: "modern" (varsayılan) veya "shorts3d" (referans videolardaki stil) */
  template?: string;
  shorts?: {
    seriesName: string;
    episode?: number | null;
    /** "SATIR 1|SATIR 2" — boşsa title kullanılır */
    coverTitle?: string | null;
    highlights?: Highlights;
    /** Sahne başına kısa etiket (ör. "2017 · MIT") */
    labels?: (string | null | undefined)[];
    outroSubtitle?: string | null;
  };
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
const SHORTS_XFADE = 0.3;
const SHORTS_OUTRO = 2.4;
const SHORTS_TRANSITIONS = ["fade", "zoomin", "smoothup", "fade", "smoothleft"];
const VOICE_DELAY = 0.15;
const TRANSITIONS = ["fade", "smoothleft", "smoothup", "circleopen", "slideleft", "fadeblack"];

const hex = (c: string) => "0x" + c.replace("#", "");

/** Toplam süre: ses + kapanış; hedef aralığa sıkıştırılır */
export function planDurations(sceneDurations: number[], voiceSec: number, minSec: number, maxSec: number, outroSec = OUTRO) {
  const total = Math.min(maxSec, Math.max(minSec, voiceSec + VOICE_DELAY + outroSec + 0.2));
  const contentSec = total - outroSec;
  const sum = sceneDurations.reduce((a, b) => a + b, 0) || 1;
  const scaled = sceneDurations.map((d) => (d / sum) * contentSec);
  return { total, contentSec, scenes: scaled };
}

async function renderSegment(input: RenderInput, s: ResolvedScene, dur: number, idx: number): Promise<string> {
  const out = path.join(input.workDir, `seg_${idx}.mp4`);
  const W = OUTPUT_SPEC.width, H = OUTPUT_SPEC.height, fps = OUTPUT_SPEC.fps;
  const frames = Math.ceil(dur * fps);
  const norm = `fps=${fps},setsar=1,format=yuv420p`;
  if (s.kind === "VIDEO" && s.filePath) {
    const p = await probe(s.filePath);
    const start = p.durationSec > dur + 2 ? Math.min(1, (p.durationSec - dur) / 3) : 0;
    await ffmpeg([
      "-ss", start.toFixed(2), "-t", dur.toFixed(3), "-i", s.filePath,
      "-an", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},eq=saturation=1.08:contrast=1.03,${norm}`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out,
    ]);
  } else if (s.kind === "IMAGE" && s.filePath && isShorts(input)) {
    // Shorts: karakter/nesne hafifçe yakınlaşır ve yukarı-aşağı süzülür
    const z = `min(1.02+0.06*on/${frames},1.08)`;
    await ffmpeg([
      "-loop", "1", "-i", s.filePath,
      "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+24*sin(on/${fps}*2.2)':d=${frames}:s=${W}x${H}:fps=${fps},eq=saturation=1.12:contrast=1.04,${norm}`,
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
  } else if (isShorts(input)) {
    // Shorts: referanstaki gibi parlak, tek renk ailesinde yumuşak ışıklı stüdyo arka planı
    const p = input.brand.primaryColor;
    await ffmpeg([
      "-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=${hex(mix(p, "#FFFFFF", 0.18))}:c1=${hex(mix(p, "#000000", 0.35))}:c2=${hex(mix(p, "#000000", 0.6))}:nb_colors=3:x0=${W / 2}:y0=${Math.round(H * 0.38)}:x1=${W / 2}:y1=${H}:speed=0.004:type=radial:r=${fps}:d=${dur.toFixed(3)}:seed=${idx + 3}`,
      "-vf", `noise=alls=3:allf=t,vignette=PI/6,${norm}`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out,
    ]);
  } else {
    // Ücretsiz hareketli grafik: marka renkleriyle akan gradyan + hafif doku
    const c = [input.brand.primaryColor, input.brand.secondaryColor, input.brand.accentColor];
    const c0 = c[idx % 3], c1 = c[(idx + 1) % 3];
    await ffmpeg([
      "-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=${hex(c0)}:c1=${hex(c1)}:c2=0x111827:nb_colors=3:speed=0.012:type=radial:r=${fps}:d=${dur.toFixed(3)}:seed=${idx + 7}`,
      "-vf", `noise=alls=6:allf=t,vignette=PI/5,${norm}`,
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
  const shorts = isShorts(input);
  const outroSec = shorts ? SHORTS_OUTRO : OUTRO;
  const xf = shorts ? SHORTS_XFADE : XFADE;
  const plan = planDurations(input.scenes.map((s) => s.durationSec), input.voiceDurationSec, input.minDurationSec, input.maxDurationSec, outroSec);
  const n = input.scenes.length;

  // Geçiş süresi kadar her segment uzatılır, toplam süre korunur.
  // Shorts şablonunda ayrı kapanış klibi yoktur: son sahne kapanış kartı boyunca ekranda kalır.
  const segDur = plan.scenes.map((d, i) => d + (shorts && i === n - 1 ? outroSec : xf));
  const segFiles: string[] = [];
  for (let i = 0; i < n; i++) segFiles.push(await renderSegment(input, input.scenes[i], segDur[i], i));
  if (!shorts) segFiles.push(await renderOutro(input, outroSec));
  const allDur = shorts ? segDur : [...segDur, outroSec];

  // xfade zinciri
  const parts: string[] = [];
  let prev = "[0:v]";
  let acc = allDur[0];
  const segments: RenderOutput["segments"] = [];
  let tStart = 0;
  for (let i = 0; i < allDur.length; i++) {
    segments.push({ index: i, start: tStart, duration: i < n ? plan.scenes[i] : outroSec, provider: i < n ? input.scenes[i].provider : "outro" });
    tStart += i < n ? plan.scenes[i] : outroSec;
  }
  for (let i = 1; i < allDur.length; i++) {
    const offset = acc - xf;
    const tr = shorts ? SHORTS_TRANSITIONS[i % SHORTS_TRANSITIONS.length] : i === allDur.length - 1 ? "fade" : TRANSITIONS[i % TRANSITIONS.length];
    const label = `[x${i}]`;
    parts.push(`${prev}[${i}:v]xfade=transition=${tr}:duration=${xf}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
    acc = offset + allDur[i];
  }

  // Altyazılar
  let captions: Cue[];
  let ass: string;
  if (shorts) {
    const o = input.shorts ?? { seriesName: input.title };
    const sceneSegs = segments.filter((s) => s.index < n);
    const hookEnd = Math.min(3.0, Math.max(1.6, (sceneSegs[0]?.duration ?? 3) - 0.1));
    captions = buildShortsCaptions(input.words, VOICE_DELAY, o.highlights ?? {});
    ass = buildShortsAss({
      primaryColor: input.brand.primaryColor,
      durationSec: plan.total,
      seriesName: o.seriesName,
      episode: o.episode,
      coverTitle: o.coverTitle?.trim() || input.title,
      hookEndSec: hookEnd,
      words: input.words,
      voiceOffset: VOICE_DELAY,
      highlights: o.highlights ?? {},
      chips: sceneSegs.map((s) => ({ start: s.start + 0.25, end: Math.min(s.start + s.duration - 0.1, s.start + 3.2), text: o.labels?.[s.index] ?? "" })),
      mascotRanges: sceneSegs
        .filter((s) => input.scenes[s.index].kind === "GENERATED")
        .map((s) => ({ start: s.start, end: s.index === n - 1 ? plan.total : s.start + s.duration + xf })),
      outro: { start: plan.total - outroSec + 0.1, end: plan.total, title: "TAKİP ET!", subtitle: o.outroSubtitle ?? null },
      seed: input.title.length + n,
    });
  } else {
    captions = groupWords(input.words, 4, 22, VOICE_DELAY);
    const headlines: Cue[] = segments
      .filter((s) => s.index < n && s.index > 0)
      .map((s) => ({ start: s.start + 0.2, end: s.start + s.duration - 0.1, text: input.scenes[s.index].subtitle }));
    ass = buildAss({
      font: input.brand.font,
      primaryColor: input.brand.primaryColor,
      accentColor: input.brand.accentColor,
      captions,
      headlines,
      intro: { text: input.title, end: 1.7 },
      outro: { text: input.cta, start: plan.total - outroSec + 0.1, end: plan.total },
    });
  }
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

  const fontsDir = shorts ? shortsFontsDir() : undefined;
  let vchain = `${prev}ass=filename=${escapeFilterPath(assPath)}${fontsDir ? `:fontsdir=${escapeFilterPath(fontsDir)}` : ""}`;
  if (logoIdx >= 0) {
    parts.push(`[${logoIdx}:v]scale=${shorts ? 120 : 150}:-1,format=rgba,colorchannelmixer=aa=0.85[logo]`);
    vchain += `[vs];[vs][logo]overlay=W-w-48:${shorts ? 60 : 110}:enable='lt(t,${(plan.total - outroSec).toFixed(2)})'`;
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

  const thumbnailPath = path.join(input.workDir, "thumb.jpg");
  await ffmpeg(["-ss", "0.9", "-i", outputPath, "-frames:v", "1", "-q:v", "3", thumbnailPath], 60);
  const p = await probe(outputPath);
  return { outputPath, thumbnailPath, assPath, durationSec: p.durationSec, captions, segments };
}

function isShorts(input: Pick<RenderInput, "template">) {
  return input.template === SHORTS_TEMPLATE;
}
