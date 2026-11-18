import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma, assertBrandAccess } from "@asf/core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Table, Td, Th } from "@/components/ui";
import { PlatformBadge, StatusBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtUsd } from "@/lib/utils";

export default async function VideoDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const v = await prisma.video.findUnique({
    where: { id },
    include: {
      script: true,
      publishJobs: { include: { socialAccount: { select: { displayName: true } } }, orderBy: { platform: "asc" } },
      publishResults: { orderBy: { createdAt: "desc" }, take: 30 },
      usageLogs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!v) notFound();
  try {
    await assertBrandAccess(user, v.brandId);
  } catch {
    notFound();
  }
  const qc = v.qcReport as any;
  const manifest = v.mediaManifest as any;
  const canPublish = v.qcPassed && ["READY", "PARTIALLY_PUBLISHED", "PUBLISHING", "PUBLISHED"].includes(v.status);

  return (
    <>
      <PageHeader
        title={v.title ?? "Video"}
        description={`Oluşturulma: ${fmtDate(v.createdAt)} · ${v.trigger === "auto" ? "Otomatik" : "Manuel"}${v.scheduleSlot ? ` · Yayın saati ${fmtDate(v.scheduleSlot)}` : ""}`}
        actions={
          <>
            <StatusBadge status={v.status} />
            {v.storageKey ? <ActionButton url="/api/videos/quality-check" body={{ videoId: v.id }} variant="outline">QC'yi yeniden çalıştır</ActionButton> : null}
            {v.scriptId && ["QC_FAILED", "FAILED"].includes(v.status) ? <ActionButton url="/api/videos/render" body={{ videoId: v.id }} variant="outline">Yeniden render et</ActionButton> : null}
            {canPublish ? <ActionButton url="/api/publishing/queue" body={{ videoId: v.id }}>Yayın kuyruğuna ekle</ActionButton> : null}
            <ActionButton url={`/api/videos/${v.id}`} method="DELETE" variant="danger" confirm="Video silinsin mi? Bekleyen yayın işleri iptal edilir.">Sil</ActionButton>
          </>
        }
      />
      {v.errorMessage ? <Card className="mb-4 border-danger/40 p-4 text-sm text-danger">{v.errorMessage}</Card> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card className="overflow-hidden">
          {v.storageKey ? (
            <video controls preload="metadata" poster={v.thumbnailKey ? `/api/videos/${v.id}/file?kind=thumb` : undefined} className="aspect-[9/16] w-full bg-black" src={`/api/videos/${v.id}/file`} />
          ) : (
            <div className="grid aspect-[9/16] place-items-center text-sm text-muted-foreground">Video dosyası henüz yok</div>
          )}
          <div className="grid grid-cols-2 gap-2 p-3 text-xs">
            <div>Süre: <b>{v.durationSec?.toFixed(2) ?? "—"} sn</b></div>
            <div>Çözünürlük: <b>{v.width && v.height ? `${v.width}x${v.height}` : "—"}</b></div>
            <div>FPS: <b>{v.fps?.toFixed(0) ?? "—"}</b></div>
            <div>Boyut: <b>{v.sizeBytes ? `${(Number(v.sizeBytes) / 1024 / 1024).toFixed(1)} MB` : "—"}</b></div>
            <div className="col-span-2">Maliyet: <b>{fmtUsd(Number(v.costUsd), 4)}</b></div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Yayın durumu</CardTitle><CardDescription>Her platform bağımsız bir iştir; birindeki hata diğerlerini etkilemez.</CardDescription></CardHeader>
            <CardContent>
              {v.publishJobs.length === 0 ? <p className="text-sm text-muted-foreground">Yayın işi yok.</p> : (
                <Table>
                  <thead><tr><Th>Platform</Th><Th>Hesap</Th><Th>Durum</Th><Th>Zaman</Th><Th>Deneme</Th><Th>Sonuç</Th></tr></thead>
                  <tbody>
                    {v.publishJobs.map((j) => {
                      const ok = v.publishResults.find((r) => r.publishJobId === j.id && r.success);
                      return (
                        <tr key={j.id}>
                          <Td><PlatformBadge platform={j.platform} /></Td>
                          <Td>{j.socialAccount.displayName}</Td>
                          <Td><StatusBadge status={j.status} /></Td>
                          <Td className="text-xs">{fmtDate(j.scheduledAt)}</Td>
                          <Td>{j.attempts}/{j.maxAttempts}</Td>
                          <Td className="text-xs">
                            {ok?.postUrl ? <a className="text-primary underline" href={ok.postUrl} target="_blank" rel="noreferrer noopener">Gönderiyi aç</a> : ok?.externalPostId ?? null}
                            {j.status === "AWAITING_CONSENT" ? <Link className="text-warning underline" href={`/queue/${j.id}/tiktok`}>Onay ver</Link> : null}
                            {j.lastError ? <div className="text-danger">{j.lastError}</div> : null}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Kalite kontrol raporu</CardTitle><CardDescription>{qc ? (qc.passed ? "Tüm zorunlu kontroller geçti" : "Başarısız kontroller var – video yayınlanmaz") : "Henüz çalıştırılmadı"}</CardDescription></CardHeader>
            <CardContent>
              {qc ? (
                <Table>
                  <thead><tr><Th>Kontrol</Th><Th>Sonuç</Th><Th>Değer</Th><Th>Beklenen</Th></tr></thead>
                  <tbody>
                    {qc.checks.map((c: any) => (
                      <tr key={c.id}>
                        <Td>{c.label}</Td>
                        <Td><Badge tone={c.passed ? "success" : c.severity === "error" ? "danger" : "warning"}>{c.passed ? "Geçti" : c.severity === "error" ? "Başarısız" : "Uyarı"}</Badge></Td>
                        <Td className="text-xs">{String(c.value ?? "")}</Td>
                        <Td className="text-xs text-muted-foreground">{c.expected ?? ""}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </CardContent>
          </Card>

          {manifest ? (
            <Card>
              <CardHeader><CardTitle>Medya ve lisanslar</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <thead><tr><Th>#</Th><Th>Kaynak</Th><Th>Lisans</Th><Th>Atıf</Th><Th>Ticari</Th></tr></thead>
                  <tbody>
                    {manifest.scenes.map((s: any) => (
                      <tr key={s.index}>
                        <Td>{s.index + 1}</Td>
                        <Td className="text-xs">{s.sourceUrl ? <a className="underline" href={s.sourceUrl} target="_blank" rel="noreferrer noopener">{s.provider}</a> : s.provider}</Td>
                        <Td className="text-xs">{s.licenseUrl ? <a className="underline" href={s.licenseUrl} target="_blank" rel="noreferrer noopener">{s.license}</a> : s.license}</Td>
                        <Td className="text-xs">{s.attribution ?? "—"}</Td>
                        <Td>{s.commercialUse ? "✓" : "✗"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="mt-3 text-xs text-muted-foreground">
                  Ses: Google TTS {manifest.voice?.voice} (zamanlama: {manifest.voice?.timing === "ssml_marks" ? "kelime işaretleri" : "orantılı"}) · Müzik: {manifest.music ? manifest.music.license : "kullanılmadı"}
                  {manifest.containsAiImagery ? " · AI ile üretilmiş görsel içerir (platformlarda beyan edilir)" : ""}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {v.script ? (
            <Card>
              <CardHeader><CardTitle>Senaryo</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">{v.script.hook}</p>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{v.script.narration}</p>
                <p className="mt-2 text-xs text-primary">{v.script.hashtags.join(" ")}</p>
              </CardContent>
            </Card>
          ) : null}

          {v.usageLogs.length ? (
            <Card>
              <CardHeader><CardTitle>Maliyet kırılımı</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <thead><tr><Th>İşlem</Th><Th>Sağlayıcı</Th><Th>Kullanım</Th><Th className="text-right">USD</Th></tr></thead>
                  <tbody>
                    {v.usageLogs.map((u) => (
                      <tr key={u.id}>
                        <Td className="text-xs">{u.operation}</Td>
                        <Td className="text-xs">{u.provider}{u.model ? ` · ${u.model}` : ""}</Td>
                        <Td className="text-xs">{u.inputTokens ? `${u.inputTokens}+${u.outputTokens} token` : u.characters ? `${u.characters} karakter` : u.units ?? ""}</Td>
                        <Td className="text-right tabular-nums">{fmtUsd(Number(u.costUsd), 5)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
