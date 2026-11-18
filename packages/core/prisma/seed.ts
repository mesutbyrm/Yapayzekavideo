import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword, validatePasswordStrength } from "../src/auth/password";
import { ensureDefaultSchedules } from "../src/pipeline/scheduler";
import { SETTING_DEFAULTS } from "../src/lib/settings";

/**
 * İlk kurulum: yönetici hesabı + ilk marka + varsayılan yayın saatleri + sistem ayarları.
 * Varsayılan şifre YOKTUR: ADMIN_EMAIL ve ADMIN_PASSWORD ortam değişkenleri zorunludur.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL ve ADMIN_PASSWORD tanımlanmalı (varsayılan şifre kullanılmaz)");
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(`ADMIN_PASSWORD zayıf: ${weak}`);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: process.env.ADMIN_NAME ?? "Yönetici", passwordHash: await hashPassword(password), role: "ADMIN" },
  });

  const brandName = process.env.SEED_BRAND_NAME ?? "İlk Marka";
  const slug = brandName.toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "marka";
  const brand = await prisma.brand.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: brandName,
      description: process.env.SEED_BRAND_DESCRIPTION ?? null,
      language: "tr-TR",
      dailyVideoTarget: 3,
      monthlyVideoTarget: 90,
      minDurationSec: 20,
      maxDurationSec: 30,
      publishTimes: ["10:00", "15:00", "20:00"],
      timezone: "Europe/Istanbul",
      monthlyBudgetUsd: 25,
      maxBudgetUsd: 50,
      members: { create: { userId: admin.id, role: "OWNER" } },
      categories: { create: [{ name: "Genel Bilgi", description: "Doğrulanabilir ilginç bilgiler", keywords: ["bilgi", "ilginç", "bilim"] }] },
    },
  });
  await ensureDefaultSchedules(brand.id, brand.publishTimes);

  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: value as any } });
  }
  console.log(`Seed tamam: yönetici=${email}, marka=${brand.name} (${brand.slug})`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
