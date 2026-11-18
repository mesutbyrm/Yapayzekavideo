import { z } from "zod";
import { prisma, enqueueGeneration, AppError } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Mevcut bir senaryoyu yeniden render eder (ör. QC başarısız olduysa) – yeni video kaydı oluşturur */
export const POST = api(async ({ json, brand, user }) => {
  const body = await json(z.object({ videoId: z.string() }));
  const v = await prisma.video.findUniqueOrThrow({ where: { id: body.videoId } });
  await brand(v.brandId, "write");
  if (!v.scriptId) throw new AppError("Videonun senaryosu yok", "VALIDATION", 400);
  const video = await enqueueGeneration(v.brandId, { trigger: "manual", userId: user.id, scriptId: v.scriptId });
  return ok({ video }, { status: 202 });
}, { rateLimit: 10 });
