import "dotenv/config";
process.env.SERVICE_NAME ??= "worker";
import { Worker, type Job } from "bullmq";
import {
  QUEUE,
  PLATFORM_LIMITS,
  redisConnection,
  generateVideo,
  runPublishJob,
  checkPublishStatus,
  collectAnalytics,
  runMaintenance,
  notify,
  logger,
  env,
  assertProductionSecrets,
  closeQueues,
  prisma,
  type Platform,
} from "@asf/core";

/**
 * Worker servisi:
 *  - video-generate: tam üretim hattı (FFmpeg yoğun → eşzamanlılık RENDER_CONCURRENCY)
 *  - publish-<platform>: her platform için ayrı kuyruk ve hız sınırı (bir platformdaki hata diğerini durdurmaz)
 *  - publish-status: işleme süren yayınların kontrolü
 *  - analytics / maintenance
 */
assertProductionSecrets();
const connection = redisConnection();
const workers: Worker[] = [];

function attach(w: Worker, name: string) {
  w.on("failed", async (job: Job | undefined, err: Error) => {
    logger.error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, "iş başarısız");
  });
  w.on("error", (err) => logger.error({ queue: name, err: err.message }, "worker hatası"));
  workers.push(w);
}

attach(
  new Worker(QUEUE.generate, async (job) => generateVideo(job.data.videoId, job.attemptsMade).then((v) => ({ status: v.status })), {
    connection,
    concurrency: env().RENDER_CONCURRENCY,
    lockDuration: 15 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  }),
  QUEUE.generate,
);

for (const p of ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as Platform[]) {
  const name = QUEUE.publish(p);
  attach(
    new Worker(name, async (job) => runPublishJob(job.data.publishJobId, job.attemptsMade), {
      connection,
      concurrency: 2,
      limiter: PLATFORM_LIMITS[p],
      lockDuration: 20 * 60_000,
    }),
    name,
  );
}

attach(new Worker(QUEUE.publishStatus, async (job) => checkPublishStatus(job.data.publishJobId, job.data.checks ?? 0), { connection, concurrency: 4 }), QUEUE.publishStatus);
attach(new Worker(QUEUE.analytics, async (job) => collectAnalytics(job.data?.brandId), { connection, concurrency: 1, lockDuration: 30 * 60_000 }), QUEUE.analytics);
attach(new Worker(QUEUE.maintenance, async () => runMaintenance(), { connection, concurrency: 1 }), QUEUE.maintenance);

logger.info({ queues: workers.map((w) => w.name) }, "worker başladı");

process.on("unhandledRejection", (err) => {
  logger.error({ err: String(err) }, "unhandledRejection");
  void notify({ type: "SYSTEM_ERROR", severity: "ERROR", title: "Sistem hatası (worker)", message: String(err).slice(0, 500), dedupeKey: `sys:${String(err).slice(0, 80)}:${new Date().toISOString().slice(0, 13)}` });
});

async function shutdown(sig: string) {
  logger.info({ sig }, "worker kapanıyor");
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
