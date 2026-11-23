"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { apiFetch } from "@/lib/client";

type Form = {
  id?: string;
  name: string;
  description: string;
  website: string;
  language: string;
  targetAudience: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  voiceName: string;
  voiceGender: "MALE" | "FEMALE";
  speakingRate: number;
  voicePitch: number;
  videoTemplate: string;
  dailyVideoTarget: number;
  monthlyVideoTarget: number;
  publishTimes: string;
  hashtags: string;
  contentRules: string;
  monthlyBudgetUsd: number;
  maxBudgetUsd: number;
  musicEnabled: boolean;
  musicVolume: number;
  isActive: boolean;
  hasLogo?: boolean;
};

const EMPTY: Form = {
  name: "",
  description: "",
  website: "",
  language: "tr-TR",
  targetAudience: "",
  primaryColor: "#7C3AED",
  secondaryColor: "#0EA5E9",
  accentColor: "#F59E0B",
  fontFamily: "DejaVu Sans",
  voiceName: "tr-TR-Wavenet-A",
  voiceGender: "FEMALE",
  speakingRate: 1.05,
  voicePitch: 0,
  videoTemplate: "modern",
  dailyVideoTarget: 3,
  monthlyVideoTarget: 90,
  publishTimes: "10:00, 15:00, 20:00",
  hashtags: "",
  contentRules: "",
  monthlyBudgetUsd: 25,
  maxBudgetUsd: 50,
  musicEnabled: true,
  musicVolume: 0.12,
  isActive: true,
};

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)asf_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function BrandForm({ initial, voices }: { initial: Form | null; voices: { name: string; gender: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      name: f.name,
      description: f.description || null,
      website: f.website || "",
      language: f.language,
      targetAudience: f.targetAudience || null,
      primaryColor: f.primaryColor,
      secondaryColor: f.secondaryColor,
      accentColor: f.accentColor,
      fontFamily: f.fontFamily,
      voiceName: f.voiceName,
      voiceGender: f.voiceGender,
      speakingRate: Number(f.speakingRate),
      voicePitch: Number(f.voicePitch),
      videoTemplate: f.videoTemplate,
      dailyVideoTarget: Number(f.dailyVideoTarget),
      monthlyVideoTarget: Number(f.monthlyVideoTarget),
      publishTimes: f.publishTimes.split(/[,\s]+/).filter(Boolean),
      hashtags: f.hashtags.split(/[\s,]+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)),
      contentRules: f.contentRules || null,
      monthlyBudgetUsd: Number(f.monthlyBudgetUsd),
      maxBudgetUsd: Number(f.maxBudgetUsd),
      musicEnabled: f.musicEnabled,
      musicVolume: Number(f.musicVolume),
      isActive: f.isActive,
    };
    try {
      if (f.id) {
        await apiFetch(`/api/brands/${f.id}`, { method: "PATCH", json: payload });
        setMsg({ ok: true, text: "Kaydedildi" });
      } else {
        const r = await apiFetch("/api/brands", { method: "POST", json: payload });
        await apiFetch("/api/brands/select", { method: "POST", json: { brandId: r.brand.id } });
        router.push("/brands");
      }
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!f.id) return;
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch(`/api/brands/${f.id}/logo`, { method: "POST", body: fd, headers: { "x-csrf-token": csrf() } });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: "Logo yüklendi" } : { ok: false, text: data?.error?.message ?? "Logo yüklenemedi" });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Field label="Marka adı"><Input required minLength={2} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <Field label="Website"><Input type="url" value={f.website} onChange={(e) => set("website", e.target.value)} /></Field>
      <Field label="Dil"><Select value={f.language} onChange={(e) => set("language", e.target.value)}><option value="tr-TR">Türkçe</option><option value="en-US">English (yakında)</option></Select></Field>
      <Field label="Açıklama" className="md:col-span-2 lg:col-span-3"><Textarea value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Hedef kitle" className="md:col-span-2 lg:col-span-3"><Input value={f.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} placeholder="ör. 18-34 yaş, bilim ve teknolojiye meraklı" /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Ana renk"><Input type="color" className="h-9 p-1" value={f.primaryColor} onChange={(e) => set("primaryColor", e.target.value.toUpperCase())} /></Field>
        <Field label="İkincil"><Input type="color" className="h-9 p-1" value={f.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value.toUpperCase())} /></Field>
        <Field label="Vurgu"><Input type="color" className="h-9 p-1" value={f.accentColor} onChange={(e) => set("accentColor", e.target.value.toUpperCase())} /></Field>
      </div>
      <Field label="Font (altyazı)" hint="Sunucuda yüklü olmalı (ör. DejaVu Sans, Noto Sans)"><Input value={f.fontFamily} onChange={(e) => set("fontFamily", e.target.value)} /></Field>
      <Field label="Video şablonu"><Select value={f.videoTemplate} onChange={(e) => set("videoTemplate", e.target.value)}><option value="modern">Modern (geçişli, başlık kutulu)</option><option value="shorts3d">Shorts 3D (seri hapı, sarı vurgulu dev altyazı, 3D karakter)</option></Select></Field>
      <Field label="Ses"><Select value={f.voiceName} onChange={(e) => { const v = voices.find((x) => x.name === e.target.value); set("voiceName", e.target.value); if (v) set("voiceGender", v.gender as any); }}>{voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.gender === "MALE" ? "Erkek" : "Kadın"})</option>)}</Select></Field>
      <Field label={`Konuşma hızı: ${f.speakingRate}`}><input type="range" min={0.8} max={1.3} step={0.01} value={f.speakingRate} onChange={(e) => set("speakingRate", Number(e.target.value))} /></Field>
      <Field label={`Ses tonu: ${f.voicePitch}`}><input type="range" min={-6} max={6} step={0.5} value={f.voicePitch} onChange={(e) => set("voicePitch", Number(e.target.value))} /></Field>
      <Field label="Günlük video hedefi"><Input type="number" min={0} max={50} value={f.dailyVideoTarget} onChange={(e) => set("dailyVideoTarget", Number(e.target.value))} /></Field>
      <Field label="Aylık video hedefi"><Input type="number" min={0} max={1500} value={f.monthlyVideoTarget} onChange={(e) => set("monthlyVideoTarget", Number(e.target.value))} /></Field>
      <Field label="Yayın saatleri (Europe/Istanbul)"><Input value={f.publishTimes} onChange={(e) => set("publishTimes", e.target.value)} placeholder="10:00, 15:00, 20:00" /></Field>
      <Field label="Hashtag tercihleri"><Input value={f.hashtags} onChange={(e) => set("hashtags", e.target.value)} placeholder="#bilgi #keşfet" /></Field>
      <Field label="Aylık bütçe hedefi (USD)"><Input type="number" step="0.01" min={0} value={f.monthlyBudgetUsd} onChange={(e) => set("monthlyBudgetUsd", Number(e.target.value))} /></Field>
      <Field label="Aylık bütçe üst sınırı (USD)"><Input type="number" step="0.01" min={0} value={f.maxBudgetUsd} onChange={(e) => set("maxBudgetUsd", Number(e.target.value))} /></Field>
      <Field label="İçerik üretim kuralları" hint='Her satır bir kural. "yasak: kelime" satırları içerikte geçerse senaryo reddedilir.' className="md:col-span-2 lg:col-span-3">
        <Textarea rows={4} value={f.contentRules} onChange={(e) => set("contentRules", e.target.value)} placeholder={"Samimi ama bilgilendirici bir dil kullan.\nyasak: kumar"} />
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.musicEnabled} onChange={(e) => set("musicEnabled", e.target.checked)} />Arka plan müziği (yalnızca lisanslı kütüphane)</label>
      <Field label={`Müzik seviyesi: ${Math.round(f.musicVolume * 100)}%`}><input type="range" min={0} max={0.5} step={0.01} value={f.musicVolume} onChange={(e) => set("musicVolume", Number(e.target.value))} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} />Marka aktif</label>
      {f.id ? (
        <Field label={`Logo ${f.hasLogo ? "(yüklü)" : ""}`} hint="PNG (şeffaf) önerilir, en fazla 5 MB"><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></Field>
      ) : null}
      <div className="flex items-center gap-3 md:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={busy}>{busy ? "Kaydediliyor…" : f.id ? "Kaydet" : "Marka oluştur"}</Button>
        {msg ? <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
