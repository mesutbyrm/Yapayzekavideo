import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_TZ, prisma } from "@asf/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { PlatformBadge, StatusBadge } from "@/components/status-badge";
import { currentBrand, requireUser } from "@/lib/auth";
import { PublishScheduleEditor } from "./publish-schedule-editor";

export const metadata = { title: "Sosyal Yayın Takvimi" };

export default async function SocialCalendarPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const offset = Number((await searchParams).w ?? 0) || 0;
  const zone = brand.timezone || DEFAULT_TZ;
  const start = DateTime.now().setZone(zone).startOf("week").plus({ weeks: offset });
  const end = start.plus({ days: 7 });
  const jobs = await prisma.publishJob.findMany({
    where: { brandId: brand.id, scheduledAt: { gte: start.toUTC().toJSDate(), lt: end.toUTC().toJSDate() }, status: { in: ["SCHEDULED", "AWAITING_CONSENT", "RUNNING", "PROCESSING", "FAILED", "BLOCKED"] } },
    orderBy: { scheduledAt: "asc" }, take: 300,
    include: { video: { select: { id: true, title: true } }, socialAccount: { select: { displayName: true } } },
  });
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  return <>
    <PageHeader title="Sosyal Yayın Takvimi" description={`${start.setLocale("tr").toFormat("dd LLL")} – ${end.minus({ days: 1 }).setLocale("tr").toFormat("dd LLL yyyy")} · ${zone}`} actions={<><Link className={buttonVariants({variant:"outline",size:"sm"})} href={`/social/calendar?w=${offset-1}`}><ChevronLeft className="h-4 w-4" />Önceki</Link><Link className={buttonVariants({variant:"outline",size:"sm"})} href="/social/calendar">Bu hafta</Link><Link className={buttonVariants({variant:"outline",size:"sm"})} href={`/social/calendar?w=${offset+1}`}>Sonraki<ChevronRight className="h-4 w-4" /></Link></>} />
    <Card className="mb-4"><CardContent className="pt-4 text-sm text-muted-foreground">Takvimde platform hedefleri ayrı gösterilir. Her hesabın saati bağımsız düzenlenebilir. TikTok gönderileri kullanıcı onayı verilene kadar paylaşılmaz.</CardContent></Card>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">{days.map((day) => {
      const key = day.toISODate();
      const items = jobs.filter((job) => DateTime.fromJSDate(job.scheduledAt, { zone }).toISODate() === key);
      return <Card key={key} className="min-h-52"><CardHeader className="pb-2"><CardTitle className="text-sm">{day.setLocale("tr").toFormat("ccc dd LLL")}</CardTitle><CardDescription>{items.length} hedef</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
        {items.length ? items.map((job) => <div key={job.id} className="rounded-lg border border-border p-2">
          <div className="flex flex-wrap items-center gap-1"><PlatformBadge platform={job.platform} /><StatusBadge status={job.status} /></div>
          <Link href={`/library/${job.video.id}`} className="mt-2 block line-clamp-2 text-xs font-medium hover:underline">{job.video.title ?? "Başlıksız video"}</Link>
          <p className="mt-1 text-[11px] text-muted-foreground">{job.socialAccount.displayName} · {DateTime.fromJSDate(job.scheduledAt, { zone }).toFormat("HH:mm")}</p>
          {["SCHEDULED","AWAITING_CONSENT"].includes(job.status) ? <PublishScheduleEditor publishJobId={job.id} scheduledAt={job.scheduledAt.toISOString()} timezone={zone} /> : null}
          {job.lastError ? <p className="mt-1 text-[11px] text-danger">{job.lastError}</p> : null}
        </div>) : <p className="text-xs text-muted-foreground">Yayın planı yok.</p>}
      </CardContent></Card>;
    })}</div>
  </>;
}
