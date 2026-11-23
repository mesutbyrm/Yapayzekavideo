import Link from "next/link";
import { DateTime } from "luxon";
import { ArrowRight, CalendarDays, Clock3, History, Link2, ListOrdered, Settings2 } from "lucide-react";
import { DEFAULT_TZ, prisma } from "@asf/core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { PlatformBadge, StatusBadge } from "@/components/status-badge";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Sosyal Medya Yayın Merkezi" };

const links = [
  { href: "/accounts", title: "Hesaplar", text: "YouTube, Meta ve TikTok bağlantılarını görüntüle ve test et.", icon: Link2 },
  { href: "/social/setup", title: "Kurulum yardımı", text: "Resmî geliştirici portallarını, izinleri ve dönüş adreslerini gör.", icon: Settings2 },
  { href: "/social/calendar", title: "Yayın takvimi", text: "Platform hesabına göre yayın saatlerini planla ve değiştir.", icon: CalendarDays },
  { href: "/queue", title: "Yayın kuyruğu", text: "Bekleyen, işlenen veya sorun yaşayan yayınları takip et.", icon: ListOrdered },
  { href: "/history", title: "Yayın geçmişi", text: "Gerçek gönderi bağlantılarını ve yayın sonuçlarını incele.", icon: History },
] as const;

export default async function SocialCenterPage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const todayStart = DateTime.now().setZone(brand.timezone || DEFAULT_TZ).startOf("day").toUTC().toJSDate();
  const tomorrow = DateTime.fromJSDate(todayStart, { zone: "utc" }).plus({ days: 1 }).toJSDate();
  const [accounts, scheduled, today, published, failed, recent] = await Promise.all([
    prisma.socialAccount.findMany({ where: { brandId: brand.id }, orderBy: [{ platform: "asc" }, { displayName: "asc" }], select: { id: true, platform: true, displayName: true, status: true, lastError: true, directPostAudited: true } }),
    prisma.publishJob.count({ where: { brandId: brand.id, status: { in: ["SCHEDULED", "AWAITING_CONSENT"] } } }),
    prisma.publishJob.count({ where: { brandId: brand.id, scheduledAt: { gte: todayStart, lt: tomorrow }, status: { in: ["SCHEDULED", "AWAITING_CONSENT", "RUNNING", "PROCESSING"] } } }),
    prisma.publishResult.count({ where: { brandId: brand.id, success: true } }),
    prisma.publishJob.count({ where: { brandId: brand.id, status: { in: ["FAILED", "BLOCKED"] } } }),
    prisma.publishResult.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, platform: true, success: true, postUrl: true, createdAt: true, video: { select: { title: true } }, socialAccount: { select: { displayName: true } } } }),
  ]);
  const stats = [
    ["Bağlı hesap", accounts.filter((a) => a.status === "CONNECTED").length],
    ["Planlanmış hedef", scheduled],
    ["Bugün yayınlanacak", today],
    ["Başarılı yayın", published],
    ["Hata / engel", failed],
  ];
  return <>
    <PageHeader title="Sosyal Medya Yayın Merkezi" description={brand.name + " · hesap bağlantıları, planlama ve gerçek yayın durumu"} actions={<Link className={buttonVariants()} href="/accounts">Hesapları yönet<ArrowRight className="h-4 w-4" /></Link>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{stats.map(([label, value]) => <Card key={label}><CardContent className="pt-5"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></CardContent></Card>)}</div>
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card><CardHeader><CardTitle>Hesap bağlantıları</CardTitle><CardDescription>Durumlar gerçek OAuth bağlantı kayıtlarından alınır.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">
        {accounts.length ? accounts.map((a) => <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"><PlatformBadge platform={a.platform} /><span className="min-w-28 flex-1 text-sm font-medium">{a.displayName}</span><StatusBadge status={a.status} />{a.platform === "TIKTOK" && !a.directPostAudited ? <Badge tone="warning">Denetimsiz · yalnızca özel paylaşım</Badge> : null}{a.lastError ? <span className="basis-full text-xs text-danger">{a.lastError}</span> : null}</div>) : <p className="text-sm text-muted-foreground">Henüz bağlı hesap yok. Kurulum yardımıyla başlayın.</p>}
      </CardContent></Card>
      <div className="grid gap-3 sm:grid-cols-2">{links.map(({href,title,text:description,icon:Icon}) => <Link href={href} key={href} className="block"><Card className="h-full transition-colors hover:border-primary/50"><CardContent className="flex gap-3 pt-5"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span><div><div className="font-medium">{title}</div><p className="mt-1 text-xs text-muted-foreground">{description}</p></div></CardContent></Card></Link>)}</div>
    </div>
    <Card className="mt-4"><CardHeader><CardTitle>Son yayınlar</CardTitle><CardDescription>Platform API’sinden alınan gerçek sonuçlar.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">
      {recent.length ? recent.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0"><PlatformBadge platform={r.platform} /><span className="min-w-40 flex-1 text-sm">{r.video.title ?? "Başlıksız video"} · {r.socialAccount.displayName}</span><StatusBadge status={r.success ? "SUCCEEDED" : "FAILED"} /><span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>{r.postUrl ? <a className="text-xs text-primary underline" href={r.postUrl} target="_blank" rel="noreferrer noopener">Yayını aç</a> : null}</div>) : <p className="text-sm text-muted-foreground">Henüz yayın geçmişi yok.</p>}
    </CardContent></Card>
    <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Planlar Europe/Istanbul saatine göre gösterilir; zamanlanmış işler sunucudaki BullMQ/Redis üzerinde yürütülür.</p>
  </>;
}
