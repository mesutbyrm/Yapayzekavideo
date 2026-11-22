import { z } from "zod";

/**
 * Bütün ortam değişkenleri tek noktada doğrulanır.
 * Opsiyonel entegrasyonlar (OpenAI, TTS, R2, platform anahtarları) eksikse
 * sistem çökmez; ilgili modül "yapılandırılmadı" durumunu açıkça raporlar.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PUBLIC_MEDIA_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Güvenlik
  TOKEN_ENCRYPTION_KEY: z.string().optional(), // 32 byte base64 (AES-256-GCM)
  TOKEN_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  MEDIA_SIGNING_SECRET: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().default(24 * 7),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  AI_TEXT_PROVIDER: z.enum(["openai", "anthropic"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  ANTHROPIC_INPUT_PRICE_PER_1M: z.coerce.number().default(2),
  ANTHROPIC_OUTPUT_PRICE_PER_1M: z.coerce.number().default(10),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_MODERATION_MODEL: z.string().default("omni-moderation-latest"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1-mini"),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("whisper-1"),
  OPENAI_INPUT_PRICE_PER_1M: z.coerce.number().default(0.25),
  OPENAI_OUTPUT_PRICE_PER_1M: z.coerce.number().default(2.0),
  AI_IMAGES_ENABLED: bool,
  AI_IMAGE_PRICE_USD: z.coerce.number().default(0.011),

  // Google TTS
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_TTS_CREDENTIALS_JSON: z.string().optional(),
  GOOGLE_TTS_PRICE_PER_1M_CHARS: z.coerce.number().default(16),

  // Stok medya
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),

  // Depolama (Cloudflare R2 – S3 uyumlu)
  STORAGE_DRIVER: z.enum(["r2", "local"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),
  R2_PRICE_PER_GB_MONTH: z.coerce.number().default(0.015),
  SERVER_MONTHLY_COST_USD: z.coerce.number().default(0),

  // Video işleme
  WORK_DIR: z.string().default("/tmp/asf-work"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  /** Kodla sahne görseli üreten motion_art.py için Python (Pillow gerekli) */
  MOTION_ART_PYTHON: z.string().default("python3"),
  FFMPEG_THREADS: z.coerce.number().default(2),
  FFMPEG_TIMEOUT_SEC: z.coerce.number().default(600),
  RENDER_CONCURRENCY: z.coerce.number().default(1),
  SUBTITLE_FONT: z.string().default("DejaVu Sans"),

  // Meta (Instagram + Facebook)
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v27.0"),

  // TikTok
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  /** TikTok uygulama denetimi (audit) tamamlandıysa true. false iken yalnızca SELF_ONLY yayın mümkündür. */
  TIKTOK_DIRECT_POST_AUDITED: bool,

  // YouTube (Google OAuth)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  // E-posta
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("AI Social Factory <no-reply@localhost>"),
  ALERT_EMAIL: z.string().optional(),

  // İlk yönetici (yalnızca seed sırasında)
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    // Boş değerler (ör. .env'de "KEY=") tanımsız kabul edilir; varsayılanlar devreye girer
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        "Geçersiz ortam değişkenleri: " +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      );
    }
    cached = parsed.data;
  }
  return cached;
}

/** Testler için */
export function resetEnvCache() {
  cached = null;
}

/** Üretim ortamında zorunlu güvenlik ayarlarını doğrular. */
export function assertProductionSecrets() {
  const e = env();
  if (e.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!e.TOKEN_ENCRYPTION_KEY) missing.push("TOKEN_ENCRYPTION_KEY");
  if (!e.SESSION_SECRET || e.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET (>=32 karakter)");
  if (!e.MEDIA_SIGNING_SECRET || e.MEDIA_SIGNING_SECRET.length < 32) missing.push("MEDIA_SIGNING_SECRET (>=32 karakter)");
  if (/change[-_]?me|password|asf_dev_pw/i.test(e.DATABASE_URL)) missing.push("DATABASE_URL içinde varsayılan şifre");
  if (missing.length) {
    throw new Error("Üretim ortamı güvenlik kontrolü başarısız: " + missing.join(", "));
  }
}
