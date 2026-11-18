import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionByToken, SESSION_COOKIE, accessibleBrandIds, prisma, type SessionUser } from "@asf/core";

export const BRAND_COOKIE = "asf_brand";

export async function currentSession() {
  const c = await cookies();
  return getSessionByToken(c.get(SESSION_COOKIE)?.value);
}

/** Sunucu bileşenleri için: oturum yoksa /login'e yönlendirir */
export async function requireUser(): Promise<SessionUser> {
  const s = await currentSession();
  if (!s) redirect("/login");
  return s.user;
}

/** Seçili marka (cookie) – kullanıcının erişebildiği markalardan biri olmalı */
export async function currentBrand(user: SessionUser) {
  const ids = await accessibleBrandIds(user);
  const c = await cookies();
  const wanted = c.get(BRAND_COOKIE)?.value;
  const id = wanted && ids.includes(wanted) ? wanted : ids[0];
  const brand = id ? await prisma.brand.findUnique({ where: { id } }) : null;
  const brands = await prisma.brand.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, primaryColor: true }, orderBy: { createdAt: "asc" } });
  return { brand, brands, brandIds: ids };
}

export async function clientIp() {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
