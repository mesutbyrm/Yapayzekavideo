import { defineConfig, devices } from "@playwright/test";

/**
 * Uçtan uca testler çalışan bir panel üzerinde koşar (varsayılan http://localhost:3000).
 * E2E_EMAIL / E2E_PASSWORD: seed ile oluşturulan yönetici hesabı (yalnızca geliştirme/test ortamında).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    // Sistemde önceden kurulu Chromium kullanılacaksa: PW_CHROMIUM_PATH=/yol/chromium
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
