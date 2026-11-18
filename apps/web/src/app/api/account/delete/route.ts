import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, verifyPassword, AppError, audit, disconnectAccount, SESSION_COOKIE, CSRF_COOKIE } from "@asf/core";
import { api } from "@/lib/api";

/**
 * Hesap silme: şifre onayı gerekir. Sahibi olunan ve başka sahibi olmayan markalar,
 * bağlı sosyal hesap token'ları iptal edilerek silinir.
 */
export const POST = api(async ({ user, json, ip }) => {
  const { password, confirm } = await json(z.object({ password: z.string().min(1), confirm: z.literal("HESABIMI SIL") }));
  void confirm;
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(password, u.passwordHash))) throw new AppError("Şifre hatalı", "INVALID_CREDENTIALS", 400);
  if (u.role === "ADMIN" && (await prisma.user.count({ where: { role: "ADMIN", isActive: true } })) <= 1) {
    throw new AppError("Son yönetici hesabı silinemez. Önce başka bir yönetici atayın.", "LAST_ADMIN", 409);
  }
  const owned = await prisma.brandMember.findMany({ where: { userId: user.id, role: "OWNER" } });
  for (const m of owned) {
    const otherOwners = await prisma.brandMember.count({ where: { brandId: m.brandId, role: "OWNER", userId: { not: user.id } } });
    if (otherOwners > 0) continue;
    const accounts = await prisma.socialAccount.findMany({ where: { brandId: m.brandId }, select: { id: true } });
    for (const a of accounts) await disconnectAccount(a.id).catch(() => undefined);
    await prisma.brand.delete({ where: { id: m.brandId } });
  }
  await audit({ action: "account.delete", userId: null, ip, metadata: { deletedUserId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(CSRF_COOKIE);
  return res;
}, { rateLimit: 3 });
