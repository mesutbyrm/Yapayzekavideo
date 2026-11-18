import { prisma, platformStatus, env } from "@asf/core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { PlatformBadge, StatusBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Sosyal Medya Hesapları" };

const CONNECT: { key: string; platform: string; label: string; note: string }[] = [
  { key: "meta", platform: "FACEBOOK", label: "Facebook Sayfası + Instagram Professional", note: "Meta ile giriş yapılır; yönettiğiniz Sayfalar ve onlara bağlı Instagram Business/Creator hesapları eklenir." },
  { key: "tiktok", platform: "TIKTOK", label: "TikTok", note: "video.publish izni istenir. Her gönderi için önizleme ve onay gerekir." },
  { key: "youtube", platform: "YOUTUBE", label: "YouTube", note: "youtube.upload izni ile kanal bağlanır. Shorts olarak yüklenir." },
];

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const sp = await searchParams;
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id }, orderBy: [{ platform: "asc" }], include: { token: { select: { expiresAt: true, lastRefreshedAt: true } } } });
  const status = platformStatus();
  const appUrl = env().APP_URL;

  return (
    <>
      <PageHeader title="Sosyal Medya Hesapları" description={`${brand.name} markasına bağlı hesaplar. Token'lar AES-256-GCM ile şifrelenir ve arayüze asla gönderilmez.`} />
      {sp.connected ? <Card className="mb-4 border-success/40 p-3 text-sm text-success">{sp.connected} hesap bağlandı.</Card> : null}
      {sp.error ? <Card className="mb-4 border-danger/40 p-3 text-sm text-danger">Bağlantı hatası: {sp.error}</Card> : null}

      <div className="grid gap-3 md:grid-cols-3">
        {CONNECT.map((c) => {
          const st = status.find((s) => s.platform === c.platform)!;
          return (
            <Card key={c.key}>
              <CardHeader>
                <CardTitle>{c.label}</CardTitle>
                <CardDescription>{c.note}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {st.configured ? (
                  <a className={buttonVariants()} href={`/api/oauth/${c.key}/start?brandId=${brand.id}`}>Hesap bağla</a>
                ) : (
                  <>
                    <Badge tone="warning">Uygulama anahtarları eksik</Badge>
                    <p className="text-[11px] text-muted-foreground">Gerekli ortam değişkenleri: {st.requiredEnv.join(", ")}</p>
                  </>
                )}
                <p className="break-all text-[11px] text-muted-foreground">Yönlendirme URI: {appUrl}/api/oauth/{c.key}/callback</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Bağlı hesaplar</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {accounts.length === 0 ? <p className="text-sm text-muted-foreground">Bu markaya bağlı hesap yok.</p> : null}
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {a.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
                ) : <div className="h-9 w-9 rounded-full bg-muted" />}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{a.displayName}{a.username ? <span className="text-xs text-muted-foreground">@{a.username}</span> : null}<PlatformBadge platform={a.platform} /><StatusBadge status={a.status} /></div>
                  <div className="text-[11px] text-muted-foreground">
                    Bağlandı: {fmtDate(a.connectedAt)} · Son kontrol: {fmtDate(a.lastCheckedAt)}
                    {a.token?.expiresAt ? ` · Token bitişi: ${fmtDate(a.token.expiresAt)} (otomatik yenilenir)` : ""}
                    {a.platform === "TIKTOK" && !a.directPostAudited ? " · Denetimsiz: yalnızca özel paylaşım" : ""}
                  </div>
                  {a.lastError ? <div className="text-[11px] text-danger">{a.lastError}</div> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <ActionButton url={`/api/social-accounts/${a.id}`} method="PATCH" body={{ autoPublish: !a.autoPublish }} variant="outline">{a.autoPublish ? "Otomatik yayın: Açık" : "Otomatik yayın: Kapalı"}</ActionButton>
                {a.status === "TOKEN_EXPIRED" || a.status === "ERROR" ? (
                  <a className={buttonVariants({ size: "sm" })} href={`/api/oauth/${a.platform === "TIKTOK" ? "tiktok" : a.platform === "YOUTUBE" ? "youtube" : "meta"}/start?brandId=${brand.id}`}>Yeniden bağla</a>
                ) : null}
                {a.status !== "DISCONNECTED" ? <ActionButton url={`/api/social-accounts/${a.id}`} method="DELETE" variant="danger" confirm="Bağlantı iptal edilsin mi? Bekleyen yayın işleri iptal edilir.">Bağlantıyı kes</ActionButton> : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
