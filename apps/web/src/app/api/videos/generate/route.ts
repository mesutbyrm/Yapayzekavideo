import { z } from "zod";
import { enqueueGeneration } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Manuel video üretimi: limit + bütçe kontrolünden sonra kuyruğa alınır */
export const POST = api(async ({ json, brand, user }) => {
  const body = await json(z.object({ brandId: z.string(), scriptId: z.string().optional() }));
  await brand(body.brandId, "write");
  const video = await enqueueGeneration(body.brandId, { trigger: "manual", userId: user.id, scriptId: body.scriptId ?? null });
  return ok({ video }, { status: 202 });
}, { rateLimit: 10 });
