import { NextResponse } from "next/server";
import { prisma, publisherFor, randomToken, pkcePair, env, AppError, type Platform } from "@asf/core";
import { api } from "@/lib/api";
import { redirectUri } from "@/lib/oauth";

const MAP: Record<string, Platform> = { meta: "FACEBOOK", facebook: "FACEBOOK", instagram: "INSTAGRAM", tiktok: "TIKTOK", youtube: "YOUTUBE" };


/** OAuth akışını başlatır (state + PKCE). GET olduğu için CSRF yerine state doğrulaması kullanılır. */
export const GET = api(async ({ params, req, user, brand }) => {
  const key = String(params.platform).toLowerCase();
  const platform = MAP[key];
  if (!platform) throw new AppError("Desteklenmeyen platform", "VALIDATION", 400);
  const brandId = req.nextUrl.searchParams.get("brandId") ?? "";
  await brand(brandId, "write");
  const publisher = publisherFor(platform);
  if (!publisher.isConfigured()) throw new AppError(`${platform} uygulama anahtarları eksik: ${publisher.requiredEnv.join(", ")}`, "NOT_CONFIGURED", 503);
  const state = randomToken(24);
  const usePkce = platform === "TIKTOK" || platform === "YOUTUBE";
  const pkce = usePkce ? pkcePair() : null;
  const cbKey = platform === "FACEBOOK" || platform === "INSTAGRAM" ? "meta" : key;
  await prisma.oAuthState.create({ data: { state, brandId, userId: user.id, platform, codeVerifier: pkce?.verifier, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  const url = publisher.connect({ state, redirectUri: redirectUri(cbKey), codeChallenge: pkce?.challenge });
  return NextResponse.redirect(url);
}, { rateLimit: 20 });
