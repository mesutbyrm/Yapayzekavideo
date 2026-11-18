"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Select } from "@/components/ui";
import { apiFetch } from "@/lib/client";

interface CreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Herkes",
  MUTUAL_FOLLOW_FRIENDS: "Arkadaşlar (karşılıklı takip)",
  FOLLOWER_OF_CREATOR: "Takipçiler",
  SELF_ONLY: "Sadece ben",
};

export function TikTokConsent({ job, audited }: { job: { id: string; status: string; accountId: string; accountName: string; videoId: string; caption: string; durationSec: number }; audited: boolean }) {
  const router = useRouter();
  const [info, setInfo] = useState<CreatorInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState("");
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [disclose, setDisclose] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ creatorInfo: CreatorInfo }>(`/api/publishing/creator-info/${job.accountId}`)
      .then((r) => setInfo(r.creatorInfo))
      .catch((e) => setLoadErr(e.message));
  }, [job.accountId]);

  const tooLong = info ? job.durationSec > info.max_video_post_duration_sec : false;
  const discloseInvalid = disclose && !yourBrand && !branded;
  const options = (info?.privacy_level_options ?? []).filter((o) => audited || o === "SELF_ONLY");
  const canSubmit = !!info && !!privacy && !tooLong && !discloseInvalid && !(branded && privacy === "SELF_ONLY") && job.status === "AWAITING_CONSENT";

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/publishing/consent", {
        method: "POST",
        json: { publishJobId: job.id, privacyLevel: privacy, disableComment: !allowComment, disableDuet: !allowDuet, disableStitch: !allowStitch, brandContent: disclose && branded, brandOrganic: disclose && yourBrand, musicConfirmation: true },
      });
      router.push("/queue");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
      <Card className="overflow-hidden">
        <video controls className="aspect-[9/16] w-full bg-black" src={`/api/videos/${job.videoId}/file`} />
        <div className="p-3 text-xs text-muted-foreground">İçerik önizlemesi · {job.durationSec.toFixed(1)} sn</div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Gönderi ayarları</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {!audited ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              TikTok uygulamanız henüz denetimden (audit) geçmedi. Bu süreçte TikTok API ile yalnızca <b>"Sadece ben"</b> görünürlüğünde paylaşım yapılabilir. Herkese açık paylaşım için TikTok Developer Portal üzerinden denetim başvurusu yapın. Diğer platformların yayınları bundan etkilenmez.
            </div>
          ) : null}
          {loadErr ? <p className="text-danger">Hesap bilgisi alınamadı: {loadErr}</p> : null}
          {info ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={info.creator_avatar_url} alt="" className="h-10 w-10 rounded-full" />
              <div>
                <div className="font-medium">{info.creator_nickname}</div>
                <div className="text-xs text-muted-foreground">@{info.creator_username} · paylaşım yapılacak hesap</div>
              </div>
            </div>
          ) : !loadErr ? <p className="text-muted-foreground">Hesap bilgisi yükleniyor…</p> : null}
          {tooLong ? <p className="text-danger">Video bu hesap için izin verilen süreyi aşıyor ({info?.max_video_post_duration_sec} sn).</p> : null}

          <Field label="Başlık / açıklama">
            <div className="rounded-lg border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{job.caption}</div>
          </Field>

          <Field label="Bu videoyu kimler görebilir? (zorunlu seçim)">
            <Select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
              <option value="" disabled>Seçiniz</option>
              {options.map((o) => (
                <option key={o} value={o} disabled={branded && o === "SELF_ONLY"}>{PRIVACY_LABEL[o] ?? o}</option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Kullanıcıların izin verilen etkileşimleri</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={allowComment} disabled={info?.comment_disabled} onChange={(e) => setAllowComment(e.target.checked)} />Yorum {info?.comment_disabled ? <Badge>hesap ayarında kapalı</Badge> : null}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={allowDuet} disabled={info?.duet_disabled} onChange={(e) => setAllowDuet(e.target.checked)} />Duet {info?.duet_disabled ? <Badge>hesap ayarında kapalı</Badge> : null}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={allowStitch} disabled={info?.stitch_disabled} onChange={(e) => setAllowStitch(e.target.checked)} />Stitch {info?.stitch_disabled ? <Badge>hesap ayarında kapalı</Badge> : null}</label>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={disclose} onChange={(e) => setDisclose(e.target.checked)} />Ticari içerik beyanı</label>
            <p className="text-xs text-muted-foreground">Bu video bir markayı, ürünü veya hizmeti tanıtıyorsa belirtin.</p>
            {disclose ? (
              <div className="flex flex-col gap-2 pl-5">
                <label className="flex items-center gap-2"><input type="checkbox" checked={yourBrand} onChange={(e) => setYourBrand(e.target.checked)} />Kendi markam (videoya "Tanıtım içeriği" etiketi eklenir)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} />Markalı içerik – üçüncü taraf iş birliği (videoya "Ücretli ortaklık" etiketi eklenir; gizli paylaşılamaz)</label>
                {discloseInvalid ? <p className="text-xs text-danger">En az bir seçenek işaretlenmeli.</p> : null}
              </div>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            Paylaşarak TikTok&apos;un{" "}
            {branded ? (
              <><a className="underline" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer noopener">Markalı İçerik Politikası</a> ve </>
            ) : null}
            <a className="underline" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer noopener">Müzik Kullanım Onayı</a>&apos;nı kabul etmiş olursunuz. Gönderinin platformda işlenmesi birkaç dakika sürebilir.
          </p>
          {err ? <p role="alert" className="text-danger">{err}</p> : null}
          <Button disabled={!canSubmit || busy} onClick={submit}>{busy ? "Gönderiliyor…" : "Onayla ve TikTok'ta paylaş"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
