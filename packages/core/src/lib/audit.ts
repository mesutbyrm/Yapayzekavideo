import { prisma } from "./db";
import { logger } from "./logger";

export async function audit(entry: {
  action: string;
  userId?: string | null;
  brandId?: string | null;
  entity?: string;
  entityId?: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        brandId: entry.brandId ?? null,
        entity: entry.entity,
        entityId: entry.entityId,
        ip: entry.ip ?? null,
        metadata: (entry.metadata ?? undefined) as any,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "audit log yazılamadı");
  }
}
