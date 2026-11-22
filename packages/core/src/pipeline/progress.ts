import { redis } from "../queue/queues";
import { logger } from "../lib/logger";

/**
 * Video üretim ilerlemesi (yüzde). Redis'te kısa ömürlü tutulur; veritabanı şeması değişmez.
 * Her aşama toplam ilerlemenin bir aralığını kaplar, aşama içi ilerleme bu aralığa yayılır.
 */
export const PROGRESS_STAGES = {
  QUEUED: [0, 2],
  SCRIPTING: [2, 15],
  FETCHING_MEDIA: [15, 25],
  VOICING: [25, 35],
  RENDERING: [35, 95],
  QUALITY_CHECK: [95, 99],
} as const satisfies Record<string, readonly [number, number]>;

export type ProgressStage = keyof typeof PROGRESS_STAGES;

export const STAGE_LABELS: Record<string, string> = {
  QUEUED: "Sırada bekliyor",
  SCRIPTING: "Senaryo yazılıyor",
  FETCHING_MEDIA: "Görseller hazırlanıyor",
  VOICING: "Seslendirme yapılıyor",
  RENDERING: "Video birleştiriliyor",
  QUALITY_CHECK: "Kalite kontrol",
  READY: "Hazır",
  QC_FAILED: "Kalite kontrolünden geçemedi",
  FAILED: "Başarısız",
  CANCELLED: "İptal edildi",
};

export interface VideoProgress {
  percent: number;
  stage: string;
  detail: string | null;
  /** Bu denemenin başladığı an (ISO) – kalan süre tahmini için */
  startedAt: string | null;
  updatedAt: string;
}

const KEY = (videoId: string) => `video:progress:${videoId}`;
const TTL_SEC = 24 * 3600;

export function stagePercent(stage: string, fraction = 0): number {
  const range = (PROGRESS_STAGES as Record<string, readonly [number, number]>)[stage];
  if (!range) return ["READY", "PUBLISHING", "PUBLISHED", "PARTIALLY_PUBLISHED", "QC_FAILED"].includes(stage) ? 100 : 0;
  const f = Math.min(1, Math.max(0, fraction));
  return Math.round(range[0] + (range[1] - range[0]) * f);
}

/** İlerlemeyi kaydeder. Hiçbir zaman hata fırlatmaz: ilerleme göstergesi üretimi durdurmamalı. */
export async function reportProgress(videoId: string, stage: ProgressStage, fraction = 0, detail: string | null = null): Promise<void> {
  try {
    const r = redis();
    const prev = await r.get(KEY(videoId));
    const old = prev ? (JSON.parse(prev) as VideoProgress) : null;
    const now = new Date().toISOString();
    // Yeni deneme SCRIPTING ile başlar; başlangıç zamanı orada sıfırlanır
    const startedAt = stage === "SCRIPTING" && fraction === 0 ? now : old?.startedAt ?? (stage === "QUEUED" ? null : now);
    const percent = stagePercent(stage, fraction);
    const value: VideoProgress = { percent, stage, detail, startedAt, updatedAt: now };
    await r.set(KEY(videoId), JSON.stringify(value), "EX", TTL_SEC);
  } catch (err) {
    logger.warn({ videoId, err: (err as Error).message }, "ilerleme kaydedilemedi");
  }
}

export async function readProgress(videoIds: string[]): Promise<Record<string, VideoProgress | null>> {
  const out: Record<string, VideoProgress | null> = {};
  if (!videoIds.length) return out;
  try {
    const values = await redis().mget(...videoIds.map(KEY));
    videoIds.forEach((id, i) => {
      try { out[id] = values[i] ? (JSON.parse(values[i]!) as VideoProgress) : null; } catch { out[id] = null; }
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "ilerleme okunamadı");
    videoIds.forEach((id) => (out[id] = null));
  }
  return out;
}

/**
 * Kalan süre tahmini (saniye). Bu denemenin geçen süresi ve yüzdesinden hesaplanır;
 * yüzde çok düşükken geçmiş videoların ortalama süresine düşer.
 */
export function estimateRemainingSec(p: { percent: number; startedAt: string | null }, typicalTotalSec: number | null, now = Date.now()): number | null {
  if (p.percent >= 100) return 0;
  const elapsed = p.startedAt ? Math.max(0, (now - Date.parse(p.startedAt)) / 1000) : null;
  if (elapsed !== null && p.percent >= 10) {
    const total = (elapsed * 100) / p.percent;
    return Math.max(5, Math.round(total - elapsed));
  }
  if (typicalTotalSec) {
    const rest = elapsed !== null ? typicalTotalSec - elapsed : typicalTotalSec * (1 - p.percent / 100);
    return Math.max(5, Math.round(rest));
  }
  return null;
}
