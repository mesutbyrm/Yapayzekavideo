import { env, platformStatus, storage, ttsConfigured, emailConfigured, aiImagesEnabled, redis, prisma } from "@asf/core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Table, Td, Th } from "@/components/ui";
import { PlatformBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "API Bağlantıları" };

export default async function IntegrationsPage() {
  await requireUser();
  const e = env();
  const storageHealth = await storage().healthCheck().catch((err) => ({ ok: false, message: String(err?.message ?? err) }));
  const redisOk = await redis().ping().then((r) => r === "PONG").catch(() => false);
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const rows = [
    { name: "PostgreSQL", ok: dbOk, env: "DATABASE_URL", note: "Veritabanı" },
    { name: "Redis / BullMQ", ok: redisOk, env: "REDIS_URL", note: "Kuyruk sistemi" },
    { name: "OpenAI", ok: !!e.OPENAI_API_KEY, env: "OPENAI_API_KEY", note: `Senaryo + moderasyon · model ${e.OPENAI_MODEL}` },
    { name: "Google Cloud Text-to-Speech", ok: ttsConfigured(), env: "GOOGLE_APPLICATION_CREDENTIALS veya GOOGLE_TTS_CREDENTIALS_JSON", note: "Türkçe seslendirme (Cloud Text-to-Speech API etkin olmalı)" },
    { name: "Pexels", ok: !!e.PEXELS_API_KEY, env: "PEXELS_API_KEY", note: "Ücretsiz stok video (yoksa sıradaki sağlayıcı kullanılır)" },
    { name: "Pixabay", ok: !!e.PIXABAY_API_KEY, env: "PIXABAY_API_KEY", note: "Ücretsiz stok video (alternatif)" },
    { name: "OpenAI görsel üretimi", ok: aiImagesEnabled(), env: "AI_IMAGES_ENABLED=true", note: "Opsiyonel, ücretli; stok bulunamazsa" },
    { name: e.STORAGE_DRIVER === "r2" ? "Cloudflare R2" : "Yerel depolama", ok: storageHealth.ok, env: "STORAGE_DRIVER, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL", note: storageHealth.message },
    { name: "E-posta (SMTP)", ok: emailConfigured(), env: "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, ALERT_EMAIL", note: "Bildirim e-postaları" },
  ];
  const platforms = platformStatus();
  const PLATFORM_NOTES: Record<string, string> = {
    INSTAGRAM: `Meta Graph API ${e.META_GRAPH_VERSION} · İzinler: instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement (+ instagram_manage_insights). App Review gerekli.`,
    FACEBOOK: `Reels Publishing API · İzinler: pages_show_list, pages_read_engagement, pages_manage_posts (+ read_insights). 24 saatte 30 API yayını.`,
    TIKTOK: `Content Posting API (Direct Post) · Kapsam: video.publish, user.info.basic. ${e.TIKTOK_DIRECT_POST_AUDITED ? "Denetim tamam: herkese açık paylaşım açık." : "Denetim yok: yalnızca SELF_ONLY (özel) paylaşım."}`,
    YOUTUBE: "YouTube Data API v3 · videos.insert = 100 kota birimi (varsayılan 10.000/gün). Denetlenmemiş projelerde yüklemeler özel moda kilitlenebilir; herkese açık için API denetimi gerekir.",
  };
  return (
    <>
      <PageHeader title="API Bağlantıları" description="Anahtarlar sunucuda ortam değişkenlerinden okunur ve arayüze asla gönderilmez. Değişiklik için .env dosyasını güncelleyip servisleri yeniden başlatın." />
      <Card>
        <CardHeader><CardTitle>Altyapı ve üretim servisleri</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <thead><tr><Th>Servis</Th><Th>Durum</Th><Th>Ortam değişkeni</Th><Th>Not</Th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.name}><Td className="font-medium">{r.name}</Td><Td><Badge tone={r.ok ? "success" : "warning"}>{r.ok ? "Hazır" : "Yapılandırılmadı"}</Badge></Td><Td className="font-mono text-[11px]">{r.env}</Td><Td className="text-xs text-muted-foreground">{r.note}</Td></tr>)}</tbody>
          </Table>
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader><CardTitle>Sosyal medya uygulamaları</CardTitle><CardDescription>Her platform bağımsız bir yayın servisidir. Bir platformun eksik olması diğerlerini durdurmaz.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <thead><tr><Th>Platform</Th><Th>Uygulama anahtarı</Th><Th>Gerekli ENV</Th><Th>Yönlendirme URI</Th><Th>Not</Th></tr></thead>
            <tbody>
              {platforms.map((p) => (
                <tr key={p.platform}>
                  <Td><PlatformBadge platform={p.platform} /></Td>
                  <Td><Badge tone={p.configured ? "success" : "warning"}>{p.configured ? "Var" : "Yok"}</Badge></Td>
                  <Td className="font-mono text-[11px]">{p.requiredEnv.join(", ")}</Td>
                  <Td className="break-all font-mono text-[11px]">{e.APP_URL}/api/oauth/{p.platform === "TIKTOK" ? "tiktok" : p.platform === "YOUTUBE" ? "youtube" : "meta"}/callback</Td>
                  <Td className="text-xs text-muted-foreground">{PLATFORM_NOTES[p.platform]}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
