import { NextResponse } from "next/server";
import { prisma, redis, storage } from "@asf/core";

export const dynamic = "force-dynamic";

/** Docker/Nginx sağlık kontrolü: veritabanı, Redis, depolama */
export async function GET() {
  const checks: Record<string, { ok: boolean; message?: string }> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, message: (err as Error).message.slice(0, 120) };
  }
  try {
    checks.redis = { ok: (await redis().ping()) === "PONG" };
  } catch (err) {
    checks.redis = { ok: false, message: (err as Error).message.slice(0, 120) };
  }
  try {
    checks.storage = await storage().healthCheck();
  } catch (err) {
    checks.storage = { ok: false, message: (err as Error).message.slice(0, 120) };
  }
  const healthy = checks.database.ok && checks.redis.ok;
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
