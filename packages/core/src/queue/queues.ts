import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import type { Platform } from "../lib/db";
import { env } from "../lib/env";

export const QUEUE = {
  generate: "video-generate",
  publishStatus: "publish-status",
  analytics: "analytics",
  maintenance: "maintenance",
  publish: (p: Platform) => `publish-${p.toLowerCase()}`,
} as const;

/** Platform bazlı hız sınırları (BullMQ limiter) – platform kotalarının çok altında tutulur */
export const PLATFORM_LIMITS: Record<Platform, { max: number; duration: number }> = {
  INSTAGRAM: { max: 5, duration: 60_000 },
  FACEBOOK: { max: 5, duration: 60_000 },
  TIKTOK: { max: 2, duration: 60_000 }, // video/init: 6 istek/dk/kullanıcı
  YOUTUBE: { max: 3, duration: 60_000 },
};

let connection: IORedis | null = null;
export function redis(): IORedis {
  connection ??= new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  return connection;
}
export function redisConnection(): ConnectionOptions {
  return redis() as unknown as ConnectionOptions;
}

const queues = new Map<string, Queue>();
export function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, q);
  }
  return q;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 7 * 86400, count: 2000 },
  // Başarısız işler 30 gün saklanır (failed job queue)
  removeOnFail: { age: 30 * 86400 },
};

export const GENERATE_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 5 * 60_000 },
  removeOnComplete: { age: 7 * 86400 },
  removeOnFail: { age: 30 * 86400 },
};

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}

export async function queueCounts() {
  const names = [QUEUE.generate, QUEUE.publishStatus, QUEUE.analytics, ...(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as Platform[]).map(QUEUE.publish)];
  const out: Record<string, Record<string, number>> = {};
  for (const n of names) out[n] = await queue(n).getJobCounts("waiting", "active", "delayed", "failed", "completed");
  return out;
}
