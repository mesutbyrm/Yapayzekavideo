"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui";

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)asf_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function UploadForm({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("brandId", brandId);
    fd.set("commercialUse", (form.elements.namedItem("commercialUse") as HTMLInputElement).checked ? "true" : "false");
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/media-assets", { method: "POST", body: fd, headers: { "x-csrf-token": csrf() } });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: data?.error?.message ?? "Yükleme başarısız" });
    setMsg({ ok: true, text: "Yüklendi" });
    form.reset();
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dosya yükle</CardTitle>
        <CardDescription>MP4, JPEG, PNG veya MP3 (müzik). Lisans bilgisi ve ticari kullanım onayı zorunludur.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Dosya"><Input name="file" type="file" accept="video/mp4,image/jpeg,image/png,audio/mpeg" required /></Field>
          <Field label="Lisans (zorunlu)"><Input name="license" placeholder="ör. Epidemic Sound Commercial, CC0, kendi çekimim" required minLength={3} /></Field>
          <Field label="Lisans URL"><Input name="licenseUrl" type="url" /></Field>
          <Field label="Kaynak URL"><Input name="sourceUrl" type="url" /></Field>
          <Field label="Atıf"><Input name="attribution" /></Field>
          <Field label="Etiketler (virgülle, İngilizce önerilir)"><Input name="tags" placeholder="ocean, nature, city" /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="commercialUse" required />Bu içeriğin ticari kullanım hakkına sahibim</label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Yükleniyor…" : "Yükle"}</Button>
            {msg ? <span className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
