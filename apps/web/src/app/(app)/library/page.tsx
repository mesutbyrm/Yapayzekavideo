import Link from "next/link";
import { prisma } from "@asf/core";
import { Card, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtDate, fmtUsd } from "@/lib/utils";
import { STATUS_TR } from "@/lib/i18n";

export const metadata = { title: "Video Kütüphanesi" };

const FILTERS = ["", "READY", "PUBLISHED", "PARTIALLY_PUBLISHED", "PUBLISHING", "QC_FAILED", "FAILED"];

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = { brandId: brand.id, status: sp.status ? (sp.status as any) : { not: "CANCELLED" as const } };
  const [videos, total] = await Promise.all([
    prisma.video.findMany({ where, orderBy: { createdAt: "desc" }, take: 24, skip: (page - 1) * 24, include: { _count: { select: { publishResults: { where: { success: true } } } } } }),
    prisma.video.count({ where }),
  ]);

  return (
    <>
      <PageHeader title="Video Kütüphanesi" description={`${total} video`} actions={<Link href="/library/media" className={buttonVariants({ variant: "outline", size: "sm" })}>Medya kütüphanesi ve müzik</Link>} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f} href={f ? `/library?status=${f}` : "/library"} className={`rounded-full border px-3 py-1 text-xs ${(sp.status ?? "") === f ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
            {f ? STATUS_TR[f] : "Tümü"}
          </Link>
        ))}
      </div>
      {videos.length === 0 ? (
        <EmptyState title="Video yok" description="Video Üret sayfasından ilk videonuzu oluşturun." action={<Link className={buttonVariants()} href="/generate">Video üret</Link>} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {videos.map((v) => (
            <Link key={v.id} href={`/library/${v.id}`}>
              <Card className="overflow-hidden transition hover:ring-2 hover:ring-primary/40">
                <div className="relative aspect-[9/16] bg-muted">
                  {v.thumbnailKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/videos/${v.id}/file?kind=thumb`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-muted-foreground">{STATUS_TR[v.status]}</div>
                  )}
                  <div className="absolute left-2 top-2"><StatusBadge status={v.status} /></div>
                </div>
                <div className="p-2.5">
                  <div className="line-clamp-2 text-xs font-medium">{v.title ?? "Başlıksız"}</div>
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>{fmtDate(v.createdAt)}</span>
                    <span>{v.durationSec ? `${v.durationSec.toFixed(1)} sn` : ""} · {fmtUsd(Number(v.costUsd), 3)}</span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {total > 24 ? (
        <div className="mt-4 flex justify-center gap-2">
          {page > 1 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/library?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), page: String(page - 1) })}`}>Önceki</Link> : null}
          {page * 24 < total ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/library?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), page: String(page + 1) })}`}>Sonraki</Link> : null}
        </div>
      ) : null}
    </>
  );
}
