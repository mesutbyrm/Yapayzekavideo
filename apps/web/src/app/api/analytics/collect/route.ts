import { z } from "zod";
import { queue, QUEUE } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Analiz toplama işini kuyruğa ekler */
export const POST = api(async ({ json, brand }) => {
  const { brandId } = await json(z.object({ brandId: z.string() }));
  await brand(brandId, "write");
  await queue(QUEUE.analytics).add("collect", { brandId }, { jobId: `analytics-${brandId}-${Math.floor(Date.now() / 600_000)}` });
  return ok({ queued: true }, { status: 202 });
}, { rateLimit: 5 });
