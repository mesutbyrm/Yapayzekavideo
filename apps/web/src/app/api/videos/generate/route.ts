import { z } from "zod";
import { AppError, enqueueGeneration } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Manuel video üretimi: limit + bütçe kontrolünden sonra kuyruğa alınır */
export const POST = api(async ({ json, brand, user }) => {
  const body = await json(z.object({ brandId: z.string(), scriptId: z.string().optional(), productionOptions: z.object({ minSeconds: z.number().int().min(15).max(300).default(60), maxSeconds: z.number().int().min(15).max(300).default(60), language: z.enum(["tr","en","de","fr","es","ar"]).default("tr"), subtitles: z.boolean().default(true), soundDesign: z.boolean().default(true) }).optional(), publishOptions: z.object({ platforms: z.array(z.enum(["INSTAGRAM","FACEBOOK","TIKTOK","YOUTUBE"])).default([]), scheduledAt: z.string().datetime().optional(), scheduledAtByPlatform: z.partialRecord(z.enum(["INSTAGRAM","FACEBOOK","TIKTOK","YOUTUBE"]), z.string().datetime()).optional() }).optional() }));
  await brand(body.brandId, "write");
  if (body.productionOptions && body.productionOptions.maxSeconds < body.productionOptions.minSeconds) throw new AppError("En uzun süre en kısa süreden küçük olamaz", "VALIDATION", 400);
  const video = await enqueueGeneration(body.brandId, { trigger: "manual", userId: user.id, scriptId: body.scriptId ?? null, productionOptions: body.productionOptions, publishOptions: body.publishOptions });
  return ok({ video }, { status: 202 });
}, { rateLimit: 10 });
