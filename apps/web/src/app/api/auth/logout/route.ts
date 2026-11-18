import { NextResponse } from "next/server";
import { logout, SESSION_COOKIE, CSRF_COOKIE, audit } from "@asf/core";
import { api } from "@/lib/api";

export const POST = api(async ({ req, user, ip }) => {
  await logout(req.cookies.get(SESSION_COOKIE)?.value);
  await audit({ action: "auth.logout", userId: user.id, ip });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(CSRF_COOKIE);
  return res;
});
