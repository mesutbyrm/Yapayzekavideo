import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { prisma, DEFAULT_TZ } from "@asf/core";
import { Card, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { PlatformBadge, StatusBadge } from "@/components/status-badge";
import { currentBrand, requireUser } from "@/lib/auth";

export const metadata = { title: "İçerik Takvimi" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const offset = Number((await searchParams).w ?? 0) || 0;
  const start = DateTime.now().setZone(DEFAULT_TZ).startOf("week").plus({ weeks: offset });
  const end = start.plus({ days: 7 });
  const [schedules, videos, jobs] = await Promise.all([
    prisma.schedule.findMany({ where: { brandId: brand.id, isActive: true }, orderBy: { time: "asc" } }),
    prisma.video.findMany({ where: { brandId: brand.id, OR: [{ scheduleSlot: { gte: start.toJSDate(), lt: end.toJSDate() } }, { scheduleSlot: null, createdAt: { gte: start.toJSDate(), lt: end.toJSDate() } }] }, select: { id: true, title: true, status: true, scheduleSlot: true, createdAt: true } }),
    prisma.publishJob.findMany({ where: { brandId: brand.id, scheduledAt: { gte: start.toJSDate(), lt: end.toJSDate() } }, select: { id: true, platform: true, status: true, scheduledAt: true, videoId: true } }),
  ]);
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const today = DateTime.now().setZone(DEFAULT_TZ).toISODate();

  return (
    <>
      <PageHeader
        title="İçerik Takvimi"
        description={`${start.setLocale("tr").toFormat("dd LLLL")} – ${end.minus({ days: 1 }).setLocale("tr").toFormat("dd LLLL yyyy")} · Europe/Istanbul`}
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/calendar?w=${offset - 1}`}><ChevronLeft className="h-4 w-4" />Önceki</Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/calendar">Bu hafta</Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/calendar?w=${offset + 1}`}>Sonraki<ChevronRight className="h-4 w-4" /></Link>
          </>
        }
      />
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d) => {
          const iso = d.toISODate();
          const slots = schedules.filter((s) => s.weekdays.includes(d.weekday));
          const dayVideos = videos.filter((v) => DateTime.fromJSDate(v.scheduleSlot ?? v.createdAt, { zone: DEFAULT_TZ }).toISODate() === iso);
          return (
            <Card key={iso} className={`min-h-48 p-3 ${iso === today ? "ring-2 ring-primary/50" : ""}`}>
              <div className="mb-2 text-xs font-semibold">{d.setLocale("tr").toFormat("ccc dd")}</div>
              <div className="flex flex-col gap-2">
                {slots.map((s) => {
                  const v = dayVideos.find((x) => x.scheduleSlot && DateTime.fromJSDate(x.scheduleSlot, { zone: DEFAULT_TZ }).toFormat("HH:mm") === s.time);
                  const vj = v ? jobs.filter((j) => j.videoId === v.id) : [];
                  return (
                    <div key={s.id} className="rounded-lg border border-border p-2 text-xs">
                      <div className="flex items-center justify-between font-medium"><span>{s.time}</span>{v ? <StatusBadge status={v.status} /> : <span className="text-muted-foreground">planlı</span>}</div>
                      {v ? <Link href={`/library/${v.id}`} className="mt-1 line-clamp-2 block hover:underline">{v.title ?? "Üretiliyor…"}</Link> : null}
                      <div className="mt-1 flex flex-wrap gap-1">{(vj.length ? vj.map((j) => j.platform) : s.platforms).map((p) => <PlatformBadge key={p} platform={p} />)}</div>
                    </div>
                  );
                })}
                {dayVideos.filter((v) => !v.scheduleSlot).map((v) => (
                  <Link key={v.id} href={`/library/${v.id}`} className="rounded-lg border border-dashed border-border p-2 text-xs hover:bg-muted">
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Manuel</span><StatusBadge status={v.status} /></div>
                    <div className="mt-1 line-clamp-2">{v.title ?? "Üretiliyor…"}</div>
                  </Link>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
