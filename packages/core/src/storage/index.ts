import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat, access, constants } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { timingSafeEqual } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../lib/env";
import { hmac } from "../lib/crypto";
import { AppError, NotConfiguredError } from "../lib/errors";

/**
 * Depolama katmanı: üretilen videolar, küçük resimler, marka logoları ve kütüphane medyası.
 * İki sürücü aynı arayüzü uygular:
 *  - local: LOCAL_STORAGE_DIR altında disk (Docker'da `storage` volume'u, /data/storage)
 *  - r2:    Cloudflare R2 (S3 uyumlu)
 * Anahtarlar her zaman göreli, "/" ayraçlı yollardır (ör. videos/{brandId}/{id}.mp4).
 */

export interface PutResult {
  key: string;
  sizeBytes: number;
}

export interface HealthResult {
  ok: boolean;
  message?: string;
}

export interface StorageDriver {
  readonly name: "local" | "r2";
  putFile(key: string, filePath: string, contentType?: string): Promise<PutResult>;
  getToFile(key: string, filePath: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Dış platformların (Instagram/Facebook) çekebileceği, süreli erişim adresi */
  publicUrl(key: string, ttlSec: number): Promise<string>;
  getObjectStream?(key: string, range?: string): Promise<{ body: Readable; contentLength?: number; contentRange?: string }>;
  healthCheck(): Promise<HealthResult>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".json": "application/json",
};

/** Dosya uzantısından MIME türü */
export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Anahtarı doğrular: boş, mutlak, "..", ters bölü veya NUL içeren anahtarlar reddedilir */
function normalizeKey(key: string): string {
  if (typeof key !== "string" || !key || key.includes("\0") || key.includes("\\") || key.startsWith("/")) {
    throw new AppError("Geçersiz depolama anahtarı", "INVALID_KEY", 400);
  }
  const parts = key.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw new AppError("Geçersiz depolama anahtarı", "INVALID_KEY", 400);
  return parts.join("/");
}

/** Yerel depolamada anahtarın mutlak dosya yolu; kök dizin dışına çıkış engellenir */
export function localStoragePath(key: string): string {
  const root = path.resolve(env().LOCAL_STORAGE_DIR);
  const p = path.resolve(root, normalizeKey(key));
  if (p !== root && !p.startsWith(root + path.sep)) throw new AppError("Geçersiz depolama anahtarı", "INVALID_KEY", 400);
  return p;
}

// ---- İmzalı medya URL'leri (yerel sürücü için /api/media/{key}?exp=&sig=) ----

function signingSecret(): string | undefined {
  const s = env().MEDIA_SIGNING_SECRET;
  return s && s.length >= 16 ? s : undefined;
}

function signaturePayload(key: string, exp: number) {
  return `media:${key}:${exp}`;
}

/** Anahtar + bitiş zamanı (unix saniye) için HMAC-SHA256 imzası */
export function signMediaKey(key: string, exp: number): string {
  const secret = signingSecret();
  if (!secret) throw new NotConfiguredError("Medya URL imzalama", ["MEDIA_SIGNING_SECRET"]);
  return hmac(secret, signaturePayload(normalizeKey(key), exp));
}

/** İmzayı ve süreyi sabit zamanlı karşılaştırma ile doğrular */
export function verifyMediaSignature(key: string, exp: number, sig: string): boolean {
  const secret = signingSecret();
  if (!secret || !sig || !Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  let normalized: string;
  try {
    normalized = normalizeKey(key);
  } catch {
    return false;
  }
  const expected = Buffer.from(hmac(secret, signaturePayload(normalized, exp)));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---- Yerel sürücü ----

export class LocalDriver implements StorageDriver {
  readonly name = "local" as const;

  async putFile(key: string, filePath: string): Promise<PutResult> {
    const dst = localStoragePath(key);
    await mkdir(path.dirname(dst), { recursive: true });
    if (path.resolve(filePath) !== dst) await copyFile(filePath, dst);
    const st = await stat(dst);
    return { key: normalizeKey(key), sizeBytes: st.size };
  }

  async getToFile(key: string, filePath: string): Promise<void> {
    const src = localStoragePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    if (path.resolve(filePath) !== src) await copyFile(src, filePath);
  }

  async delete(key: string): Promise<void> {
    await rm(localStoragePath(key), { force: true });
  }

  async publicUrl(key: string, ttlSec: number): Promise<string> {
    const k = normalizeKey(key);
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSec));
    const e = env();
    const base = (e.PUBLIC_MEDIA_BASE_URL ?? e.APP_URL).replace(/\/+$/, "");
    const encoded = k.split("/").map(encodeURIComponent).join("/");
    return `${base}/api/media/${encoded}?exp=${exp}&sig=${signMediaKey(k, exp)}`;
  }

  async healthCheck(): Promise<HealthResult> {
    const root = path.resolve(env().LOCAL_STORAGE_DIR);
    try {
      await mkdir(root, { recursive: true });
      await access(root, constants.R_OK | constants.W_OK);
      return { ok: true, message: `Yerel disk: ${root}` };
    } catch (err) {
      return { ok: false, message: `Yerel depolama dizinine yazılamıyor: ${(err as Error).message}` };
    }
  }
}

// ---- Cloudflare R2 sürücüsü ----

export class R2Driver implements StorageDriver {
  readonly name = "r2" as const;
  private client: S3Client;
  private bucket: string;
  private publicBase?: string;

  constructor() {
    const e = env();
    const required = { R2_ACCOUNT_ID: e.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: e.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: e.R2_SECRET_ACCESS_KEY, R2_BUCKET: e.R2_BUCKET };
    const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new NotConfiguredError("Cloudflare R2 depolama", missing);
    this.bucket = e.R2_BUCKET!;
    this.publicBase = e.R2_PUBLIC_BASE_URL ? e.R2_PUBLIC_BASE_URL.replace(/\/+$/, "") : undefined;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: e.R2_ACCESS_KEY_ID!, secretAccessKey: e.R2_SECRET_ACCESS_KEY! },
    });
  }

  async putFile(key: string, filePath: string, contentType?: string): Promise<PutResult> {
    const k = normalizeKey(key);
    const st = await stat(filePath);
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: k, Body: createReadStream(filePath), ContentType: contentType ?? contentTypeFor(filePath), ContentLength: st.size },
    }).done();
    return { key: k, sizeBytes: st.size };
  }

  async getObjectStream(key: string, range?: string): Promise<{ body: Readable; contentLength?: number; contentRange?: string }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: normalizeKey(key), ...(range ? { Range: range } : {}) }));
    if (!res.Body) throw new Error("R2 dosya içeriği boş");
    return { body: res.Body as Readable, contentLength: res.ContentLength, contentRange: res.ContentRange };
  }

  async getToFile(key: string, filePath: string): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: normalizeKey(key) }));
    if (!res.Body) throw new Error(`R2 nesnesi boş: ${key}`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(res.Body as Readable, createWriteStream(filePath));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: normalizeKey(key) }));
  }

  async publicUrl(key: string, ttlSec: number): Promise<string> {
    const k = normalizeKey(key);
    if (this.publicBase) return `${this.publicBase}/${k.split("/").map(encodeURIComponent).join("/")}`;
    // S3 imzalı URL en fazla 7 gün geçerli olabilir
    const expiresIn = Math.min(Math.max(1, Math.floor(ttlSec)), 7 * 24 * 3600);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: k }), { expiresIn });
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, message: `R2 bucket: ${this.bucket}` };
    } catch (err) {
      return { ok: false, message: `R2 erişilemiyor: ${(err as Error).name ?? "hata"}` };
    }
  }
}

// ---- Tekil erişim (tembel; derleme sırasında yapılandırma gerekmez) ----

let cached: { driverName: string; driver: StorageDriver } | null = null;

export function storage(): StorageDriver {
  const driverName = env().STORAGE_DRIVER;
  if (!cached || cached.driverName !== driverName) {
    cached = { driverName, driver: driverName === "r2" ? new R2Driver() : new LocalDriver() };
  }
  return cached.driver;
}

/** Testler için */
export function resetStorageCache() {
  cached = null;
}
