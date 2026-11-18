"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lightbulb, Wand2, Clapperboard } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import { apiFetch } from "@/lib/client";

interface Idea {
  id: string;
  topic: string;
  angle: string | null;
  category: string | null;
}

export function GenerateClient({ brandId, ideas, canGenerate }: { brandId: string; ideas: Idea[]; canGenerate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [topic, setTopic] = useState("");

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: "ok", text: await fn() });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tam otomatik üretim</CardTitle>
          <CardDescription>Sistem konu seçer, senaryo yazar, medya bulur, seslendirir, montajlar ve kalite kontrolünden geçirir.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            size="lg"
            disabled={!canGenerate || !!busy}
            onClick={() =>
              run("auto", async () => {
                const r = await apiFetch("/api/videos/generate", { method: "POST", json: { brandId } });
                return `Video kuyruğa alındı (${r.video.id}). İlerlemeyi Video Kütüphanesi'nden izleyebilirsiniz.`;
              })
            }
          >
            <Clapperboard className="h-4 w-4" />
            {busy === "auto" ? "Kuyruğa alınıyor…" : "Şimdi bir video üret"}
          </Button>
          <div className="flex gap-2">
            <Input placeholder="veya kendi konunuzu yazın (ör. Ahtapotların üç kalbi)" value={topic} onChange={(e) => setTopic(e.target.value)} />
            <Button
              variant="secondary"
              disabled={topic.trim().length < 5 || !!busy}
              onClick={() =>
                run("topic", async () => {
                  const r = await apiFetch("/api/content/scripts", { method: "POST", json: { brandId, topic } });
                  setTopic("");
                  return `Senaryo hazır: "${r.script.title}". Aşağıdan inceleyebilir, sonra videoya dönüştürebilirsiniz.`;
                })
              }
            >
              <Wand2 className="h-4 w-4" />
              {busy === "topic" ? "Yazılıyor…" : "Senaryo yaz"}
            </Button>
          </div>
          {msg ? <p role="status" className={msg.tone === "ok" ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Fikir havuzu</CardTitle>
            <CardDescription>Tekrarlar otomatik elenir. Bir fikirden senaryo + video üretin.</CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("ideas", async () => `${(await apiFetch("/api/content/ideas", { method: "POST", json: { brandId, count: 5 } })).ideas.length} yeni fikir eklendi`)}>
            <Lightbulb className="h-4 w-4" />
            {busy === "ideas" ? "Üretiliyor…" : "Fikir üret"}
          </Button>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {ideas.length === 0 ? <p className="text-sm text-muted-foreground">Kullanılmamış fikir yok.</p> : null}
          {ideas.map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{i.topic}</div>
                {i.angle ? <div className="text-xs text-muted-foreground">{i.angle}</div> : null}
                {i.category ? <Badge className="mt-1">{i.category}</Badge> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  disabled={!canGenerate || !!busy}
                  onClick={() =>
                    run(i.id, async () => {
                      const s = await apiFetch("/api/content/scripts", { method: "POST", json: { brandId, ideaId: i.id } });
                      const v = await apiFetch("/api/videos/generate", { method: "POST", json: { brandId, scriptId: s.script.id } });
                      return `"${s.script.title}" senaryosu yazıldı ve video kuyruğa alındı (${v.video.id}).`;
                    })
                  }
                >
                  {busy === i.id ? "…" : "Üret"}
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("rej" + i.id, async () => (await apiFetch("/api/content/ideas", { method: "PATCH", json: { id: i.id, status: "REJECTED" } }), "Fikir reddedildi"))}>
                  Reddet
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
