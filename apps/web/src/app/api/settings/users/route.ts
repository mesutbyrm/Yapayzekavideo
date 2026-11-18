import { z } from "zod";
import { prisma, hashPassword, validatePasswordStrength, AppError, audit } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async () => {
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, memberships: { select: { brandId: true, role: true } } }, orderBy: { createdAt: "asc" } });
  return ok({ users });
}, { admin: true });

export const POST = api(async ({ json, user, ip }) => {
  const body = await json(z.object({ email: z.string().email(), name: z.string().min(2).max(80), password: z.string().min(12).max(200), role: z.enum(["ADMIN", "USER"]), brandIds: z.array(z.string()).default([]), brandRole: z.enum(["OWNER", "EDITOR", "VIEWER"]).default("EDITOR") }));
  const weak = validatePasswordStrength(body.password);
  if (weak) throw new AppError(weak, "WEAK_PASSWORD", 400);
  const u = await prisma.user.create({
    data: { email: body.email.toLowerCase(), name: body.name, role: body.role, passwordHash: await hashPassword(body.password), memberships: { create: body.brandIds.map((brandId) => ({ brandId, role: body.brandRole })) } },
    select: { id: true, email: true, name: true, role: true },
  });
  await audit({ action: "user.create", userId: user.id, ip, entity: "User", entityId: u.id });
  return ok({ user: u }, { status: 201 });
}, { admin: true });

export const PATCH = api(async ({ json, user, ip }) => {
  const body = await json(z.object({ id: z.string(), isActive: z.boolean().optional(), role: z.enum(["ADMIN", "USER"]).optional() }));
  if (body.id === user.id && (body.isActive === false || body.role === "USER")) throw new AppError("Kendi yönetici hesabınızı devre dışı bırakamazsınız", "VALIDATION", 400);
  const u = await prisma.user.update({ where: { id: body.id }, data: { isActive: body.isActive, role: body.role }, select: { id: true, isActive: true, role: true } });
  if (body.isActive === false) await prisma.session.deleteMany({ where: { userId: body.id } });
  await audit({ action: "user.update", userId: user.id, ip, entity: "User", entityId: body.id, metadata: body });
  return ok({ user: u });
}, { admin: true });
