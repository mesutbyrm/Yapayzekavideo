import { z } from "zod";
import { prisma, disconnectAccount, audit, getValidAccessToken, publisherFor, markAccountError, ProviderError } from "@asf/core";
import { api, ok } from "@/lib/api";

async function load(id: string) {
  return prisma.socialAccount.findUniqueOrThrow({ where: { id } });
}

/** Hesap durumunu platformdan canlı kontrol eder */
export const GET = api(async ({ params, brand }) => {
  const acc = await load(String(params.id));
  await brand(acc.brandId);
  try {
    const info = await publisherFor(acc.platform).getAccountInfo(acc, await getValidAccessToken(acc));
    await prisma.socialAccount.update({ where: { id: acc.id }, data: { lastCheckedAt: new Date(), lastError: null } });
    return ok({ ok: true, info });
  } catch (err) {
    if (err instanceof ProviderError && err.kind === "auth") await markAccountError(acc, "TOKEN_EXPIRED", err.message);
    return ok({ ok: false, error: (err as Error).message });
  }
});

export const PATCH = api(async ({ params, brand, json, user, ip }) => {
  const acc = await load(String(params.id));
  await brand(acc.brandId, "write");
  const body = await json(z.object({ autoPublish: z.boolean() }));
  const updated = await prisma.socialAccount.update({ where: { id: acc.id }, data: body, select: { id: true, autoPublish: true } });
  await audit({ action: "social.update", userId: user.id, brandId: acc.brandId, entity: "SocialAccount", entityId: acc.id, ip, metadata: body });
  return ok({ account: updated });
});

/** API bağlantısını iptal eder: platform token'ı iptal edilir, yerel token silinir */
export const DELETE = api(async ({ params, brand, user, ip }) => {
  const acc = await load(String(params.id));
  await brand(acc.brandId, "write");
  await disconnectAccount(acc.id);
  await audit({ action: "social.disconnect", userId: user.id, brandId: acc.brandId, entity: "SocialAccount", entityId: acc.id, ip, metadata: { platform: acc.platform } });
  return ok({ ok: true });
});
