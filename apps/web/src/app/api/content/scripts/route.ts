import { z } from "zod";
import { prisma, generateScript, audit, topicFingerprint, Prisma, AppError } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ req, brand }) => {
  const brandId = req.nextUrl.searchParams.get("brandId") ?? "";
  await brand(brandId);
  const scripts = await prisma.videoScript.findMany({ where: { brandId }, orderBy: { createdAt: "desc" }, take: 50 });
  return ok({ scripts });
});

/** Fikirden (veya serbest konudan) senaryo üretir: JSON şema doğrulaması + kontrollü yeniden üretim */
export const POST = api(async ({ json, brand, user, ip }) => {
  const body = await json(z.object({ brandId: z.string(), ideaId: z.string().optional(), topic: z.string().min(5).max(160).optional() }));
  await brand(body.brandId, "write");
  let ideaId = body.ideaId;
  if (!ideaId) {
    if (!body.topic) throw new AppError("ideaId veya topic gerekli", "VALIDATION", 400);
    try {
      ideaId = (await prisma.contentIdea.create({ data: { brandId: body.brandId, topic: body.topic, fingerprint: topicFingerprint(body.topic), source: "manual" } })).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError("Bu konu daha önce kullanıldı", "DUPLICATE_TOPIC", 409);
      throw err;
    }
  }
  const script = await generateScript(body.brandId, ideaId);
  await audit({ action: "content.script", userId: user.id, brandId: body.brandId, entity: "VideoScript", entityId: script.id, ip });
  return ok({ script }, { status: 201 });
}, { rateLimit: 10 });
