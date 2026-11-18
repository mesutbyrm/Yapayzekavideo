import { request, type FullConfig } from "@playwright/test";
import { EMAIL, PASSWORD } from "./helpers";

/**
 * Tek bir giriş yapılıp oturum dosyaya kaydedilir; testler bu oturumu kullanır.
 * (Giriş uç noktası e-posta başına 15 dakikada 10 deneme ile sınırlıdır.)
 */
export default async function globalSetup(config: FullConfig) {
  if (!PASSWORD) throw new Error("E2E_PASSWORD tanımlı değil");
  const baseURL = config.projects[0].use.baseURL;
  const ctx = await request.newContext({ baseURL });
  const r = await ctx.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  if (!r.ok()) throw new Error(`E2E girişi başarısız: ${r.status()} ${await r.text()}`);
  await ctx.storageState({ path: "e2e/.auth.json" });
  await ctx.dispose();
}
