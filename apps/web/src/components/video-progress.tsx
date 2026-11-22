"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { apiFetch } from "@/lib/client";

interface ActiveVideo {
  id: string;
  title: string | null;
  status: string;
  stageLabel: string;
  detail: string | null;
  percent: number;
  active: boolean;
  retrying: boolean;
  attempt: number | null;
  maxAttempts: number;
  error: string | null;
  startedAt: string | null;
  remainingSec: number | null;
  createdAt: string;
}

const STEPS = [
  ["SCRIPTING", "Senaryo"],
  ["FETCHING_MEDIA", "Görsel"],
  ["VOICING", "Ses"],
  ["RENDERING", "Montaj"],
  ["QUALITY_CHECK", "Kontrol"],
] as const;

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sn`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m} dk ${s} sn` : `${m} dk`;
}

/**
 * Üretimdeki videoların canlı ilerlemesi. Aktif video varken 3 sn'de bir, yokken 15 sn'de bir yenilenir.
 * Bir video bittiğinde sayfa verisi de yenilenir (kütüphane listesi vb. güncellensin).
 */
export function VideoProgressPanel({ brandId, title = "Üretimdeki videolar", hideWhenEmpty = true }: { brandId?: string; title?: string; hideWhenEmpty?: boolean }) {
  const router = useRouter();
  const [videos, setVideos] = useState<ActiveVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const activeIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const data = await apiFetch<{ videos: ActiveVideo[] }>(`/api/videos/active${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""}`);
        if (stopped) return;
        const nowActive = new Set(data.videos.filter((v) => v.active).map((v) => v.id));
        const finished = [...activeIds.current].some((id) => !nowActive.has(id));
        activeIds.current = nowActive;
        setVideos(data.videos);
        setError(null);
        if (finished) router.refresh();
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        if (!stopped) {
          const delay = document.hidden ? 20_000 : activeIds.current.size ? 3_000 : 15_000;
          timer = setTimeout(load, delay);
        }
      }
    }
    load();
    // Yeni video kuyruğa alınınca beklemeden yenile
    const onQueued = () => { if (timer) clearTimeout(timer); load(); };
    window.addEventListener("asf:video-queued", onQueued);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { stopped = true; if (timer) clearTimeout(timer); clearInterval(tick); window.removeEventListener("asf:video-queued", onQueued); };
  }, [brandId, router]);

  if (videos === null && !error) return null;
  if (hideWhenEmpty && !error && videos && videos.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>İlerleme otomatik güncellenir. Kalan süre tahminidir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <p className="text-sm text-danger">İlerleme alınamadı: {error}</p> : null}
        {videos && videos.length === 0 ? <p className="text-sm text-muted-foreground">Şu an üretimde video yok.</p> : null}
        {videos?.map((v) => <ProgressRow key={v.id} v={v} now={now} />)}
      </CardContent>
    </Card>
  );
}

function ProgressRow({ v, now }: { v: ActiveVideo; now: number }) {
  const failed = v.status === "FAILED" || v.status === "QC_FAILED";
  const done = !v.active && !failed;
  const elapsed = v.startedAt && v.active ? (now - Date.parse(v.startedAt)) / 1000 : null;
  const barColor = failed ? "bg-danger" : done ? "bg-success" : v.retrying ? "bg-warning" : "bg-primary";
  const stepIndex = STEPS.findIndex(([s]) => s === v.status);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/library/${v.id}`} className="block truncate text-sm font-medium hover:underline">{v.title ?? "Başlık henüz belirlenmedi"}</Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {failed ? <XCircle className="h-3.5 w-3.5 text-danger" /> : done ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : v.retrying ? <RotateCcw className="h-3.5 w-3.5 text-warning" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
            <span>{v.stageLabel}</span>
            {v.detail ? <span>· {v.detail}</span> : null}
            {v.attempt && v.maxAttempts > 1 && (v.active || failed) ? <span>· Deneme {v.attempt}/{v.maxAttempts}</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums">%{v.percent}</div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {v.active && v.remainingSec !== null ? `~${fmtDuration(v.remainingSec)} kaldı` : done ? "Tamamlandı" : failed ? "Durdu" : v.retrying ? "Bekliyor" : ""}
          </div>
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.percent} aria-label={`${v.title ?? "Video"} ilerlemesi`}>
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${barColor}`} style={{ width: `${Math.max(2, v.percent)}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex gap-2">
          {STEPS.map(([s, label], i) => (
            <span key={s} className={i < stepIndex || done ? "text-success" : i === stepIndex ? "font-medium text-foreground" : ""}>{label}</span>
          ))}
        </div>
        {elapsed !== null ? <span className="tabular-nums">Geçen: {fmtDuration(elapsed)}</span> : null}
      </div>
      {v.error ? <p className="mt-1.5 text-xs text-danger">{v.error}</p> : null}
    </div>
  );
}
