import "dotenv/config";
process.env.SERVICE_NAME ??= "scheduler";
import { QUEUE, queue, schedulerTick, logger, assertProductionSecrets, closeQueues, prisma, notify } from "@asf/core";

/**
 * Zamanlayıcı servisi (tek örnek çalışmalı).
 *  - Her dakika: yayın saatlerine göre otomatik üretim başlatır (Europe/Istanbul)
 *  - Her 6 saatte: platform analizleri
 *  - Her saat: bakım (token yenileme, geçici dosya ve oturum temizliği)
 */
assertProductionSecrets();

async function registerRepeatables() {
  await queue(QUEUE.analytics).upsertJobScheduler("analytics-6h", { pattern: "15 */6 * * *", tz: "Europe/Istanbul" }, { name: "collect", data: {} });
  await queue(QUEUE.maintenance).upsertJobScheduler("maintenance-hourly", { pattern: "5 * * * *", tz: "Europe/Istanbul" }, { name: "maintenance", data: {} });
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const started = await schedulerTick();
    if (started.length) logger.info({ started }, "zamanlayıcı: üretim başlatıldı");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "zamanlayıcı hatası");
    await notify({ type: "SYSTEM_ERROR", severity: "ERROR", title: "Zamanlayıcı hatası", message: (err as Error).message, dedupeKey: `sched:${new Date().toISOString().slice(0, 13)}` });
  } finally {
    running = false;
  }
}

await registerRepeatables();
logger.info("zamanlayıcı başladı");
await tick();
const timer = setInterval(tick, 60_000);

async function shutdown() {
  clearInterval(timer);
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
