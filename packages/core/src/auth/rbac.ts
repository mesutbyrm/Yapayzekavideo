import { prisma } from "../lib/db";
import { AppError } from "../lib/errors";
import type { SessionUser } from "./session";

export type BrandAccess = "read" | "write" | "admin";

/**
 * Marka izolasyonu: kullanıcı yalnızca üyesi olduğu markalara erişebilir.
 * ADMIN rolü sistem genelinde yönetim yetkisine sahiptir.
 */
export async function assertBrandAccess(user: SessionUser, brandId: string, level: BrandAccess = "read") {
  if (user.role === "ADMIN") return;
  const m = await prisma.brandMember.findUnique({ where: { brandId_userId: { brandId, userId: user.id } } });
  if (!m) throw new AppError("Bu markaya erişim yetkiniz yok", "FORBIDDEN", 403);
  if (level === "write" && m.role === "VIEWER") throw new AppError("Bu işlem için düzenleme yetkisi gerekli", "FORBIDDEN", 403);
  if (level === "admin" && m.role !== "OWNER") throw new AppError("Bu işlem için marka sahibi yetkisi gerekli", "FORBIDDEN", 403);
}

export async function accessibleBrandIds(user: SessionUser): Promise<string[]> {
  if (user.role === "ADMIN") {
    return (await prisma.brand.findMany({ select: { id: true } })).map((b) => b.id);
  }
  return (await prisma.brandMember.findMany({ where: { userId: user.id }, select: { brandId: true } })).map((m) => m.brandId);
}

export function assertAdmin(user: SessionUser) {
  if (user.role !== "ADMIN") throw new AppError("Yönetici yetkisi gerekli", "FORBIDDEN", 403);
}
