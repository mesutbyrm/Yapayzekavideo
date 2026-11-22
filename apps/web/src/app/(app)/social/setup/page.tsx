import Link from "next/link";
import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { env, platformStatus } from "@asf/core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { currentBrand, requireUser } from "@/lib/auth";

export const metadata = { title: "Sosyal API Kurulum Yardımı" };

const guides = [
  { id: "youtube", title: "YouTube Shorts", platforms: ["YOUTUBE"], urls: [["Google Cloud Console","https://console.cloud.google.com/"],["YouTube Data API v3","https://console.cloud.google.com/apis/library/youtube.googleapis.com"],["OAuth istemcileri","https://console.cloud.google.com/auth/clients"]], redirect: "youtube", variables: ["GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET"], steps: ["Google Cloud projesi oluşturun ve YouTube Data API v3’ü etkinleştirin.","OAuth izin ekranını yapılandırıp Web uygulaması istemcisi oluşturun.","Yönlendirme URI’sini ekleyin; OAuth kapsamı yalnızca youtube.upload ve kanal bilgisini okumak için youtube.readonly kullanır.","Kimlik bilgilerini VPS’nin korumalı ortam ayarlarına ekleyin; ardından hesaplar sayfasından kanalınızı bağlayın."] },
  { id: "meta", title: "Instagram Reels ve Facebook Reels", platforms: ["INSTAGRAM","FACEBOOK"], urls: [["Meta for Developers","https://developers.facebook.com/"],["Meta uygulamaları","https://developers.facebook.com/apps/"]], redirect: "meta", variables: ["META_APP_ID","META_APP_SECRET","META_GRAPH_VERSION"], steps: ["Meta uygulamasında Facebook Login ve ilgili Instagram/Page ürünlerini ayarlayın.","Instagram için profesyonel (Business/Creator) hesap ve bağlı Facebook Sayfası gerekir; Facebook yayınları kişisel profil yerine Sayfaya gider.","Meta uygulamasına gösterilen izinleri ve inceleme durumunu kontrol edin; kullanıcı OAuth ekranında izinleri kendisi onaylar.","Aşağıdaki callback URI’yi ekleyin, kimlik bilgilerini VPS’ye kaydedin ve hesaplar sayfasından Meta’ya bağlanın."] },
  { id: "tiktok", title: "TikTok Content Posting", platforms: ["TIKTOK"], urls: [["TikTok Developer Portal","https://developers.tiktok.com/"],["Content Posting API","https://developers.tiktok.com/products/content-posting-api/"]], redirect: "tiktok", variables: ["TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET","TIKTOK_DIRECT_POST_AUDITED"], steps: ["Developer Portal’da uygulama oluşturup Content Posting API ürününü ve video.publish kapsamını ekleyin.","Uygulama incelemesi ve Direct Post onayı gerekiyorsa başvurun; video URL’si için alan adı sahipliğini doğrulayın.","Callback URI’yi ekleyin ve anahtarları VPS ortamında saklayın.","Denetimsiz istemcilerde yalnızca SELF_ONLY görünürlüğü kabul edilir. Her paylaşım öncesinde kullanıcı gizlilik seçimi ve açık onay verir."] },
] as const;

export default async function SocialSetupPage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const appUrl = env().APP_URL.replace(/\/$/, "");
  const statuses = platformStatus();
  return <>
    <PageHeader title="Sosyal API Kurulum Yardımı" description="Resmî platform panellerinde uygulama ve izinleri kurun; ardından OAuth bağlantısını burada tamamlayın." actions={<Link className={buttonVariants({variant:"outline"})} href="/accounts">Hesapları görüntüle</Link>} />
    <Card className="mb-4 border-warning/40"><CardContent className="flex gap-3 pt-4 text-sm"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>OAuth istemci sırları ve platform erişim token’ları bu sayfaya girilmez. Bunları VPS’nin korumalı ortam değişkenlerinde tutun. Bu yardımcı platform hesaplarını sizin yerinize oluşturmaz, şifre/MFA girmez veya uygulama incelemesini atlamaz.</p></CardContent></Card>
    <div className="grid gap-4 xl:grid-cols-3">{guides.map((guide) => {
      const rows = statuses.filter((s) => (guide.platforms as readonly string[]).includes(s.platform));
      const configured = rows.every((s) => s.configured);
      return <Card key={guide.id}>
        <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>{guide.title}</CardTitle><Badge tone={configured ? "success" : "warning"}>{configured ? "Uygulama ayarları hazır" : "Kurulum bilgisi eksik"}</Badge></div><CardDescription>Hesap verileri marka kapsamında ayrılır; token değerleri arayüze döndürülmez.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm">{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="rounded-lg border border-border p-3 text-xs"><div className="font-medium">OAuth callback adresi</div><code className="mt-1 block break-all text-muted-foreground">{appUrl}/api/oauth/{guide.redirect}/callback</code></div>
          <div className="text-xs text-muted-foreground">Gerekli sunucu ayarları: {guide.variables.join(", ")}</div>
          <div className="flex flex-wrap gap-2">{guide.urls.map(([label,url]) => <a key={url} className={buttonVariants({variant:"outline",size:"sm"})} href={url} target="_blank" rel="noreferrer noopener">{label}<ExternalLink className="h-3 w-3" /></a>)}</div>
          <div className="flex items-center gap-2 text-xs">{configured ? <><CheckCircle2 className="h-4 w-4 text-success" />OAuth başlatılabilir.</> : <span className="text-muted-foreground">Önce sunucu ayarları yönetici tarafından tamamlanmalı.</span>}</div>
          <div className="flex flex-wrap gap-1">{rows.map((s) => <Badge key={s.platform} tone={s.configured ? "success" : "warning"}>{s.platform}: {s.configured ? "hazır" : "bekliyor"}</Badge>)}</div>
        </CardContent>
      </Card>;
    })}</div>
  </>;
}
