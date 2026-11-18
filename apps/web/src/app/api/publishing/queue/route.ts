import { z } from "zod";
import { prisma, accessibleBrandIds, createPublishJobs, queueCounts } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ user, req }) => {
  const ids = await accessibleBrandIds(user);
  const brandId = req.nextUrl.searchParams.get("brandId");
  const jobs = await prisma.publishJob.findMany({
    where: { brandId: brandId && ids.includes(brandId) ? brandId : { in: ids }, status: { in: ["PENDING", "SCHEDULED", "AWAITING_CONSENT", "RUNNING", "PROCESSING", "FAILED", "BLOCKED"] } },
    orderBy: { scheduledAt: "asc" },
    take: 200,
    include: { video: { select: { title: true, thumbnailKey: true, durationSec: true } }, socialAccount: { select: { displayName: true, username: true, platform: true } } },
  });
  const counts = user.role === "ADMIN" ? await queueCounts().catch(() => null) : null;
  return ok({ jobs, counts });
});

/** Hazır bir video için yayın işleri oluşturur (idempotent) */
export const POST = api(async ({ json, brand }) => {
  const body = await json(z.object({ videoId: z.string(), platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"])).optional(), scheduledAt: z.string().datetime().optional() }));
  const v = await prisma.video.findUniqueOrThrow({ where: { id: body.videoId } });
  await brand(v.brandId, "write");
  const jobs = await createPublishJobs(v.id, { platforms: body.platforms, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined });
  return ok({ jobs }, { status: 201 });
});
