import { prisma, type Platform } from "../../src/lib/db";
import { storeToken } from "../../src/publishers/tokens";

/** Test veritabanındaki bütün tabloları boşaltır (migration tablosu hariç) */
export async function resetDb() {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let n = 0;
export async function makeBrand(data: Record<string, unknown> = {}) {
  n++;
  return prisma.brand.create({ data: { name: `Test Marka ${n}`, slug: `test-marka-${n}-${Date.now()}`, ...data } as any });
}

export async function makeVideo(brandId: string, data: Record<string, unknown> = {}) {
  return prisma.video.create({
    data: {
      brandId,
      title: "Test videosu",
      status: "READY",
      qcPassed: true,
      storageKey: `videos/${brandId}/test.mp4`,
      durationSec: 24,
      width: 1080,
      height: 1920,
      fps: 30,
      sizeBytes: BigInt(1_000_000),
      ...data,
    } as any,
  });
}

export async function makeAccount(brandId: string, platform: Platform, token: { accessToken?: string; refreshToken?: string | null; expiresAt?: Date | null } = {}, data: Record<string, unknown> = {}) {
  const acc = await prisma.socialAccount.create({
    data: { brandId, platform, externalId: `${platform.toLowerCase()}-${Math.random().toString(36).slice(2)}`, displayName: `${platform} hesabı`, username: "testhesap", ...data } as any,
  });
  await storeToken(acc, { accessToken: token.accessToken ?? `tok-${platform}`, refreshToken: token.refreshToken ?? null, expiresAt: token.expiresAt ?? new Date(Date.now() + 86_400_000) });
  return acc;
}
