import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { purgeExpiredSessions } from "../auth/session";
import { publisherFor } from "../publishers/registry";
import { getValidAccessToken, markAccountError, readToken, storeToken } from "../publishers/tokens";
import { metaDebugToken, metaConfigured } from "../publishers/meta";
import { recordUsage } from "../budget/budget";
import { storageCostPerMonth } from "../budget/pricing";
import { monthRange } from "../lib/time";

/** Süresi dolmak üzere olan token'ları yeniler; Meta token geçerliliğini kontrol eder */
export async function refreshTokens() {
  const soon = new Date(Date.now() + 2 * 3600_000);
  const rows = await prisma.oAuthToken.findMany({ where: { expiresAt: { lt: soon } }, include: { socialAccount: true } });
  for (const r of rows) {
    if (r.socialAccount.status !== "CONNECTED") continue;
    try {
      const t = await readToken(r.socialAccountId);
      if (!t) continue;
      const nt = await publisherFor(r.socialAccount.platform).refreshToken(t);
      if (nt) await storeToken(r.socialAccount, nt);
    } catch (err) {
      await markAccountError(r.socialAccount, "TOKEN_EXPIRED", (err as Error).message);
    }
  }
  if (metaConfigured()) {
    const metaAccts = await prisma.socialAccount.findMany({ where: { status: "CONNECTED", platform: { in: ["FACEBOOK", "INSTAGRAM"] } } });
    for (const a of metaAccts) {
      try {
        const info = await metaDebugToken(await getValidAccessToken(a));
        if (!info.is_valid) await markAccountError(a, "TOKEN_EXPIRED", "Meta token geçersiz (şifre değişikliği veya izin kaldırma)");
        else await prisma.socialAccount.update({ where: { id: a.id }, data: { lastCheckedAt: new Date() } });
      } catch (err) {
        logger.warn({ accountId: a.id, err: (err as Error).message }, "meta token kontrolü başarısız");
      }
    }
  }
}

/** Yarım kalmış geçici dosyaları temizler (6 saatten eski) */
export async function cleanupWorkDir() {
  const dir = env().WORK_DIR;
  let removed = 0;
  try {
    for (const name of await readdir(dir)) {
      const p = path.join(dir, name);
      const st = await stat(p);
      if (Date.now() - st.mtimeMs > 6 * 3600_000) {
        await rm(p, { recursive: true, force: true });
        removed++;
      }
    }
  } catch {
    /* klasör yok */
  }
  return removed;
}

/** Aylık depolama ve sunucu maliyetini kaydeder (ayda bir, tekrarı engellenir) */
export async function recordMonthlyFixedCosts(at = new Date()) {
  const { start } = monthRange(undefined, at);
  const exists = await prisma.aIUsageLog.findFirst({ where: { provider: { in: ["STORAGE", "SERVER"] }, createdAt: { gte: start }, operation: "monthly.fixed" } });
  if (exists) return false;
  const agg = await prisma.video.aggregate({ _sum: { sizeBytes: true } });
  const bytes = Number(agg._sum.sizeBytes ?? 0);
  await recordUsage({ provider: "STORAGE", operation: "monthly.fixed", units: bytes / 1024 ** 3, costUsd: storageCostPerMonth(bytes), metadata: { bytes } });
  if (env().SERVER_MONTHLY_COST_USD > 0) await recordUsage({ provider: "SERVER", operation: "monthly.fixed", costUsd: env().SERVER_MONTHLY_COST_USD });
  return true;
}

export async function runMaintenance() {
  const sessions = await purgeExpiredSessions();
  const files = await cleanupWorkDir();
  await refreshTokens();
  await recordMonthlyFixedCosts();
  logger.info({ sessions, files }, "bakım tamamlandı");
}
