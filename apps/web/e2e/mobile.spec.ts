import { expect, test } from "@playwright/test";
import { AUTH_FILE } from "./helpers";

test.use({ storageState: AUTH_FILE });

test("mobil: menü açılır, sayfalar yatay taşma olmadan görüntülenir", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Menü" }).click();
  await page.getByRole("link", { name: "Yayın Kuyruğu" }).click();
  await expect(page).toHaveURL(/\/queue/);
  for (const p of ["/dashboard", "/queue", "/costs", "/settings", "/integrations"]) {
    await page.goto(p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, p).toBeLessThanOrEqual(0);
  }
});
