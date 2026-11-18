import Link from "next/link";
import { DateTime } from "luxon";
import { costReport, budgetStatus, DEFAULT_TZ, env } from "@asf/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { SeriesArea } from "@/components/charts/charts";
import { Stat } from "@/components/stat";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtNum, fmtUsd } from "@/lib/utils";

export const metadata = { title: "Maliyet Yönetimi" };

const RANGES = [
  { key: "day", label: "Günlük" },
  { key: "week", label: "Haftalık" },
  { key: "month", label: "Aylık" },
  { key: "90d", label: "Son 90 gün" },
];

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ range?: string; scope?: string }> }) {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const sp = await searchParams;
  const range = RANGES.some((r) => r.key === sp.range) ? sp.range! : "month";
  const allBrands = sp.scope === "all" && user.role === "ADMIN";
  const now = DateTime.now().setZone(DEFAULT_TZ);
  const from = range === "day" ? now.startOf("day") : range === "week" ? now.startOf("week") : range === "90d" ? now.minus({ days: 90 }) : now.startOf("month");
  const [report, budget] = await Promise.all([costReport(allBrands ? null : [brand.id], from.toJSDate(), now.toJSDate(), range === "90d" ? "week" : "day"), budgetStatus(brand.id)]);
  const e = env();

  return (
    <>
      <PageHeader title="Maliyet Yönetimi" description="Her API çağrısı gerçek kullanım (token, karakter, adet) ile kaydedilir. Bütçe sınırında yalnızca ücretli üretim durur; yayınlama devam eder." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {RANGES.map((r) => <Link key={r.key} href={`/costs?range=${r.key}${allBrands ? "&scope=all" : ""}`} className={`rounded-full border px-3 py-1 text-xs ${range === r.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>{r.label}</Link>)}
        {user.role === "ADMIN" ? <Link href={`/costs?range=${range}${allBrands ? "" : "&scope=all"}`} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{allBrands ? "Yalnızca bu marka" : "Tüm markalar"}</Link> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Toplam maliyet" value={fmtUsd(report.totalUsd, 4)} />
        <Stat label="Video başına ortalama" value={fmtUsd(report.avgPerVideoUsd, 4)} hint={`${report.videoCount} video`} />
        <Stat label="OpenAI token" value={fmtNum(report.openAiTokens.input + report.openAiTokens.output)} hint={`${fmtNum(report.openAiTokens.input)} giriş · ${fmtNum(report.openAiTokens.output)} çıkış`} />
        <Stat label="TTS karakter" value={fmtNum(report.ttsCharacters)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Maliyet zaman serisi</CardTitle></CardHeader>
          <CardContent><SeriesArea data={report.series.map((s) => ({ label: s.date.slice(5), value: s.usd }))} color="#f59e0b" valueFormat="usd" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Bütçe durumu (bu ay)</CardTitle><CardDescription>Bütçeye yalnızca değişken üretim maliyetleri sayılır</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {budget.map((b) => (
              <div key={b.scope}>
                <div className="flex justify-between text-sm"><span>{b.scope === "brand" ? "Marka" : "Sistem geneli"}</span><span className="tabular-nums">{fmtUsd(b.spentUsd, 4)} / {fmtUsd(b.maxUsd)}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${b.blocked ? "bg-danger" : b.percentOfMax > 80 ? "bg-warning" : "bg-success"}`} style={{ width: `${Math.min(100, b.percentOfMax)}%` }} /></div>
                <div className="mt-1 text-[11px] text-muted-foreground">Hedef {fmtUsd(b.targetUsd)} · kalan {fmtUsd(b.remainingUsd, 4)}{b.blocked ? " · ÜCRETLİ ÜRETİM DURDURULDU" : ""}</div>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">Fiyat varsayımları (ENV ile değiştirilebilir): OpenAI ${e.OPENAI_INPUT_PRICE_PER_1M}/${e.OPENAI_OUTPUT_PRICE_PER_1M} per 1M token ({e.OPENAI_MODEL}), Google TTS ${e.GOOGLE_TTS_PRICE_PER_1M_CHARS} per 1M karakter, R2 ${e.R2_PRICE_PER_GB_MONTH}/GB-ay, sunucu ${e.SERVER_MONTHLY_COST_USD}/ay.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sağlayıcı bazında</CardTitle></CardHeader>
          <CardContent>
            <Table><thead><tr><Th>Sağlayıcı</Th><Th className="text-right">USD</Th></tr></thead><tbody>{report.byProvider.map((p) => <tr key={p.provider}><Td>{p.provider}</Td><Td className="text-right tabular-nums">{fmtUsd(p.usd, 4)}</Td></tr>)}</tbody></Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Marka bazında</CardTitle></CardHeader>
          <CardContent>
            <Table><thead><tr><Th>Marka</Th><Th className="text-right">USD</Th></tr></thead><tbody>{report.byBrand.map((b) => <tr key={b.brandId}><Td>{b.name}</Td><Td className="text-right tabular-nums">{fmtUsd(b.usd, 4)}</Td></tr>)}</tbody></Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Video bazında (en yüksek 50)</CardTitle></CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            <Table><thead><tr><Th>Video</Th><Th className="text-right">USD</Th></tr></thead><tbody>{report.byVideo.map((v) => <tr key={v.videoId}><Td><Link className="hover:underline" href={`/library/${v.videoId}`}>{v.title}</Link></Td><Td className="text-right tabular-nums">{fmtUsd(v.usd, 4)}</Td></tr>)}</tbody></Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
