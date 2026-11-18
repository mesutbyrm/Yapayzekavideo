import { prisma, type User } from "../lib/db";
import { randomToken, sha256 } from "../lib/crypto";
import { env } from "../lib/env";
import { verifyPassword } from "./password";
import { AppError } from "../lib/errors";
import { audit } from "../lib/audit";

export const SESSION_COOKIE = "asf_session";
export const CSRF_COOKIE = "asf_csrf";
export const CSRF_HEADER = "x-csrf-token";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function login(email: string, password: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  // Zamanlama saldırılarına karşı kullanıcı yoksa da hash karşılaştırması yap
  const hash = user?.passwordHash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7Z0Fv4mDk1Zr1n0vO6l9uI7lqPqkS1a";
  const ok = await verifyPassword(password, hash);
  if (!user || !user.isActive) throw new AppError("E-posta veya şifre hatalı", "INVALID_CREDENTIALS", 401);
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("Hesap geçici olarak kilitlendi. Lütfen daha sonra deneyin.", "LOCKED", 423);
  }
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    await audit({ action: "auth.login_failed", userId: user.id, ip: meta.ip });
    throw new AppError("E-posta veya şifre hatalı", "INVALID_CREDENTIALS", 401);
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const session = await createSession(user.id, meta);
  await audit({ action: "auth.login", userId: user.id, ip: meta.ip });
  return { user, ...session };
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
  await prisma.session.create({
    data: { tokenHash: sha256(token), csrfToken, userId, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, expiresAt },
  });
  return { token, csrfToken, expiresAt };
}

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "locale">;

export async function getSessionByToken(token: string | undefined | null) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true, locale: true, isActive: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  return session;
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function purgeExpiredSessions() {
  const r = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}
