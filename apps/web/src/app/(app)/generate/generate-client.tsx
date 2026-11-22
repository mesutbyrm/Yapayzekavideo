"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTime } from "luxon";
import { Lightbulb, Wand2, Clapperboard } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import { apiFetch } from "@/lib/client";

interface Idea { id: string; topic: string; angle: string | null; category: string | null }
export function GenerateClient({ brandId, ideas: initialIdeas, canGenerate }: { brandId: string; ideas: Idea[]; canGenerate: boolean }) {
  const router = useRouter();
  const [ideas, setIdeas] = useState(initialIdeas);
  const [selected, setSelected] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [minSeconds, setMinSeconds] = useState(60);
  const [maxSeconds, setMaxSeconds] = useState(60);
  const [language, setLanguage] = useState("tr");
  const [subtitles, setSubtitles] = useState(true);
  const [soundDesign, setSoundDesign] = useState(true);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  async function run(key: string, action: () => Promise<string>) {
    setBusy(key); setMsg(null);
    try { setMsg({ tone: "ok", text: await action() }); router.refresh(); }
    catch (e) { setMsg({ tone: "err", text: (e as Error).message }); }
    finally { setBusy(null); }
  }
  async function makeIdeas() {
    const result = await apiFetch("/api/content/ideas", { method: "POST", json: { brandId, topic: topic.trim(), count } });
    setIdeas(result.ideas);
    setSelected([]);
    return result.ideas.length + " fikir hazır. Önce inceleyip düzenleyin ve üretmek istediklerinizi seçin.";
  }
  function toggle(id: string) { setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]); }
  async function reject(id: string) {
    await apiFetch("/api/content/ideas", { method: "PATCH", json: { id, status: "REJECTED" } });
    setIdeas((old) => old.filter((item) => item.id !== id));
    setSelected((old) => old.filter((x) => x !== id));
  }
  async function produceSelected() {
    const chosen = ideas.filter((item) => selected.includes(item.id));
    if (!chosen.length) throw new Error("Önce en az bir fikir seçin.");
    const queued: string[] = [];
    for (const idea of chosen) {
      await apiFetch("/api/content/ideas", { method: "PATCH", json: { id: idea.id, topic: idea.topic } });
      const script = await apiFetch("/api/content/scripts", { method: "POST", json: { brandId, ideaId: idea.id, minSeconds, maxSeconds, language, subtitles } });
      const video = await apiFetch("/api/videos/generate", { method: "POST", json: { brandId, scriptId: script.script.id, productionOptions: { minSeconds, maxSeconds, language, subtitles, soundDesign }, publishOptions: { platforms, scheduledAtByPlatform: Object.fromEntries(platforms.filter((platform) => scheduleTimes[platform]).map((platform) => [platform, DateTime.fromISO(scheduleTimes[platform], { zone: "Europe/Istanbul" }).toUTC().toISO() ?? ""])) } } });
      queued.push(video.video.id);
    }
    setSelected([]);
    window.dispatchEvent(new Event("asf:video-queued"));
    return chosen.length + " video üretimi kuyruğa alındı. İlerlemeyi sayfanın üstündeki \"Üretimdeki videolar\" kutusundan yüzde olarak izleyebilirsiniz.";
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Önce fikir üret</CardTitle><CardDescription>Konuyu ve fikir sayısını belirleyin. Taslaklar düzenlenebilir; burada video başlamaz.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input placeholder="Örn. Türkiye’de gezilecek yerler" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} />
          <label className="text-sm">Kaç fikir? (1–30)<Input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} /></label>
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <label className="text-sm">Süre aralığı (saniye)<div className="mt-1 flex gap-2"><input aria-label="En kısa süre" type="number" min={15} max={300} value={minSeconds} onChange={(e) => setMinSeconds(Math.min(maxSeconds, Math.max(15, Number(e.target.value) || 60)))} className="w-full rounded-md border bg-background px-2 py-1.5"/><input aria-label="En uzun süre" type="number" min={15} max={300} value={maxSeconds} onChange={(e) => setMaxSeconds(Math.max(minSeconds, Math.min(300, Number(e.target.value) || 60)))} className="w-full rounded-md border bg-background px-2 py-1.5"/></div></label>
            <label className="text-sm">Video dili<select aria-label="Video dili" value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-2"><option value="tr">Türkçe</option><option value="en">English</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="es">Español</option><option value="ar">العربية</option></select></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)}/>Altyazı ekle</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soundDesign} onChange={(e) => setSoundDesign(e.target.checked)}/>Kodla üretilen atmosfer ve vuruş sesleri</label>
            <fieldset className="text-sm"><legend>Paylaşılacak mecralar</legend><div className="mt-1 flex flex-wrap gap-3">{[["INSTAGRAM","Instagram Reels"],["TIKTOK","TikTok"],["YOUTUBE","YouTube Shorts"],["FACEBOOK","Facebook Reels"]].map(([id,label]) => <label key={id} className="flex items-center gap-1"><input type="checkbox" checked={platforms.includes(id)} onChange={() => setPlatforms((v) => v.includes(id) ? v.filter((x) => x !== id) : [...v,id])}/>{label}</label>)}</div></fieldset>
            <div className="space-y-2 text-sm"><p>Platform başına yayın zamanı (Türkiye saati). Boş bırakırsanız üretim bitince kuyruğa alınır.</p>{platforms.map((platform) => <label key={platform} className="block">{({ INSTAGRAM: "Instagram Reels", TIKTOK: "TikTok", YOUTUBE: "YouTube Shorts", FACEBOOK: "Facebook Reels" } as Record<string, string>)[platform]}<input aria-label={`${platform} yayın zamanı (Türkiye saati)`} type="datetime-local" value={scheduleTimes[platform] ?? ""} onChange={(e) => setScheduleTimes((times) => ({ ...times, [platform]: e.target.value }))} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5"/></label>)}</div>
          </div>
          <Button disabled={!canGenerate || !!busy} onClick={() => run("ideas", makeIdeas)}><Lightbulb className="h-4 w-4" />{busy === "ideas" ? "Fikirler hazırlanıyor…" : "Fikirleri göster"}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Seçilen fikirleri üret</CardTitle><CardDescription>Seçtiğiniz fikirler için senaryo hazırlanır ve video kuyruğa alınır.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{selected.length} fikir seçildi</p>
          <Button size="lg" disabled={!canGenerate || !selected.length || !!busy} onClick={() => run("produce", produceSelected)}><Clapperboard className="h-4 w-4" />{busy === "produce" ? "Seçilenler kuyruğa alınıyor…" : "Seçilen videoları üret"}</Button>
          {msg ? <p role="status" className={msg.tone === "ok" ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p> : null}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Fikir havuzu</CardTitle><CardDescription>Fikir metinlerini düzenleyin, istediklerinizi seçin; istemediklerinizi kaldırın.</CardDescription></CardHeader>
        <CardContent className="flex max-h-[38rem] flex-col gap-3 overflow-y-auto">
          {ideas.length === 0 ? <p className="text-sm text-muted-foreground">Henüz fikir yok. Bir konu ve sayı seçip “Fikirleri göster” düğmesine basın.</p> : null}
          {ideas.map((idea) => <div key={idea.id} className="flex items-start gap-3 rounded-lg border p-3">
            <input aria-label="Bu fikri seç" type="checkbox" checked={selected.includes(idea.id)} onChange={() => toggle(idea.id)} className="mt-3 h-4 w-4" />
            <div className="min-w-0 flex-1 space-y-2">
              <Input aria-label="Fikir başlığı" value={idea.topic} maxLength={300} onChange={(e) => setIdeas((old) => old.map((x) => x.id === idea.id ? { ...x, topic: e.target.value } : x))} />
              {idea.angle ? <p className="text-sm text-muted-foreground">{idea.angle}</p> : null}
              {idea.category ? <Badge className="mt-1">{idea.category}</Badge> : null}
            </div>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("remove-" + idea.id, async () => { await reject(idea.id); return "Fikir kaldırıldı."; })}>Kaldır</Button>
          </div>)}
        </CardContent>
      </Card>
    </div>
  );
}

