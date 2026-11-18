import { NextResponse } from "next/server";
import { z } from "zod";
import { login, SESSION_COOKIE, CSRF_COOKIE, env } from "@asf/core";
import { api } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const POST = api(
  async ({ req, ip, json }) => {
    const body = await json(schema);
    const rl = await rateLimit(`login:${body.email.toLowerCase()}`, 10, 900);
    if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." } }, { status: 429 });
    const s = await login(body.email, body.password, { ip, userAgent: req.headers.get("user-agent") });
    const res = NextResponse.json({ user: { id: s.user.id, email: s.user.email, name: s.user.name, role: s.user.role } });
    const secure = env().NODE_ENV === "production";
    res.cookies.set(SESSION_COOKIE, s.token, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: s.expiresAt });
    res.cookies.set(CSRF_COOKIE, s.csrfToken, { httpOnly: false, secure, sameSite: "strict", path: "/", expires: s.expiresAt });
    return res;
  },
  { auth: false, rateLimit: 20 },
);
