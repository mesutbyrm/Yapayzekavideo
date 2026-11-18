"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button, Card, CardContent, Field, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setError(data?.error?.message ?? "Giriş başarısız");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/30">
            <Sparkles className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold">AI Social Factory</h1>
          <p className="text-xs text-muted-foreground">Yönetim paneline giriş yapın</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="E-posta">
            <Input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Şifre">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={loading}>{loading ? "Giriş yapılıyor…" : "Giriş yap"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
