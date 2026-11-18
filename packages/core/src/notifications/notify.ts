import { prisma, Prisma, type NotificationSeverity, type NotificationType } from "../lib/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { sendEmail } from "./email";

export interface NotifyInput {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  brandId?: string | null;
  userId?: string | null;
  data?: Record<string, unknown>;
  /** Aynı anahtarla ikinci bildirim oluşturulmaz */
  dedupeKey?: string;
  email?: boolean;
}

/**
 * Panel içi bildirim + (opsiyonel) e-posta.
 * Kullanıcı belirtilmemişse markanın üyelerine ve yöneticilere dağıtılır.
 */
export async function notify(input: NotifyInput) {
  try {
    const recipients = input.userId ? [input.userId] : await recipientsFor(input.brandId ?? null);
    const created: string[] = [];
    for (const userId of recipients.length ? recipients : [null]) {
      const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${userId ?? "none"}` : undefined;
      try {
        const n = await prisma.notification.create({
          data: {
            type: input.type,
            severity: input.severity ?? "INFO",
            title: input.title,
            message: input.message,
            brandId: input.brandId ?? null,
            userId,
            data: input.data as any,
            dedupeKey,
          },
        });
        created.push(n.id);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue; // zaten bildirildi
        throw err;
      }
    }
    if (created.length && (input.email || input.severity === "ERROR")) {
      const to = await emailRecipients(input.brandId ?? null);
      for (const addr of to) {
        await sendEmail(addr, `[AI Social Factory] ${input.title}`, input.message).catch((err) =>
          logger.warn({ err: String(err) }, "bildirim e-postası gönderilemedi"),
        );
      }
      if (to.length) await prisma.notification.updateMany({ where: { id: { in: created } }, data: { emailedAt: new Date() } });
    }
    return created;
  } catch (err) {
    logger.error({ err, type: input.type }, "bildirim oluşturulamadı");
    return [];
  }
}

async function recipientsFor(brandId: string | null) {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const ids = new Set(admins.map((a) => a.id));
  if (brandId) {
    const members = await prisma.brandMember.findMany({ where: { brandId }, select: { userId: true } });
    members.forEach((m) => ids.add(m.userId));
  }
  return [...ids];
}

async function emailRecipients(brandId: string | null) {
  const e = env();
  if (e.ALERT_EMAIL) return e.ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { email: true } });
  return admins.map((a) => a.email);
}
