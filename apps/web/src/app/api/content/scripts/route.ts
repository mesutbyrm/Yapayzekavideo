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
  const body = await json(z.object({ brandId: z.string(), ideaId: z.string().optional(), topic: z.string().min(5).max(160).optional(), brief: z.string().trim().min(5).max(3000).optional(), minSeconds: z.number().int().min(15).max(300).default(60), maxSeconds: z.number().int().min(15).max(300).default(60), language: z.enum(["tr","en","de","fr","es","ar"]).default("tr"), subtitles: z.boolean().default(true) }));
  await brand(body.brandId, "write");
  let ideaId = body.ideaId;
  if (!ideaId) {
    if (!body.topic && !body.brief) throw new AppError("ideaId, topic veya özel video fikri gerekli", "VALIDATION", 400);
    try {
      const brief = body.brief?.trim();
      const ideaTopic = (body.topic ?? brief ?? "").slice(0, 160);
      ideaId = (await prisma.contentIdea.create({ data: { brandId: body.brandId, topic: ideaTopic, angle: brief, fingerprint: topicFingerprint(brief ?? ideaTopic), source: "manual" } })).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError("Bu konu daha önce kullanıldı", "DUPLICATE_TOPIC", 409);
      throw err;
    }
  }
  if (body.maxSeconds < body.minSeconds) throw new AppError("En uzun süre en kısa süreden küçük olamaz", "VALIDATION", 400);
  const script = await generateScript(body.brandId, ideaId, null, { minSeconds: body.minSeconds, maxSeconds: body.maxSeconds, language: body.language, subtitles: body.subtitles, brief: body.brief });
  await audit({ action: "content.script", userId: user.id, brandId: body.brandId, entity: "VideoScript", entityId: script.id, ip });
  return ok({ script }, { status: 201 });
}, { rateLimit: 10 });
