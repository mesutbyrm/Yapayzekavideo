import Link from "next/link";
import { prisma } from "@asf/core";
import { Badge, Card, CardContent, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { PlatformBadge } from "@/components/status-badge";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Yayın Geçmişi" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ platform?: string; result?: string }> }) {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const sp = await searchParams;
  const results = await prisma.publishResult.findMany({
    where: { brandId: brand.id, ...(sp.platform ? { platform: sp.platform as any } : {}), ...(sp.result ? { success: sp.result === "ok" } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { video: { select: { id: true, title: true } }, socialAccount: { select: { displayName: true } } },
  });
  const chip = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} className={`rounded-full border px-3 py-1 text-xs ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Yayın Geçmişi" description="Platformların döndürdüğü gerçek gönderi kimlikleri ve bağlantıları. Her deneme ayrı kaydedilir." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {chip("/history", "Tümü", !sp.platform && !sp.result)}
        {["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"].map((p) => chip(`/history?platform=${p}`, p, sp.platform === p))}
        {chip("/history?result=ok", "Başarılı", sp.result === "ok")}
        {chip("/history?result=fail", "Başarısız", sp.result === "fail")}
      </div>
      <Card>
        <CardContent className="pt-5">
          {results.length === 0 ? <p className="text-sm text-muted-foreground">Kayıt yok.</p> : (
            <Table>
              <thead><tr><Th>Zaman</Th><Th>Video</Th><Th>Platform</Th><Th>Hesap</Th><Th>Sonuç</Th><Th>Gönderi</Th><Th>Deneme</Th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-xs">{fmtDate(r.createdAt)}</Td>
                    <Td><Link className="hover:underline" href={`/library/${r.video.id}`}>{r.video.title ?? r.videoId}</Link></Td>
                    <Td><PlatformBadge platform={r.platform} /></Td>
                    <Td className="text-xs">{r.socialAccount.displayName}</Td>
                    <Td>{r.success ? <Badge tone="success">Başarılı{r.privacy ? ` · ${r.privacy}` : ""}</Badge> : <Badge tone="danger">{r.errorCode ?? "Hata"}</Badge>}</Td>
                    <Td className="max-w-sm text-xs">
                      {r.postUrl ? <a className="text-primary underline" href={r.postUrl} target="_blank" rel="noreferrer noopener">{r.externalPostId}</a> : r.externalPostId}
                      {r.errorMessage ? <div className="text-danger">{r.errorMessage}</div> : null}
                    </Td>
                    <Td>{r.attempt}</Td>
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
