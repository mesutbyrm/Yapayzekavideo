"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

type Provider = "anthropic" | "openai";
type Status = { configured: Record<Provider, boolean>; models: Partial<Record<Provider, string>>; activeProvider?: Provider };
const defaults: Status = { configured: { anthropic: false, openai: false }, models: {} };

export function AIProviderSettings() {
  const [status, setStatus] = useState<Status>(defaults);
  const [activeProvider, setActiveProvider] = useState<Provider>("openai");
  const [keys, setKeys] = useState<Record<Provider, string>>({ anthropic: "", openai: "" });
  const [models, setModels] = useState<Record<Provider, string>>({ anthropic: "", openai: "" });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { apiFetch("/api/settings/ai-keys").then((r) => { setStatus(r); setActiveProvider(r.activeProvider || "openai"); setModels({ anthropic: r.models?.anthropic || "", openai: r.models?.openai || "" }); }).catch(() => setMessage("Ayarlar yüklenemedi.")); }, []);
  async function save(provider: Provider, remove = false) {
    setBusy(provider); setMessage("");
    try {
      const r = await apiFetch("/api/settings/ai-keys", { method: "POST", json: { provider, activeProvider, apiKey: keys[provider] || undefined, model: models[provider] || undefined, remove } });
      setStatus(r); setKeys((v) => ({ ...v, [provider]: "" })); setMessage(remove ? "Anahtar kaldırıldı." : "Model bağlantısı kaydedildi.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Kaydetme başarısız."); }
    finally { setBusy(null); }
  }
  const providers: { id: Provider; name: string; hint: string }[] = [
    { id: "anthropic", name: "Claude (Anthropic)", hint: "Örnek: claude-sonnet-4-5" },
    { id: "openai", name: "OpenAI / ChatGPT", hint: "Örnek: gpt-4o-mini" },
  ];
  return <section className="mb-5 rounded-xl border p-5"><h2 className="text-lg font-semibold">Yapay zekâ modelleri</h2><p className="mb-4 mt-1 text-sm text-muted-foreground">API anahtarları şifrelenerek saklanır; kaydedilen anahtar tekrar ekranda gösterilmez. Model adı boşsa sunucu varsayılanı kullanılır.</p><label className="mb-4 block text-sm">Etkin metin üreticisi<select aria-label="Etkin metin üreticisi" value={activeProvider} onChange={(e) => { const next = e.target.value as Provider; setActiveProvider(next); apiFetch("/api/settings/ai-keys", { method: "POST", json: { provider: next, activeProvider: next } }).then(setStatus).catch(() => setMessage("Model seçimi kaydedilemedi.")); }} className="mt-1 w-full rounded-md border bg-background px-3 py-2"><option value="openai">OpenAI / ChatGPT</option><option value="anthropic">Claude (Anthropic)</option></select></label><div className="grid gap-4 md:grid-cols-2">{providers.map((p) => <div key={p.id} className="space-y-3 rounded-lg border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">{p.name}</h3><span className="text-xs">{status.configured[p.id] ? "Anahtar kayıtlı" : "Anahtar eklenmedi"}</span></div><label className="block text-sm">Model adı<input className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={models[p.id]} placeholder={p.hint} onChange={(e) => setModels((v) => ({ ...v, [p.id]: e.target.value }))} /></label><label className="block text-sm">API anahtarı<input type="password" autoComplete="new-password" className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={keys[p.id]} placeholder={status.configured[p.id] ? "Değiştirmek için yeni anahtar girin" : "API anahtarını girin"} onChange={(e) => setKeys((v) => ({ ...v, [p.id]: e.target.value }))} /></label><div className="flex gap-2"><button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy !== null || (!keys[p.id] && !models[p.id])} onClick={() => save(p.id)}>{busy === p.id ? "Kaydediliyor…" : "Kaydet"}</button>{status.configured[p.id] && <button className="rounded-md border px-3 py-2 text-sm" disabled={busy !== null} onClick={() => save(p.id, true)}>Anahtarı kaldır</button>}</div></div>)}</div>{message && <p role="status" className="mt-3 text-sm">{message}</p>}<p className="mt-4 text-xs text-muted-foreground">Google Cloud Text-to-Speech kimlik bilgileri sunucudaki salt okunur güvenli dosyadan alınır; bu alana API anahtarı girilmez.</p></section>;
}
