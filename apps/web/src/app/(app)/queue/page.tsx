import Link from "next/link";
import { prisma, queueCounts } from "@asf/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Table, Td, Th, buttonVariants } from "@/components/ui";
import { PlatformBadge, StatusBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Yayın Kuyruğu" };

export default async function QueuePage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const jobs = await prisma.publishJob.findMany({
    where: { brandId: brand.id, status: { in: ["PENDING", "SCHEDULED", "AWAITING_CONSENT", "RUNNING", "PROCESSING", "FAILED", "BLOCKED"] } },
    orderBy: { scheduledAt: "asc" },
    take: 200,
    include: { video: { select: { id: true, title: true } }, socialAccount: { select: { displayName: true } } },
  });
  const counts = user.role === "ADMIN" ? await queueCounts().catch(() => null) : null;
  const consent = jobs.filter((j) => j.status === "AWAITING_CONSENT");

  return (
    <>
      <PageHeader title="Yayın Kuyruğu" description="Her video için her platformda ayrı iş. Otomatik tekrar deneme (üstel bekleme), hız sınırı ve çift yayın engeli aktif." />
      {consent.length ? (
        <Card className="mb-4 border-warning/40">
          <CardHeader><CardTitle>TikTok onayı bekleyen {consent.length} yayın</CardTitle><CardDescription>TikTok kuralları gereği her gönderi için önizleme, gizlilik seçimi ve açık onay gerekir. Bu işler diğer platformların yayınını engellemez.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {consent.map((j) => <Link key={j.id} className={buttonVariants({ size: "sm", variant: "outline" })} href={`/queue/${j.id}/tiktok`}>{j.video.title ?? j.videoId} → Onay ekranı</Link>)}
          </CardContent>
        </Card>
      ) : null}
      {counts ? (
        <Card className="mb-4">
          <CardHeader><CardTitle>Kuyruk durumu (BullMQ)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Kuyruk</Th><Th>Bekleyen</Th><Th>Aktif</Th><Th>Gecikmeli</Th><Th>Başarısız</Th><Th>Tamamlanan</Th></tr></thead>
              <tbody>{Object.entries(counts).map(([q, c]) => <tr key={q}><Td className="font-mono text-xs">{q}</Td><Td>{c.waiting}</Td><Td>{c.active}</Td><Td>{c.delayed}</Td><Td className={c.failed ? "text-danger" : ""}>{c.failed}</Td><Td>{c.completed}</Td></tr>)}</tbody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="pt-5">
          {jobs.length === 0 ? <p className="text-sm text-muted-foreground">Kuyrukta iş yok.</p> : (
            <Table>
              <thead><tr><Th>Video</Th><Th>Platform</Th><Th>Hesap</Th><Th>Zaman</Th><Th>Durum</Th><Th>Deneme</Th><Th>Hata</Th><Th /></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <Td><Link className="hover:underline" href={`/library/${j.video.id}`}>{j.video.title ?? j.videoId}</Link></Td>
                    <Td><PlatformBadge platform={j.platform} /></Td>
                    <Td className="text-xs">{j.socialAccount.displayName}</Td>
                    <Td className="text-xs">{fmtDate(j.scheduledAt)}</Td>
                    <Td><StatusBadge status={j.status} /></Td>
                    <Td>{j.attempts}/{j.maxAttempts}</Td>
                    <Td className="max-w-xs text-xs text-danger">{j.lastError}</Td>
                    <Td>
                      <div className="flex gap-1">
                        {j.status === "AWAITING_CONSENT" ? <Link className={buttonVariants({ size: "sm" })} href={`/queue/${j.id}/tiktok`}>Onayla</Link> : null}
                        {["FAILED", "BLOCKED"].includes(j.status) ? <ActionButton url="/api/publishing/retry" body={{ publishJobId: j.id }} variant="outline">Tekrar dene</ActionButton> : null}
                        {["PENDING", "SCHEDULED", "AWAITING_CONSENT", "FAILED", "BLOCKED"].includes(j.status) ? <ActionButton url="/api/publishing/cancel" body={{ publishJobId: j.id }} variant="ghost" confirm="İş iptal edilsin mi?">İptal</ActionButton> : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
