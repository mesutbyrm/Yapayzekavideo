import Link from "next/link";
import { prisma, env, ttsConfigured, generationLimits, budgetStatus } from "@asf/core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { currentBrand, requireUser } from "@/lib/auth";
import { GenerateClient } from "./generate-client";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Video Üret" };

export default async function GeneratePage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const e = env();
  const ready = { openai: !!e.OPENAI_API_KEY, tts: ttsConfigured(), stock: !!(e.PEXELS_API_KEY || e.PIXABAY_API_KEY) };
  const [ideas, scripts, limits, budget] = await Promise.all([
    prisma.contentIdea.findMany({ where: { brandId: brand.id, status: "NEW" }, orderBy: { createdAt: "desc" }, take: 20, include: { category: { select: { name: true } } } }),
    prisma.videoScript.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: "desc" }, take: 10, include: { videos: { select: { id: true, status: true } } } }),
    generationLimits(brand.id),
    budgetStatus(brand.id),
  ]);

  return (
    <>
      <PageHeader title="Video Üret" description="Fikir üret, senaryoyu incele ve tek tıkla videoyu üretim hattına gönder." />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Entegrasyonlar</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={ready.openai ? "success" : "danger"}>OpenAI {ready.openai ? "hazır" : "eksik"}</Badge>
            <Badge tone={ready.tts ? "success" : "danger"}>Google TTS {ready.tts ? "hazır" : "eksik"}</Badge>
            <Badge tone={ready.stock ? "success" : "warning"}>Stok video {ready.stock ? "hazır" : "yok → hareketli grafik"}</Badge>
          </div>
          {!ready.openai || !ready.tts ? <p className="mt-2 text-[11px] text-muted-foreground">Eksik anahtarlar için <Link className="underline" href="/integrations">API Bağlantıları</Link> sayfasına bakın.</p> : null}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Üretim limiti</div>
          <div className="mt-1 text-sm">Bugün {limits.brandToday}/{limits.brandDailyLimit} · Bu ay {limits.brandMonth}/{limits.brandMonthlyLimit}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{limits.allowed ? "Yeni üretim yapılabilir" : limits.reason}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Bütçe (bu ay)</div>
          {budget.map((b) => (
            <div key={b.scope} className="mt-1 text-sm">
              {b.scope === "brand" ? "Marka" : "Genel"}: ${b.spentUsd.toFixed(4)} / ${b.maxUsd} <span className="text-[11px] text-muted-foreground">(%{b.percentOfMax})</span>
            </div>
          ))}
        </Card>
      </div>

      <GenerateClient
        brandId={brand.id}
        canGenerate={limits.allowed}
        ideas={ideas.map((i) => ({ id: i.id, topic: i.topic, angle: i.angle, category: i.category?.name ?? null }))}
      />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Son senaryolar</CardTitle>
          <CardDescription>Doğrulanmış JSON senaryolar</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {scripts.length === 0 ? <p className="text-sm text-muted-foreground">Henüz senaryo yok.</p> : null}
          {scripts.map((s) => (
            <details key={s.id} className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {s.title} <span className="text-xs text-muted-foreground">· {fmtDate(s.createdAt)} · {s.attempts}. denemede · {s.videos.length} video</span>
                {s.safetyFlags.length ? <Badge tone="warning" className="ml-2">doğrulanması gereken veri</Badge> : null}
              </summary>
              <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Hook</div>
                  <p>{s.hook}</p>
                  <div className="mt-2 text-xs text-muted-foreground">Anlatım</div>
                  <p className="whitespace-pre-wrap">{s.narration}</p>
                  <div className="mt-2 text-xs text-muted-foreground">CTA</div>
                  <p>{s.cta}</p>
                  <p className="mt-2 text-xs text-primary">{s.hashtags.join(" ")}</p>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Sahneler</div>
                  <ol className="mt-1 flex list-decimal flex-col gap-1 pl-4">
                    {(s.scenes as any[]).map((sc, i) => (
                      <li key={i}>
                        <span className="font-medium">{sc.subtitle}</span> <span className="text-xs text-muted-foreground">({sc.duration} sn) – {sc.visual_description}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
