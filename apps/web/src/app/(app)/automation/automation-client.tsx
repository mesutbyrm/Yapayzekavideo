"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { apiFetch } from "@/lib/client";

const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as const;
const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

interface Sched {
  time: string;
  weekdays: number[];
  platforms: string[];
  leadMinutes: number;
  isActive: boolean;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-4.5" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function AutomationClient({ brand, schedules: initial, settings, isAdmin, limits }: { brand: any; schedules: Sched[]; settings: Record<string, any>; isAdmin: boolean; limits: any }) {
  const router = useRouter();
  const [b, setB] = useState(brand);
  const [schedules, setSchedules] = useState<Sched[]>(initial);
  const [g, setG] = useState(settings);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(fn: () => Promise<unknown>, okText: string) {
    setMsg(null);
    setErr(null);
    try {
      await fn();
      setMsg(okText);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const upd = (i: number, patch: Partial<Sched>) => setSchedules((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Marka otomasyonu</CardTitle>
          <CardDescription>Bugün {limits.brandToday}/{limits.brandDailyLimit} · Bu ay {limits.brandMonth}/{limits.brandMonthlyLimit}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Toggle label="Otomatik video üretimi" checked={b.autoGenerate} onChange={(v) => setB({ ...b, autoGenerate: v })} />
          <Toggle label="Otomatik yayınlama" checked={b.autoPublish} onChange={(v) => setB({ ...b, autoPublish: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Günlük video hedefi"><Input type="number" min={0} max={50} value={b.dailyVideoTarget} onChange={(e) => setB({ ...b, dailyVideoTarget: Number(e.target.value) })} /></Field>
            <Field label="Aylık video hedefi"><Input type="number" min={0} max={1500} value={b.monthlyVideoTarget} onChange={(e) => setB({ ...b, monthlyVideoTarget: Number(e.target.value) })} /></Field>
            <Field label="Min. süre (sn)"><Input type="number" min={5} max={170} value={b.minDurationSec} onChange={(e) => setB({ ...b, minDurationSec: Number(e.target.value) })} /></Field>
            <Field label="Maks. süre (sn)"><Input type="number" min={6} max={180} value={b.maxDurationSec} onChange={(e) => setB({ ...b, maxDurationSec: Number(e.target.value) })} /></Field>
          </div>
          <Button onClick={() => save(() => apiFetch(`/api/brands/${b.id}`, { method: "PATCH", json: { autoGenerate: b.autoGenerate, autoPublish: b.autoPublish, dailyVideoTarget: b.dailyVideoTarget, monthlyVideoTarget: b.monthlyVideoTarget, minDurationSec: b.minDurationSec, maxDurationSec: b.maxDurationSec } }), "Marka ayarları kaydedildi")}>Kaydet</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Yayın saatleri</CardTitle>
            <CardDescription>Saat dilimi: Europe/Istanbul</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSchedules((s) => [...s, { time: "12:00", weekdays: [1, 2, 3, 4, 5, 6, 7], platforms: [...PLATFORMS], leadMinutes: 120, isActive: true }])}>
            <Plus className="h-4 w-4" />Saat ekle
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {schedules.map((s, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input type="time" className="w-28" value={s.time} onChange={(e) => upd(i, { time: e.target.value })} />
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Üretim
                  <Input type="number" className="w-20" min={15} max={720} value={s.leadMinutes} onChange={(e) => upd(i, { leadMinutes: Number(e.target.value) })} />
                  dk önce
                </label>
                <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={s.isActive} onChange={(e) => upd(i, { isActive: e.target.checked })} />Aktif</label>
                <Button size="icon" variant="ghost" aria-label="Sil" onClick={() => setSchedules((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d, di) => {
                  const on = s.weekdays.includes(di + 1);
                  return <button key={d} type="button" onClick={() => upd(i, { weekdays: on ? s.weekdays.filter((w) => w !== di + 1) : [...s.weekdays, di + 1].sort() })} className={`rounded-md border px-2 py-0.5 text-xs ${on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>{d}</button>;
                })}
              </div>
              <div className="flex flex-wrap gap-1">
                {PLATFORMS.map((p) => {
                  const on = s.platforms.includes(p);
                  return <button key={p} type="button" onClick={() => upd(i, { platforms: on ? s.platforms.filter((x) => x !== p) : [...s.platforms, p] })} className={`rounded-md border px-2 py-0.5 text-xs ${on ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground"}`}>{p}</button>;
                })}
              </div>
            </div>
          ))}
          <Button onClick={() => save(() => apiFetch(`/api/brands/${b.id}/schedules`, { method: "PUT", json: { schedules } }), "Yayın saatleri kaydedildi")}>Saatleri kaydet</Button>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sistem geneli limitler (yönetici)</CardTitle>
            <CardDescription>Bütün markalar için üst sınırlar. Bütçe aşılırsa ücretli üretim durur; yayınlama devam eder.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Toggle label="Üretim açık" checked={!!g["generation.enabled"]} onChange={(v) => setG({ ...g, "generation.enabled": v })} />
            <Toggle label="Yayınlama açık" checked={!!g["publishing.enabled"]} onChange={(v) => setG({ ...g, "publishing.enabled": v })} />
            <Field label="Günlük üretim limiti"><Input type="number" value={g["generation.globalDailyLimit"]} onChange={(e) => setG({ ...g, "generation.globalDailyLimit": Number(e.target.value) })} /></Field>
            <Field label="Aylık üretim limiti"><Input type="number" value={g["generation.globalMonthlyLimit"]} onChange={(e) => setG({ ...g, "generation.globalMonthlyLimit": Number(e.target.value) })} /></Field>
            <Field label="Aylık bütçe hedefi (USD)"><Input type="number" step="0.01" value={g["budget.monthlyTargetUsd"]} onChange={(e) => setG({ ...g, "budget.monthlyTargetUsd": Number(e.target.value) })} /></Field>
            <Field label="Aylık bütçe üst sınırı (USD)"><Input type="number" step="0.01" value={g["budget.monthlyMaxUsd"]} onChange={(e) => setG({ ...g, "budget.monthlyMaxUsd": Number(e.target.value) })} /></Field>
            <Field label="Uyarı eşiği (%)"><Input type="number" value={g["budget.warnAtPercent"]} onChange={(e) => setG({ ...g, "budget.warnAtPercent": Number(e.target.value) })} /></Field>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() =>
                  save(
                    () =>
                      apiFetch("/api/settings", {
                        method: "PATCH",
                        json: Object.fromEntries(["generation.enabled", "publishing.enabled", "generation.globalDailyLimit", "generation.globalMonthlyLimit", "budget.monthlyTargetUsd", "budget.monthlyMaxUsd", "budget.warnAtPercent"].map((k) => [k, g[k]])),
                      }),
                    "Sistem ayarları kaydedildi",
                  )
                }
              >
                Kaydet
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {msg ? <p role="status" className="text-sm text-success lg:col-span-2">{msg}</p> : null}
      {err ? <p role="alert" className="text-sm text-danger lg:col-span-2">{err}</p> : null}
    </div>
  );
}
