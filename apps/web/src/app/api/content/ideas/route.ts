import { z } from "zod";
import { prisma, generateIdeas, audit } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ req, brand }) => {
  const brandId = req.nextUrl.searchParams.get("brandId") ?? "";
  await brand(brandId);
  const status = req.nextUrl.searchParams.get("status");
  const ideas = await prisma.contentIdea.findMany({ where: { brandId, ...(status ? { status: status as any } : {}) }, orderBy: { createdAt: "desc" }, take: 100, include: { category: { select: { name: true } } } });
  return ok({ ideas });
});

/** OpenAI ile yeni, tekrarsız fikirler üretir (ücretli – bütçe kontrolü yapılır) */
export const POST = api(async ({ json, brand, user, ip }) => {
  const body = await json(z.object({ brandId: z.string(), count: z.number().int().min(1).max(10).default(5) }));
  await brand(body.brandId, "write");
  const ideas = await generateIdeas(body.brandId, body.count);
  await audit({ action: "content.ideas", userId: user.id, brandId: body.brandId, ip, metadata: { count: ideas.length } });
  return ok({ ideas }, { status: 201 });
}, { rateLimit: 10 });

export const PATCH = api(async ({ json, brand }) => {
  const body = await json(z.object({ id: z.string(), status: z.enum(["NEW", "REJECTED"]) }));
  const idea = await prisma.contentIdea.findUniqueOrThrow({ where: { id: body.id } });
  await brand(idea.brandId, "write");
  return ok({ idea: await prisma.contentIdea.update({ where: { id: idea.id }, data: { status: body.status } }) });
});
