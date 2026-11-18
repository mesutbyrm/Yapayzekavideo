import { z } from "zod";
import { prisma, giveConsent, TIKTOK_PRIVACY, env, AppError } from "@asf/core";
import { api, ok } from "@/lib/api";

/** TikTok: kullanıcının önizleme + gizlilik seçimi + müzik kullanım onayı ile açık izni */
export const POST = api(async ({ json, brand, user }) => {
  const body = await json(
    z.object({
      publishJobId: z.string(),
      privacyLevel: z.enum(TIKTOK_PRIVACY),
      disableComment: z.boolean().default(false),
      disableDuet: z.boolean().default(false),
      disableStitch: z.boolean().default(false),
      brandContent: z.boolean().default(false),
      brandOrganic: z.boolean().default(false),
      musicConfirmation: z.literal(true),
    }),
  );
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: body.publishJobId } });
  await brand(job.brandId, "write");
  if (job.platform !== "TIKTOK") throw new AppError("Onay yalnızca TikTok işleri için gereklidir", "VALIDATION", 400);
  if (!env().TIKTOK_DIRECT_POST_AUDITED && body.privacyLevel !== "SELF_ONLY") {
    throw new AppError("TikTok uygulaması denetlenmediği için yalnızca 'Sadece ben' (SELF_ONLY) seçilebilir", "UNAUDITED_CLIENT", 400);
  }
  if (body.brandContent && body.privacyLevel === "SELF_ONLY") throw new AppError("Markalı içerik gizli (SELF_ONLY) olarak paylaşılamaz", "VALIDATION", 400);
  const { publishJobId, ...options } = body;
  return ok({ job: await giveConsent(publishJobId, user.id, options) });
});
