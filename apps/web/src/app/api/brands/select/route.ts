import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@asf/core";
import { api } from "@/lib/api";
import { BRAND_COOKIE } from "@/lib/auth";

export const POST = api(async ({ json, brand }) => {
  const { brandId } = await json(z.object({ brandId: z.string().min(1) }));
  await brand(brandId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(BRAND_COOKIE, brandId, { httpOnly: true, sameSite: "lax", secure: env().NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
  return res;
});
