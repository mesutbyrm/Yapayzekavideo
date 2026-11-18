import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM token şifreleme.
 * Format: v{keyVersion}:{iv_b64}:{tag_b64}:{ciphertext_b64}
 * Anahtar rotasyonu: TOKEN_ENCRYPTION_KEY (v2 / güncel) ve TOKEN_ENCRYPTION_KEY_PREVIOUS (v1).
 */
const ALGO = "aes-256-gcm";

function decodeKey(raw: string | undefined, name: string): Buffer {
  if (!raw) throw new Error(`${name} tanımlı değil. 'openssl rand -base64 32' ile oluşturun.`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} 32 byte (base64) olmalı, ${buf.length} byte bulundu.`);
  return buf;
}

function currentKey(): { key: Buffer; version: number } {
  const e = env();
  return { key: decodeKey(e.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY"), version: e.TOKEN_ENCRYPTION_KEY_PREVIOUS ? 2 : 1 };
}

function keyForVersion(version: number): Buffer {
  const e = env();
  const hasPrev = !!e.TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (hasPrev && version === 1) return decodeKey(e.TOKEN_ENCRYPTION_KEY_PREVIOUS, "TOKEN_ENCRYPTION_KEY_PREVIOUS");
  return decodeKey(e.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY");
}

export function encryptSecret(plain: string, aad = "asf"): string {
  const { key, version } = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(payload: string, aad = "asf"): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) throw new Error("Geçersiz şifreli veri formatı");
  const version = Number(parts[0].slice(1));
  const key = keyForVersion(version);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(parts[1], "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(parts[2], "base64"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** PKCE (S256) */
export function pkcePair() {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
