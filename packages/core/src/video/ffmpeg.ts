import { spawn } from "node:child_process";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

export class FfmpegError extends Error {
  constructor(message: string, public readonly stderr: string, public readonly exitCode: number | null) {
    super(message);
    this.name = "FfmpegError";
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * FFmpeg/FFprobe çalıştırıcı: zaman aşımı, düşük öncelik (nice), stderr sınırı.
 * Sunucunun çökmemesi için iş parçacığı sayısı FFMPEG_THREADS ile sınırlandırılır.
 */
export function run(bin: "ffmpeg" | "ffprobe", args: string[], opts: { timeoutSec?: number } = {}): Promise<RunResult> {
  const e = env();
  const exe = bin === "ffmpeg" ? e.FFMPEG_PATH : e.FFPROBE_PATH;
  const timeoutMs = (opts.timeoutSec ?? e.FFMPEG_TIMEOUT_SEC) * 1000;
  return new Promise((resolve, reject) => {
    const child = spawn("nice", ["-n", "10", exe, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const cap = (s: string, add: string) => (s.length > 200_000 ? s.slice(-150_000) + add : s + add);
    child.stdout.on("data", (d) => (stdout = cap(stdout, d.toString())));
    child.stderr.on("data", (d) => (stderr = cap(stderr, d.toString())));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FfmpegError(`${bin} zaman aşımı (${timeoutMs / 1000}s)`, stderr.slice(-4000), null));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new FfmpegError(`${bin} başlatılamadı: ${err.message}`, "", null));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        logger.warn({ bin, code, tail: stderr.slice(-1500) }, "ffmpeg hatası");
        reject(new FfmpegError(`${bin} çıkış kodu ${code}`, stderr.slice(-4000), code));
      }
    });
  });
}

export function ffmpeg(args: string[], timeoutSec?: number) {
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-threads", String(env().FFMPEG_THREADS), ...args], { timeoutSec });
}

export interface ProbeResult {
  durationSec: number;
  sizeBytes: number;
  formatName: string;
  video?: { codec: string; width: number; height: number; fps: number; pixFmt?: string; profile?: string };
  audio?: { codec: string; sampleRate: number; channels: number };
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutSec: 60 });
  const j = JSON.parse(stdout);
  const v = (j.streams ?? []).find((s: any) => s.codec_type === "video");
  const a = (j.streams ?? []).find((s: any) => s.codec_type === "audio");
  const fps = (r?: string) => {
    if (!r) return 0;
    const [n, d] = r.split("/").map(Number);
    return d ? n / d : n;
  };
  return {
    durationSec: Number(j.format?.duration ?? 0),
    sizeBytes: Number(j.format?.size ?? 0),
    formatName: j.format?.format_name ?? "",
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: fps(v.avg_frame_rate || v.r_frame_rate), pixFmt: v.pix_fmt, profile: v.profile } : undefined,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : undefined,
  };
}

/** FFmpeg filtergraph içindeki metin için kaçış */
export function escapeFilterText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%").replace(/,/g, "\\,");
}

/** Filtergraph içindeki dosya yolu kaçışı */
export function escapeFilterPath(p: string) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
