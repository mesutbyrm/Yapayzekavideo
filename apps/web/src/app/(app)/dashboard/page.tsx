import Link from "next/link";
import { Clapperboard, Eye, Heart, MessageCircle, Share2, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Table, Td, Th, buttonVariants } from "@/components/ui";
import { Stat } from "@/components/stat";
import { PlatformBars, SeriesArea, SimpleBars, PLATFORM_COLORS } from "@/components/charts/charts";
import { PlatformBadge } from "@/components/status-badge";
import { currentBrand, requireUser } from "@/lib/auth";
import { dashboardData } from "@/lib/dashboard";
import { VideoProgressPanel } from "@/components/video-progress";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Henüz marka yok" description="Başlamak için bir marka oluşturun." action={<Link className={buttonVariants()} href="/brands">Marka oluştur</Link>} />;
  const d = await dashboardData([brand.id]);
  const k = d.kpi;

  return (
    <>
      <PageHeader
        title={`${brand.name} – Genel Bakış`}
        description="Bütün göstergeler gerçek verilerden hesaplanır. Platform metrikleri yalnızca platformların sağladığı ölçüde gösterilir."
        actions={<Link href="/generate" className={buttonVariants()}><Clapperboard className="h-4 w-4" />Video üret</Link>}
      />

      <VideoProgressPanel brandId={brand.id} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Bugün üretilen" value={`${k.today} / ${brand.dailyVideoTarget}`} hint="Günlük hedef" />
        <Stat label="Bu ay üretilen" value={`${k.monthCount} / ${brand.monthlyVideoTarget}`} hint="Aylık hedef" />
        <Stat label="Bekleyen" value={k.pendingVideos + k.pendingJobs} hint={`${k.pendingVideos} üretimde · ${k.pendingJobs} yayın işi`} tone={k.pendingJobs ? "warning" : undefined} />
        <Stat label="Başarılı yayın (ay)" value={k.okPub} tone="success" />
        <Stat label="Başarısız yayın (ay)" value={k.failPub} tone={k.failPub ? "danger" : undefined} />
        <Stat label="Takipçi değişimi (30g)" value={k.followerDelta === null ? "—" : `${k.followerDelta >= 0 ? "+" : ""}${fmtNum(k.followerDelta)}`} icon={<TrendingUp className="h-3.5 w-3.5" />} />
        <Stat label="Toplam izlenme" value={k.totals.hasData ? fmtNum(k.totals.views) : "—"} icon={<Eye className="h-3.5 w-3.5" />} />
        <Stat label="Toplam beğeni" value={k.totals.hasData ? fmtNum(k.totals.likes) : "—"} icon={<Heart className="h-3.5 w-3.5" />} />
        <Stat label="Yorumlar" value={k.totals.hasData ? fmtNum(k.totals.comments) : "—"} icon={<MessageCircle className="h-3.5 w-3.5" />} />
        <Stat label="Paylaşımlar" value={k.totals.hasData ? fmtNum(k.totals.shares) : "—"} icon={<Share2 className="h-3.5 w-3.5" />} hint="YouTube paylaşım verisi sağlamaz" />
        <Stat label="Aylık AI maliyeti" value={fmtUsd(k.monthCost, 4)} hint={`Bütçe: $${Number(brand.monthlyBudgetUsd)} hedef / $${Number(brand.maxBudgetUsd)} üst sınır`} icon={<Wallet className="h-3.5 w-3.5" />} tone={k.monthCost >= Number(brand.maxBudgetUsd) ? "danger" : undefined} />
        <Stat label="Video başına maliyet" value={k.avgCost === null ? "—" : fmtUsd(k.avgCost, 4)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Günlük video üretimi</CardTitle><CardDescription>Son 30 gün</CardDescription></CardHeader>
          <CardContent><SeriesArea data={d.daily} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Platform başarı oranı</CardTitle><CardDescription>Bu ay, yayın işi bazında</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {d.successRate.length === 0 ? <p className="text-sm text-muted-foreground">Bu ay henüz yayın işi yok.</p> : null}
            {d.successRate.map((r) => (
              <div key={r.platform} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs"><PlatformBadge platform={r.platform} /><span className="tabular-nums">{fmtPct(r.rate)} <span className="text-muted-foreground">({r.ok}/{r.ok + r.fail})</span></span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(r.rate ?? 0) * 100}%`, background: PLATFORM_COLORS[r.platform] }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Haftalık üretim</CardTitle><CardDescription>Son 12 hafta</CardDescription></CardHeader>
          <CardContent><SimpleBars data={d.weekly} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Aylık üretim</CardTitle><CardDescription>Son 12 ay</CardDescription></CardHeader>
          <CardContent><SimpleBars data={d.monthly} color="#a78bfa" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Aylık maliyet</CardTitle><CardDescription>Son 6 ay (USD, tüm sağlayıcılar)</CardDescription></CardHeader>
          <CardContent><SeriesArea data={d.monthlyCost} color="#f59e0b" valueFormat="usd" /></CardContent>
        </Card>
        <Card className="lg:col-span-3 xl:col-span-1">
          <CardHeader><CardTitle>Platform bazında izlenmeler</CardTitle></CardHeader>
          <CardContent>{d.perPlatform.length ? <PlatformBars data={d.perPlatform} keys={[{ key: "views", label: "İzlenme", color: "#8b5cf6" }]} /> : <p className="text-sm text-muted-foreground">Henüz platform metriği alınmadı.</p>}</CardContent>
        </Card>
        <Card className="lg:col-span-3 xl:col-span-2">
          <CardHeader><CardTitle>Platform bazında etkileşim</CardTitle></CardHeader>
          <CardContent>{d.perPlatform.length ? <PlatformBars data={d.perPlatform} keys={[{ key: "likes", label: "Beğeni", color: "#ec4899" }, { key: "comments", label: "Yorum", color: "#38bdf8" }, { key: "shares", label: "Paylaşım", color: "#10b981" }]} /> : <p className="text-sm text-muted-foreground">Henüz platform metriği alınmadı.</p>}</CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>En başarılı 10 video</CardTitle><CardDescription>Platformlardan alınan son metriklere göre</CardDescription></CardHeader>
        <CardContent>
          {d.top.length === 0 ? (
            <p className="text-sm text-muted-foreground">Yayınlanmış ve metrikleri alınmış video yok.</p>
          ) : (
            <Table>
              <thead><tr><Th>Video</Th><Th>Platformlar</Th><Th className="text-right">İzlenme</Th><Th className="text-right">Beğeni</Th><Th className="text-right">Yorum</Th><Th className="text-right">Etkileşim</Th></tr></thead>
              <tbody>
                {d.top.map((v) => (
                  <tr key={v.id}>
                    <Td><Link className="hover:underline" href={`/library/${v.id}`}>{v.title ?? v.id}</Link></Td>
                    <Td><div className="flex flex-wrap gap-1">{v.platforms.map((p) => <PlatformBadge key={p} platform={p} />)}</div></Td>
                    <Td className="text-right tabular-nums">{fmtNum(v.views)}</Td>
                    <Td className="text-right tabular-nums">{fmtNum(v.likes)}</Td>
                    <Td className="text-right tabular-nums">{fmtNum(v.comments)}</Td>
                    <Td className="text-right tabular-nums">{fmtPct(v.engagementRate)}</Td>
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
