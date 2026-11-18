import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { ProviderError } from "../lib/errors";

const MAX_BYTES = 250 * 1024 * 1024;

/** Boyut sınırlı, zaman aşımlı dosya indirme */
export async function downloadToFile(url: string, dest: string, provider: string, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok || !res.body) throw new ProviderError(`${provider} indirme hatası HTTP ${res.status}`, provider, `HTTP_${res.status}`, res.status >= 500 || res.status === 429);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new ProviderError(`${provider} dosyası çok büyük (${len} byte)`, provider, "TOO_LARGE", false);
    let seen = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        if (seen > MAX_BYTES) cb(new Error("Dosya boyutu sınırı aşıldı"));
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as any), limiter, createWriteStream(dest));
    return seen;
  } catch (err) {
    await rm(dest, { force: true });
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`${provider} indirme başarısız: ${(err as Error).message}`, provider, "DOWNLOAD_FAILED", true);
  } finally {
    clearTimeout(timer);
  }
}
