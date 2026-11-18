import { prisma, type SocialAccount } from "../lib/db";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import { ProviderError } from "../lib/errors";
import { notify } from "../notifications/notify";
import { publisherFor } from "./registry";
import type { ConnectedAccount, TokenSet } from "./types";
import { logger } from "../lib/logger";

const aad = (accountId: string) => `oauth:${accountId}`;

export async function saveConnectedAccount(brandId: string, acc: ConnectedAccount, autoPublish = true) {
  const sa = await prisma.socialAccount.upsert({
    where: { brandId_platform_externalId: { brandId, platform: acc.platform, externalId: acc.externalId } },
    update: { displayName: acc.displayName, username: acc.username, avatarUrl: acc.avatarUrl, meta: (acc.meta ?? undefined) as any, status: "CONNECTED", scopes: acc.token.scopes ?? [], lastError: null, connectedAt: new Date() },
    create: { brandId, platform: acc.platform, externalId: acc.externalId, displayName: acc.displayName, username: acc.username, avatarUrl: acc.avatarUrl, meta: (acc.meta ?? undefined) as any, scopes: acc.token.scopes ?? [], autoPublish },
  });
  await storeToken(sa, acc.token);
  return sa;
}

export async function storeToken(account: Pick<SocialAccount, "id" | "brandId">, t: TokenSet) {
  const data = {
    accessTokenEnc: encryptSecret(t.accessToken, aad(account.id)),
    refreshTokenEnc: t.refreshToken ? encryptSecret(t.refreshToken, aad(account.id)) : null,
    tokenType: t.tokenType ?? "Bearer",
    expiresAt: t.expiresAt ?? null,
    refreshExpiresAt: t.refreshExpiresAt ?? null,
    lastRefreshedAt: new Date(),
  };
  await prisma.oAuthToken.upsert({ where: { socialAccountId: account.id }, update: data, create: { ...data, brandId: account.brandId, socialAccountId: account.id } });
}

export async function readToken(accountId: string): Promise<TokenSet | null> {
  const row = await prisma.oAuthToken.findUnique({ where: { socialAccountId: accountId } });
  if (!row) return null;
  return {
    accessToken: decryptSecret(row.accessTokenEnc, aad(accountId)),
    refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc, aad(accountId)) : null,
    expiresAt: row.expiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
    tokenType: row.tokenType,
  };
}

/**
 * Geçerli erişim token'ını döndürür. 10 dakika içinde süresi dolacaksa yeniler.
 * Yenileme başarısızsa hesap TOKEN_EXPIRED olarak işaretlenir ve bildirim gönderilir.
 */
export async function getValidAccessToken(account: SocialAccount): Promise<string> {
  const t = await readToken(account.id);
  if (!t) {
    await markAccountError(account, "TOKEN_EXPIRED", "Token bulunamadı, hesabı yeniden bağlayın");
    throw new ProviderError("Hesap token'ı yok", account.platform.toLowerCase(), "NO_TOKEN", false, 401, "auth");
  }
  if (t.expiresAt && t.expiresAt.getTime() - Date.now() < 10 * 60_000) {
    try {
      const nt = await publisherFor(account.platform).refreshToken(t);
      if (!nt) throw new Error("Bu platform token yenilemeyi desteklemiyor");
      await storeToken(account, nt);
      return nt.accessToken;
    } catch (err) {
      await markAccountError(account, "TOKEN_EXPIRED", `Token yenilenemedi: ${(err as Error).message}`);
      throw new ProviderError(`${account.platform} token süresi doldu ve yenilenemedi`, account.platform.toLowerCase(), "TOKEN_EXPIRED", false, 401, "auth");
    }
  }
  return t.accessToken;
}

export async function markAccountError(account: Pick<SocialAccount, "id" | "brandId" | "platform" | "displayName">, status: "TOKEN_EXPIRED" | "ERROR" | "REVOKED", message: string) {
  await prisma.socialAccount.update({ where: { id: account.id }, data: { status, lastError: message.slice(0, 500), lastCheckedAt: new Date() } });
  await notify({
    type: status === "TOKEN_EXPIRED" ? "TOKEN_EXPIRED" : "CONNECTION_LOST",
    severity: "ERROR",
    brandId: account.brandId,
    title: status === "TOKEN_EXPIRED" ? "Token süresi doldu" : "API bağlantısı koptu",
    message: `${account.platform} – ${account.displayName}: ${message}. Diğer platformların yayınları etkilenmez.`,
    dedupeKey: `acct:${account.id}:${status}:${new Date().toISOString().slice(0, 10)}`,
    email: true,
  });
  logger.warn({ accountId: account.id, platform: account.platform, status }, "sosyal hesap hatası");
}

/** Bağlantıyı iptal: platformda token'ı iptal et, yerel token'ı sil */
export async function disconnectAccount(accountId: string) {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  const t = await readToken(accountId).catch(() => null);
  if (t) await publisherFor(account.platform).disconnect(account, t.accessToken).catch(() => undefined);
  await prisma.oAuthToken.deleteMany({ where: { socialAccountId: accountId } });
  await prisma.socialAccount.update({ where: { id: accountId }, data: { status: "DISCONNECTED", autoPublish: false } });
  await prisma.publishJob.updateMany({ where: { socialAccountId: accountId, status: { in: ["PENDING", "SCHEDULED", "AWAITING_CONSENT"] } }, data: { status: "CANCELLED", lastError: "Hesap bağlantısı kesildi" } });
}
