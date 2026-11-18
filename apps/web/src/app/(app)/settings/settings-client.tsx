"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui";
import { apiFetch } from "@/lib/client";
import { fmtDate } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = { library: "Kendi medya kütüphanemiz", pexels: "Pexels (lisanslı stok)", pixabay: "Pixabay (lisanslı stok)", ai_image: "AI görsel (ücretli)", generated: "Hareketli grafik (ücretsiz)" };

function useStatus() {
  const [s, setS] = useState<{ ok: boolean; text: string } | null>(null);
  const node = s ? <p role="status" className={s.ok ? "text-sm text-success" : "text-sm text-danger"}>{s.text}</p> : null;
  return { set: setS, node };
}

export function ProviderOrder({ initial, maxSizeMb }: { initial: string[]; maxSizeMb: number }) {
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [size, setSize] = useState(maxSizeMb);
  const st = useStatus();
  const move = (i: number, d: number) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <Card>
      <CardHeader><CardTitle>Medya sağlayıcı önceliği</CardTitle><CardDescription>Ekonomik yaklaşım: önce lisanslı stok ve kendi kütüphane, en son ücretli üretim. Bir sağlayıcı çalışmazsa sıradakine geçilir.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-2">
        {order.map((p, i) => (
          <div key={p} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="w-5 text-muted-foreground">{i + 1}.</span>
            <span className="flex-1">{PROVIDER_LABEL[p] ?? p}</span>
            <Button size="icon" variant="ghost" aria-label="Yukarı" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label="Aşağı" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
          </div>
        ))}
        <Field label="Maksimum video dosya boyutu (MB)"><Input type="number" min={10} max={1000} value={size} onChange={(e) => setSize(Number(e.target.value))} /></Field>
        <Button onClick={async () => { try { await apiFetch("/api/settings", { method: "PATCH", json: { "media.providerOrder": order, "video.maxSizeMb": size } }); st.set({ ok: true, text: "Kaydedildi" }); router.refresh(); } catch (e) { st.set({ ok: false, text: (e as Error).message }); } }}>Kaydet</Button>
        {st.node}
      </CardContent>
    </Card>
  );
}

export function AccountSettings({ email }: { email: string }) {
  const router = useRouter();
  const pw = useStatus();
  const del = useStatus();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [delPw, setDelPw] = useState("");
  const [confirmText, setConfirmText] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle>Hesabım</CardTitle><CardDescription>{email}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Mevcut şifre"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="Yeni şifre (en az 12 karakter, büyük/küçük harf, rakam)"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
          <div className="sm:col-span-2"><Button variant="secondary" onClick={async () => { try { await apiFetch("/api/auth/password", { method: "POST", json: { currentPassword: cur, newPassword: next } }); pw.set({ ok: true, text: "Şifre değiştirildi" }); setCur(""); setNext(""); } catch (e) { pw.set({ ok: false, text: (e as Error).message }); } }}>Şifreyi değiştir</Button></div>
          {pw.node}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-sm font-medium">Veri dışa aktarma</span>
          <p className="text-xs text-muted-foreground">Hesabınıza ve sahibi olduğunuz markalara ait verileri JSON olarak indirin. Token ve şifre bilgileri dahil edilmez.</p>
          <a className="text-sm text-primary underline" href="/api/account/export">Verilerimi indir</a>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-sm font-medium text-danger">Hesabı sil</span>
          <p className="text-xs text-muted-foreground">Sahibi olduğunuz (başka sahibi olmayan) markalar, içerikleri ve bağlı hesap token&apos;ları kalıcı olarak silinir. Platform bağlantıları iptal edilir.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="password" placeholder="Şifreniz" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
            <Input placeholder='Onay için "HESABIMI SIL" yazın' value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </div>
          <Button variant="danger" disabled={confirmText !== "HESABIMI SIL" || !delPw} onClick={async () => { try { await apiFetch("/api/account/delete", { method: "POST", json: { password: delPw, confirm: confirmText } }); router.push("/login"); } catch (e) { del.set({ ok: false, text: (e as Error).message }); } }}>Hesabımı kalıcı olarak sil</Button>
          {del.node}
        </div>
      </CardContent>
    </Card>
  );
}

export function UserAdmin({ users, brands, selfId }: { users: { id: string; email: string; name: string; role: string; isActive: boolean; lastLoginAt: string | null }[]; brands: { id: string; name: string }[]; selfId: string }) {
  const router = useRouter();
  const st = useStatus();
  const [f, setF] = useState({ email: "", name: "", password: "", role: "USER", brandId: brands[0]?.id ?? "", brandRole: "EDITOR" });
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Kullanıcılar ve yetkiler</CardTitle><CardDescription>Yönetici tüm sistemi yönetir. Kullanıcılar yalnızca üye oldukları markaları görür (Sahip / Editör / İzleyici).</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="font-medium">{u.name}</span>
              <span className="text-xs text-muted-foreground">{u.email}</span>
              <Badge tone={u.role === "ADMIN" ? "primary" : "neutral"}>{u.role === "ADMIN" ? "Yönetici" : "Kullanıcı"}</Badge>
              {!u.isActive ? <Badge tone="danger">Pasif</Badge> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">Son giriş: {fmtDate(u.lastLoginAt)}</span>
              {u.id !== selfId ? (
                <Button size="sm" variant="outline" onClick={async () => { try { await apiFetch("/api/settings/users", { method: "PATCH", json: { id: u.id, isActive: !u.isActive } }); router.refresh(); } catch (e) { st.set({ ok: false, text: (e as Error).message }); } }}>{u.isActive ? "Devre dışı bırak" : "Etkinleştir"}</Button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Ad"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-posta"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Geçici şifre"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Rol"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="USER">Kullanıcı</option><option value="ADMIN">Yönetici</option></Select></Field>
          <Field label="Marka"><Select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Marka yetkisi"><Select value={f.brandRole} onChange={(e) => setF({ ...f, brandRole: e.target.value })}><option value="OWNER">Sahip</option><option value="EDITOR">Editör</option><option value="VIEWER">İzleyici</option></Select></Field>
          <div className="sm:col-span-3 lg:col-span-6">
            <Button onClick={async () => { try { await apiFetch("/api/settings/users", { method: "POST", json: { email: f.email, name: f.name, password: f.password, role: f.role, brandIds: f.brandId ? [f.brandId] : [], brandRole: f.brandRole } }); st.set({ ok: true, text: "Kullanıcı oluşturuldu" }); setF({ ...f, email: "", name: "", password: "" }); router.refresh(); } catch (e) { st.set({ ok: false, text: (e as Error).message }); } }}>Kullanıcı ekle</Button>
          </div>
        </div>
        {st.node}
      </CardContent>
    </Card>
  );
}
