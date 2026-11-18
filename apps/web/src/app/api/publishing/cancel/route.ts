import { z } from "zod";
import { prisma, cancelPublishJob } from "@asf/core";
import { api, ok } from "@/lib/api";

export const POST = api(async ({ json, brand, user }) => {
  const { publishJobId } = await json(z.object({ publishJobId: z.string() }));
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId } });
  await brand(job.brandId, "write");
  await cancelPublishJob(job.id, user.id);
  return ok({ ok: true });
});
