import { prisma } from "@asf/core";
import { Badge, Card, CardContent, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Bildirimler" };

const TONE = { INFO: "info", SUCCESS: "success", WARNING: "warning", ERROR: "danger" } as const;

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200, include: { brand: { select: { name: true } } } });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader title="Bildirimler" description={`${unread} okunmamış · Kritik bildirimler ayrıca e-posta ile gönderilir (SMTP yapılandırıldıysa).`} actions={unread ? <ActionButton url="/api/notifications" method="PATCH" body={{ all: true }} variant="outline">Tümünü okundu işaretle</ActionButton> : null} />
      <Card>
        <CardContent className="flex flex-col divide-y divide-border pt-2">
          {items.length === 0 ? <p className="py-6 text-sm text-muted-foreground">Bildirim yok.</p> : null}
          {items.map((n) => (
            <div key={n.id} className={`flex flex-col gap-1 py-3 sm:flex-row sm:items-start ${n.readAt ? "opacity-70" : ""}`}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {!n.readAt ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                  {n.title}
                  <Badge tone={TONE[n.severity]}>{n.type}</Badge>
                  {n.brand ? <span className="text-xs text-muted-foreground">{n.brand.name}</span> : null}
                </div>
                <p className="break-words text-sm text-muted-foreground">{n.message}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {fmtDate(n.createdAt)}
                {!n.readAt ? <ActionButton url="/api/notifications" method="PATCH" body={{ ids: [n.id] }} variant="ghost">Okundu</ActionButton> : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
