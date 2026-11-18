import { z } from "zod";
import { prisma, verifyPassword, hashPassword, validatePasswordStrength, AppError, audit } from "@asf/core";
import { api, ok } from "@/lib/api";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(200) });

export const POST = api(
  async ({ user, json, ip }) => {
    const body = await json(schema);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(body.currentPassword, u.passwordHash))) throw new AppError("Mevcut şifre hatalı", "INVALID_CREDENTIALS", 400);
    const weak = validatePasswordStrength(body.newPassword);
    if (weak) throw new AppError(weak, "WEAK_PASSWORD", 400);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
    await audit({ action: "auth.password_change", userId: user.id, ip });
    return ok({ ok: true });
  },
  { rateLimit: 10 },
);
