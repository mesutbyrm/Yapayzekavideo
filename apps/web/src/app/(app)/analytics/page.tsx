import Link from "next/link";
import { prisma, latestSnapshots, topVideos, categoryPerformance } from "@asf/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { PlatformBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { PlatformBars } from "@/components/charts/charts";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtDate, fmtNum, fmtPct } from "@/lib/utils";

export const metadata = { title: "Analizler" };

const METRICS = ["views", "likes", "comments", "shares", "saves"] as const;
const LABEL: Record<string, string> = { views: "İzlenme", likes: "Beğeni", comments: "Yorum", shares: "Paylaşım", saves: "Kaydetme" };

export default async function AnalyticsPage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const [snaps, top, cats, lastSnap] = await Promise.all([
    latestSnapshots([brand.id]),
    topVideos([brand.id], 10),
    categoryPerformance(brand.id),
    prisma.analyticsSnapshot.findFirst({ where: { brandId: brand.id }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
  ]);
  type Agg = { posts: number } & Record<(typeof METRICS)[number], number | null>;
  const plat: Record<string, Agg> = {};
  for (const s of snaps) {
    const p = (plat[s.platform] ??= { posts: 0, views: null, likes: null, comments: null, shares: null, saves: null });
    p.posts++;
    for (const m of METRICS) if (s[m] !== null) p[m] = (p[m] ?? 0) + (s[m] ?? 0);
  }
  const rows = Object.entries(plat).map(([platform, v]) => ({ platform, ...v, engagement: v.views ? ((v.likes ?? 0) + (v.comments ?? 0) + (v.shares ?? 0) + (v.saves ?? 0)) / v.views : null }));

  return (
    <>
      <PageHeader
        title="Analizler"
        description={`Son metrik toplama: ${fmtDate(lastSnap?.capturedAt)} · Her 6 saatte bir otomatik güncellenir. Platformun sunmadığı metrikler "—" olarak gösterilir, tahmin edilmez.`}
        actions={<ActionButton url="/api/analytics/collect" body={{ brandId: brand.id }} variant="outline">Şimdi güncelle</ActionButton>}
      />
      <Card>
        <CardHeader><CardTitle>Platform bazında</CardTitle><CardDescription>Her platform kendi sağladığı metriklerle ayrı değerlendirilir</CardDescription></CardHeader>
        <CardContent>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">Henüz metrik yok. Yayınlanan videoların metrikleri platformlardan alındıkça burada görünür.</p> : (
            <>
              <Table>
                <thead><tr><Th>Platform</Th><Th className="text-right">Gönderi</Th>{METRICS.map((m) => <Th key={m} className="text-right">{LABEL[m]}</Th>)}<Th className="text-right">Etkileşim oranı</Th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.platform}>
                      <Td><PlatformBadge platform={r.platform} /></Td>
                      <Td className="text-right">{r.posts}</Td>
                      {METRICS.map((m) => <Td key={m} className="text-right tabular-nums">{fmtNum(r[m] as number | null)}</Td>)}
                      <Td className="text-right">{fmtPct(r.engagement)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-4"><PlatformBars data={rows.map((r) => ({ platform: r.platform, views: r.views ?? 0, likes: r.likes ?? 0, comments: r.comments ?? 0 }))} keys={[{ key: "views", label: "İzlenme", color: "#8b5cf6" }, { key: "likes", label: "Beğeni", color: "#ec4899" }, { key: "comments", label: "Yorum", color: "#38bdf8" }]} /></div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>En başarılı videolar</CardTitle></CardHeader>
          <CardContent>
            {top.length === 0 ? <p className="text-sm text-muted-foreground">Veri yok.</p> : (
              <Table>
                <thead><tr><Th>Video</Th><Th>Konu</Th><Th className="text-right">İzlenme</Th><Th className="text-right">Etkileşim</Th></tr></thead>
                <tbody>{top.map((t) => <tr key={t.id}><Td><Link className="hover:underline" href={`/library/${t.id}`}>{t.title}</Link></Td><Td className="text-xs">{t.topic ?? "—"}</Td><Td className="text-right">{fmtNum(t.views)}</Td><Td className="text-right">{fmtPct(t.engagementRate)}</Td></tr>)}</tbody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Kategori performansı ve öneriler</CardTitle><CardDescription>Gerçek performans verisine göre; fikir motoru en iyi konuları otomatik dikkate alır</CardDescription></CardHeader>
          <CardContent>
            {cats.rows.length ? (
              <Table>
                <thead><tr><Th>Kategori</Th><Th className="text-right">Video</Th><Th className="text-right">Ort. izlenme</Th><Th className="text-right">Ort. etkileşim</Th></tr></thead>
                <tbody>{cats.rows.map((c) => <tr key={c.category}><Td>{c.category}</Td><Td className="text-right">{c.videos}</Td><Td className="text-right">{fmtNum(c.avgViews)}</Td><Td className="text-right">{fmtPct(c.avgEngagement)}</Td></tr>)}</tbody>
              </Table>
            ) : null}
            <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm">{cats.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
