import { z } from "zod";
import { prisma, reschedulePublishJob } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Platform/hedef hesabı için bekleyen yayını Europe/Istanbul arayüzünden gelen UTC zamanı ile düzenler. */
export const POST = api(async ({ json, brand, user }) => {
  const body = await json(z.object({ publishJobId: z.string().min(1), scheduledAt: z.string().datetime() }));
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: body.publishJobId } });
  await brand(job.brandId, "write");
  const updated = await reschedulePublishJob(job.id, user.id, new Date(body.scheduledAt));
  return ok({ job: { id: updated.id, platform: updated.platform, status: updated.status, scheduledAt: updated.scheduledAt } });
});
