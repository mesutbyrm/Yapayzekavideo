import { env, platformStatus, storage, ttsConfigured, emailConfigured, aiImagesEnabled } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Entegrasyon durumları – yalnızca yapılandırılıp yapılandırılmadığı döner, anahtarlar asla döndürülmez */
export const GET = api(async () => {
  const e = env();
  const storageHealth = await storage().healthCheck().catch((err) => ({ ok: false, message: String(err?.message ?? err) }));
  const integrations = [
    { id: "openai", name: "OpenAI (senaryo, moderasyon)", configured: !!e.OPENAI_API_KEY, env: ["OPENAI_API_KEY"], detail: `Model: ${e.OPENAI_MODEL}` },
    { id: "ai_image", name: "OpenAI görsel üretimi (opsiyonel, ücretli)", configured: aiImagesEnabled(), env: ["AI_IMAGES_ENABLED=true", "OPENAI_API_KEY"], detail: e.OPENAI_IMAGE_MODEL },
    { id: "google_tts", name: "Google Cloud Text-to-Speech", configured: ttsConfigured(), env: ["GOOGLE_APPLICATION_CREDENTIALS veya GOOGLE_TTS_CREDENTIALS_JSON"] },
    { id: "pexels", name: "Pexels (stok video)", configured: !!e.PEXELS_API_KEY, env: ["PEXELS_API_KEY"] },
    { id: "pixabay", name: "Pixabay (stok video)", configured: !!e.PIXABAY_API_KEY, env: ["PIXABAY_API_KEY"] },
    { id: "storage", name: `Depolama (${e.STORAGE_DRIVER === "r2" ? "Cloudflare R2" : "Yerel disk"})`, configured: storageHealth.ok, env: ["STORAGE_DRIVER=r2", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"], detail: storageHealth.message },
    { id: "smtp", name: "E-posta (SMTP)", configured: emailConfigured(), env: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] },
    { id: "tiktok_audit", name: "TikTok Direct Post denetimi", configured: !!e.TIKTOK_DIRECT_POST_AUDITED, env: ["TIKTOK_DIRECT_POST_AUDITED=true (yalnızca TikTok onayı alındıktan sonra)"], detail: e.TIKTOK_DIRECT_POST_AUDITED ? "Herkese açık yayın mümkün" : "Yalnızca SELF_ONLY (özel) yayın" },
  ];
  const callbacks = { meta: `${e.APP_URL}/api/oauth/meta/callback`, tiktok: `${e.APP_URL}/api/oauth/tiktok/callback`, youtube: `${e.APP_URL}/api/oauth/youtube/callback` };
  return ok({ integrations, platforms: platformStatus(), callbacks, metaGraphVersion: e.META_GRAPH_VERSION });
});
