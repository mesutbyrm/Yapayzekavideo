import { NextResponse } from "next/server";
import { prisma, publisherFor, saveConnectedAccount, audit, env, logger, getSessionByToken, SESSION_COOKIE } from "@asf/core";
import type { NextRequest } from "next/server";
import { redirectUri } from "@/lib/oauth";

function back(qs: string) {
  return NextResponse.redirect(`${env().APP_URL.replace(/\/$/, "")}/accounts?${qs}`);
}

/** OAuth callback: state doğrulanır, kod token ile değiştirilir, token'lar şifrelenerek saklanır */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: key } = await params;
  const sp = req.nextUrl.searchParams;
  const state = sp.get("state");
  if (sp.get("error")) return back(`error=${encodeURIComponent(sp.get("error_description") ?? sp.get("error") ?? "denied")}`);
  const code = sp.get("code");
  if (!state || !code) return back("error=missing_code");
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  await prisma.oAuthState.deleteMany({ where: { state } });
  const session = await getSessionByToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!row || row.expiresAt < new Date() || !session || session.userId !== row.userId) return back("error=invalid_state");
  try {
    const accounts = await publisherFor(row.platform).handleCallback({ code, redirectUri: redirectUri(key), codeVerifier: row.codeVerifier ?? undefined });
    const tiktokAudited = !!env().TIKTOK_DIRECT_POST_AUDITED;
    for (const acc of accounts) {
      const sa = await saveConnectedAccount(row.brandId, acc);
      if (acc.platform === "TIKTOK") await prisma.socialAccount.update({ where: { id: sa.id }, data: { directPostAudited: tiktokAudited } });
    }
    await audit({ action: "social.connect", userId: row.userId, brandId: row.brandId, metadata: { platform: row.platform, count: accounts.length } });
    return back(`connected=${accounts.length}`);
  } catch (err) {
    logger.error({ platform: row.platform, err: (err as Error).message }, "OAuth callback hatası");
    return back(`error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
  }
}
