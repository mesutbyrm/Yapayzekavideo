import { prisma, getValidAccessToken, TikTokPublisher, AppError, env } from "@asf/core";
import { api, ok } from "@/lib/api";

/** TikTok yayın onay ekranı için güncel creator info */
export const GET = api(async ({ params, brand }) => {
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: String(params.accountId) } });
  await brand(acc.brandId);
  if (acc.platform !== "TIKTOK") throw new AppError("Yalnızca TikTok hesapları", "VALIDATION", 400);
  const p = new TikTokPublisher();
  const info = await p.queryCreatorInfo(await getValidAccessToken(acc));
  await prisma.socialAccount.update({ where: { id: acc.id }, data: { meta: { ...((acc.meta as object) ?? {}), creatorInfo: info } as any } });
  return ok({ creatorInfo: info, audited: !!env().TIKTOK_DIRECT_POST_AUDITED });
}, { rateLimit: 15 });
