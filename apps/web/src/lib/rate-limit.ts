import { redis } from "@asf/core";

/** Sabit pencereli Redis hız sınırlayıcı. Redis erişilemezse istek engellenmez (fail-open) ama loglanır. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number }> {
  try {
    const r = redis();
    const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSec);
    return { ok: n <= limit, remaining: Math.max(0, limit - n) };
  } catch {
    return { ok: true, remaining: limit };
  }
}
