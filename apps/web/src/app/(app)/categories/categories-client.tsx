"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { apiFetch } from "@/lib/client";

interface Cat {
  id?: string;
  name: string;
  description: string;
  keywords: string;
  weight: number;
  isActive: boolean;
  ideas?: number;
}

function Row({ c, brandId, onDone }: { c: Cat; brandId: string; onDone: () => void }) {
  const [f, setF] = useState(c);
  const [err, setErr] = useState<string | null>(null);
  const payload = () => ({ name: f.name, description: f.description || null, keywords: f.keywords.split(",").map((s) => s.trim()).filter(Boolean), weight: Number(f.weight), isActive: f.isActive });
  async function save() {
    setErr(null);
    try {
      if (f.id) await apiFetch(`/api/categories/${f.id}`, { method: "PATCH", json: payload() });
      else {
        await apiFetch("/api/categories", { method: "POST", json: { ...payload(), brandId } });
        setF({ name: "", description: "", keywords: "", weight: 1, isActive: true });
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function remove() {
    if (!f.id || !confirm("Kategori silinsin mi?")) return;
    await apiFetch(`/api/categories/${f.id}`, { method: "DELETE" }).catch((e) => setErr(e.message));
    onDone();
  }
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1.5fr_1.5fr_90px_auto]">
      <Field label="Ad"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Açıklama"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Anahtar kelimeler (virgülle)"><Input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></Field>
      <Field label="Ağırlık"><Input type="number" min={0} max={10} value={f.weight} onChange={(e) => setF({ ...f, weight: Number(e.target.value) })} /></Field>
      <div className="flex items-end gap-2">
        <label className="flex h-9 items-center gap-1 text-xs"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Aktif</label>
        <Button size="sm" onClick={save} disabled={f.name.trim().length < 2}>{f.id ? "Kaydet" : "Ekle"}</Button>
        {f.id ? <Button size="sm" variant="ghost" onClick={remove}>Sil</Button> : null}
      </div>
      {f.id ? <div className="text-[11px] text-muted-foreground md:col-span-5">{c.ideas} fikir</div> : null}
      {err ? <div className="text-xs text-danger md:col-span-5">{err}</div> : null}
    </div>
  );
}

export function CategoriesClient({ brandId, categories }: { brandId: string; categories: Cat[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Yeni kategori</CardTitle></CardHeader>
        <CardContent><Row c={{ name: "", description: "", keywords: "", weight: 1, isActive: true }} brandId={brandId} onDone={() => router.refresh()} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Kategoriler ({categories.length})</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {categories.map((c) => <Row key={c.id} c={c} brandId={brandId} onDone={() => router.refresh()} />)}
        </CardContent>
      </Card>
    </div>
  );
}
