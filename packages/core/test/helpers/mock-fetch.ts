import { vi } from "vitest";

/**
 * MOCK fetch – dış API'lere gerçek istek göndermez. Her çağrı kaydedilir;
 * cevaplar test içinde tanımlanan kurallara göre üretilir (gerçek platform cevabı DEĞİLDİR).
 */
export interface Call { method: string; url: string; headers: Record<string, string>; body: any }
type Handler = (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } | undefined;

export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    let body: any = init.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* düz metin */ } }
    if (body instanceof URLSearchParams) body = Object.fromEntries(body);
    const c = { method: (init.method ?? "GET").toUpperCase(), url, headers, body };
    calls.push(c);
    const r = handler(c);
    if (!r) return new Response(JSON.stringify({ error: { message: `MOCK: beklenmeyen istek ${c.method} ${url}` } }), { status: 599 });
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200, headers: r.headers });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
