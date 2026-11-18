import { expect, test } from "@playwright/test";
import { AUTH_FILE, csrfOf } from "./helpers";

const PAGES: [string, RegExp][] = [
  ["/dashboard", /Genel Bakış/],
  ["/generate", /Video Üret/],
  ["/automation", /Otomatik Üretim/],
  ["/calendar", /İçerik Takvimi/],
  ["/library", /Video Kütüphanesi/],
  ["/queue", /Yayın Kuyruğu/],
  ["/history", /Yayın Geçmişi/],
  ["/accounts", /Sosyal Medya Hesapları/],
  ["/brands", /Markalar/],
  ["/categories", /İçerik Kategorileri/],
  ["/analytics", /Analizler/],
  ["/costs", /Maliyet Yönetimi/],
  ["/integrations", /API Bağlantıları/],
  ["/notifications", /Bildirimler/],
  ["/settings", /Sistem Ayarları/],
];

test.describe("oturumsuz", () => {
test.use({ storageState: { cookies: [], origins: [] } });
test("giriş yapmamış kullanıcı login sayfasına yönlendirilir", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("hatalı şifre reddedilir", async ({ page }) => {
  await page.goto("/login");
  await page.fill("input[name=email]", "yok@example.com");
  await page.fill("input[name=password]", "yanlis-sifre");
  await page.click("button[type=submit]");
  await expect(page.getByText(/hatalı/)).toBeVisible();
});
});

test.use({ storageState: AUTH_FILE });

test("15 menü sayfası hatasız açılır", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [path, title] of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator("h1").first()).toHaveText(title);
  }
  expect(errors).toEqual([]);
});

test("API: kimlik doğrulaması ve CSRF zorunlu", async ({ request, playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } });
  expect((await anon.get("/api/brands")).status()).toBe(401);
  await anon.dispose();
  const csrf = await csrfOf(request);
  expect((await request.get("/api/brands")).status()).toBe(200);
  // CSRF başlığı olmadan değiştirici istek reddedilir
  expect((await request.post("/api/brands", { data: { name: "CSRF Test" } })).status()).toBe(403);
  // API anahtarları istemciye gönderilmez
  const integ = await request.get("/api/settings/integrations", { headers: { "x-csrf-token": csrf } });
  const body = await integ.text();
  expect(body).not.toMatch(/TOKEN_ENCRYPTION_KEY=|sk-[A-Za-z0-9]{10,}/);
});

test("marka oluşturma, panelde görünme ve silme", async ({ request, page }) => {
  const csrf = await csrfOf(request);
  const name = `E2E Marka ${Date.now()}`;
  const created = await request.post("/api/brands", { data: { name, publishTimes: ["10:00", "15:00", "20:00"] }, headers: { "x-csrf-token": csrf } });
  expect(created.status(), await created.text()).toBe(201);
  const { brand } = await created.json();
  await page.goto("/brands");
  await expect(page.locator("main").getByText(name).first()).toBeVisible();
  const schedules = await (await request.get(`/api/brands/${brand.id}/schedules`)).json();
  expect(schedules.schedules.map((s: any) => s.time).sort()).toEqual(["10:00", "15:00", "20:00"]);
  const del = await request.delete(`/api/brands/${brand.id}`, { headers: { "x-csrf-token": csrf } });
  expect(del.ok()).toBeTruthy();
});

test("sağlık kontrolü", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  expect((await r.json()).checks.database.ok).toBe(true);
});
