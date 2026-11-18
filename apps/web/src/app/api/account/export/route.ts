import { prisma, audit } from "@asf/core";
import { api, serialize } from "@/lib/api";

/** Kullanıcı veri dışa aktarma (KVKK/GDPR). Token ve şifre hash'i dahil edilmez. */
export const GET = api(async ({ user, ip }) => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, email: true, name: true, role: true, locale: true, createdAt: true, lastLoginAt: true } });
  const memberships = await prisma.brandMember.findMany({ where: { userId: user.id } });
  const ownedBrandIds = memberships.filter((m) => m.role === "OWNER").map((m) => m.brandId);
  const brands = await prisma.brand.findMany({
    where: { id: { in: ownedBrandIds } },
    include: {
      categories: true,
      schedules: true,
      ideas: true,
      scripts: true,
      videos: { select: { id: true, title: true, status: true, durationSec: true, createdAt: true, costUsd: true, qcReport: true, mediaManifest: true } },
      socialAccounts: { select: { id: true, platform: true, displayName: true, username: true, status: true, connectedAt: true } },
      publishResults: { select: { platform: true, success: true, externalPostId: true, postUrl: true, createdAt: true, errorCode: true } },
      usageLogs: { select: { provider: true, operation: true, costUsd: true, createdAt: true } },
    },
  });
  const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
  const auditLogs = await prisma.auditLog.findMany({ where: { userId: user.id }, take: 5000, orderBy: { createdAt: "desc" } });
  await audit({ action: "account.export", userId: user.id, ip });
  const body = JSON.stringify(serialize({ exportedAt: new Date().toISOString(), user: me, memberships, brands, notifications, auditLogs }), null, 2);
  return new Response(body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="asf-export-${me.id}.json"` } });
}, { rateLimit: 3 });
