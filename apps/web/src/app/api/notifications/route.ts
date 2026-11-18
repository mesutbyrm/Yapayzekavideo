import { z } from "zod";
import { prisma } from "@asf/core";
import { api, ok } from "@/lib/api";

export const GET = api(async ({ user, req }) => {
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  const notifications = await prisma.notification.findMany({ where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  return ok({ notifications, unread });
});

export const PATCH = api(async ({ user, json }) => {
  const body = await json(z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }));
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) }, data: { readAt: new Date() } });
  return ok({ ok: true });
});
