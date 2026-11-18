/**
 * Test ortamı: ayrı test veritabanı (asf_test), ayrı Redis DB (15), geçici yerel depolama.
 * Gerçek dış API anahtarları KULLANILMAZ; dış servis çağrıları testlerde açıkça "MOCK" olarak işaretlenmiş
 * sahte fetch/istemcilerle simüle edilir.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `asf-test-${process.pid}`);
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://asf:asf_dev_pw@localhost:5432/asf_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  SESSION_SECRET: randomBytes(32).toString("base64"),
  MEDIA_SIGNING_SECRET: randomBytes(32).toString("base64"),
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_DIR: path.join(tmp, "storage"),
  WORK_DIR: path.join(tmp, "work"),
  APP_URL: "http://localhost:3000",
  LOG_LEVEL: "silent",
});
for (const k of ["OPENAI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_TTS_CREDENTIALS_JSON", "PEXELS_API_KEY", "PIXABAY_API_KEY", "META_APP_ID", "META_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "SMTP_HOST", "TIKTOK_DIRECT_POST_AUDITED", "TOKEN_ENCRYPTION_KEY_PREVIOUS"]) delete process.env[k];
