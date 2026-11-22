import { stat } from "node:fs/promises";
import { probe, run } from "../video/ffmpeg";

export interface QcCheck {
  id: string;
  label: string;
  passed: boolean;
  value?: string | number | null;
  expected?: string;
  severity: "error" | "warning";
}

export interface QcReport {
  passed: boolean;
  checks: QcCheck[];
  measuredAt: string;
  metrics: {
    durationSec?: number;
    width?: number;
    height?: number;
    fps?: number;
    sizeBytes?: number;
    integratedLufs?: number | null;
    maxVolumeDb?: number | null;
    blackSec?: number;
    decodeErrors?: number;
  };
}

export interface QcInput {
  filePath: string;
  minDurationSec: number;
  maxDurationSec: number;
  videoFormat?: "portrait" | "landscape";
  maxSizeMb: number;
  captionsCount: number;
  /** Medya manifestosu: her sahnenin lisans bilgisi */
  media: { provider: string; license: string; commercialUse: boolean }[];
  /** Senaryo güvenlik kontrolünden gelen engelleyici bayraklar */
  contentBlocking: string[];
  musicLicensed?: boolean | null;
}

/** EBU R128 entegre ses yüksekliği */
export async function measureLoudness(file: string) {
  try {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=framelog=quiet,volumedetect", "-f", "null", "-"], { timeoutSec: 900 });
    const i = /I:\s+(-?[\d.]+)\s+LUFS/.exec(stderr.split("Summary:").pop() ?? "");
    const mx = /max_volume:\s+(-?[\d.]+) dB/.exec(stderr);
    return { integratedLufs: i ? Number(i[1]) : null, maxVolumeDb: mx ? Number(mx[1]) : null };
  } catch {
    return { integratedLufs: null, maxVolumeDb: null };
  }
}

export async function detectBlack(file: string) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.5:pic_th=0.97:pix_th=0.08", "-an", "-f", "null", "-"], { timeoutSec: 900 });
  let total = 0;
  for (const m of stderr.matchAll(/black_duration:\s*([\d.]+)/g)) total += Number(m[1]);
  return total;
}

export async function decodeErrors(file: string) {
  try {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-v", "error", "-i", file, "-f", "null", "-"], { timeoutSec: 900 });
    return stderr.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 999;
  }
}

/**
 * Yayın öncesi kalite kontrolü. Herhangi bir "error" seviyesindeki kontrol başarısızsa
 * video yayın kuyruğuna ALINMAZ.
 */
export async function runQualityCheck(input: QcInput): Promise<QcReport> {
  const checks: QcCheck[] = [];
  const metrics: QcReport["metrics"] = {};
  const add = (c: QcCheck) => checks.push(c);

  let p;
  try {
    const st = await stat(input.filePath);
    p = await probe(input.filePath);
    metrics.sizeBytes = st.size;
    add({ id: "opens", label: "Dosya açılabiliyor", passed: true, severity: "error" });
  } catch (err) {
    add({ id: "opens", label: "Dosya açılabiliyor", passed: false, value: (err as Error).message, severity: "error" });
    return { passed: false, checks, metrics, measuredAt: new Date().toISOString() };
  }

  metrics.durationSec = p.durationSec;
  metrics.width = p.video?.width;
  metrics.height = p.video?.height;
  metrics.fps = p.video?.fps;

  add({ id: "duration", label: "Video süresi", passed: p.durationSec >= input.minDurationSec - 0.5 && p.durationSec <= input.maxDurationSec + 0.5, value: Number(p.durationSec.toFixed(2)), expected: `${input.minDurationSec}-${input.maxDurationSec} sn`, severity: "error" });
  const landscape = input.videoFormat === "landscape";
  const expectedWidth = landscape ? 1920 : 1080;
  const expectedHeight = landscape ? 1080 : 1920;
  const expectedRatio = landscape ? 16 / 9 : 9 / 16;
  add({ id: "resolution", label: "Çözünürlük", passed: p.video?.width === expectedWidth && p.video?.height === expectedHeight, value: `${p.video?.width}x${p.video?.height}`, expected: `${expectedWidth}x${expectedHeight}`, severity: "error" });
  const ratio = p.video ? p.video.width / p.video.height : 0;
  add({ id: "aspect", label: "En-boy oranı", passed: Math.abs(ratio - expectedRatio) < 0.01, value: ratio.toFixed(4), expected: landscape ? "16:9 (1.7778)" : "9:16 (0.5625)", severity: "error" });
  add({ id: "fps", label: "Kare hızı", passed: !!p.video && Math.abs(p.video.fps - 30) < 0.5, value: p.video?.fps, expected: "30", severity: "error" });
  add({ id: "vcodec", label: "Video codec", passed: p.video?.codec === "h264" && p.video?.pixFmt === "yuv420p", value: `${p.video?.codec}/${p.video?.pixFmt}`, expected: "h264/yuv420p", severity: "error" });
  add({ id: "audio", label: "Ses var", passed: !!p.audio, value: p.audio ? `${p.audio.codec} ${p.audio.sampleRate}Hz ${p.audio.channels}ch` : "yok", expected: "aac", severity: "error" });
  add({ id: "acodec", label: "Ses codec", passed: p.audio?.codec === "aac", value: p.audio?.codec ?? null, expected: "aac", severity: "error" });

  const loud = await measureLoudness(input.filePath);
  metrics.integratedLufs = loud.integratedLufs;
  metrics.maxVolumeDb = loud.maxVolumeDb;
  add({ id: "loudness", label: "Ses seviyesi", passed: loud.integratedLufs !== null && loud.integratedLufs >= -20 && loud.integratedLufs <= -9, value: loud.integratedLufs, expected: "-20 … -9 LUFS", severity: "error" });
  add({ id: "clipping", label: "Ses kırpılması yok", passed: loud.maxVolumeDb !== null && loud.maxVolumeDb <= 0, value: loud.maxVolumeDb, expected: "≤ 0 dBFS", severity: "warning" });

  add({ id: "subtitles", label: "Altyazı var", passed: input.captionsCount > 0, value: input.captionsCount, expected: "> 0", severity: "error" });

  const black = await detectBlack(input.filePath);
  metrics.blackSec = Number(black.toFixed(2));
  add({ id: "black", label: "Siyah ekran yok", passed: black < 1.0, value: metrics.blackSec, expected: "< 1 sn", severity: "error" });

  const derr = await decodeErrors(input.filePath);
  metrics.decodeErrors = derr;
  add({ id: "corrupt", label: "Bozuk kare yok", passed: derr === 0, value: derr, expected: "0 hata", severity: "error" });

  const sizeMb = (metrics.sizeBytes ?? 0) / 1024 / 1024;
  add({ id: "size", label: "Dosya boyutu", passed: sizeMb > 0.2 && sizeMb <= input.maxSizeMb, value: Number(sizeMb.toFixed(2)), expected: `≤ ${input.maxSizeMb} MB`, severity: "error" });

  const unlicensed = input.media.filter((m) => !m.commercialUse || !m.license);
  add({ id: "license", label: "Görüntü lisansı uygun", passed: unlicensed.length === 0 && input.musicLicensed !== false, value: unlicensed.map((m) => m.provider).join(", ") || "tümü uygun", severity: "error" });
  add({ id: "policy", label: "İçerik platform kurallarına uygun", passed: input.contentBlocking.length === 0, value: input.contentBlocking.join(", ") || "sorun yok", severity: "error" });

  return { passed: checks.every((c) => c.passed || c.severity !== "error"), checks, metrics, measuredAt: new Date().toISOString() };
}
