"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/client";

/** API'ye istek gönderip sayfayı yenileyen buton. Hata mesajını gösterir. */
export function ActionButton({
  url,
  method = "POST",
  body,
  children,
  confirm: confirmText,
  variant,
  size = "sm",
  onDone,
}: {
  url: string;
  method?: string;
  body?: unknown;
  children: React.ReactNode;
  confirm?: string;
  variant?: "default" | "secondary" | "outline" | "ghost" | "danger";
  size?: "default" | "sm" | "lg";
  onDone?: (data: any) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant={variant}
        size={size}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          setErr(null);
          try {
            const data = await apiFetch(url, { method, json: body });
            onDone?.(data);
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : children}
      </Button>
      {err ? <span role="alert" className="max-w-xs text-[11px] text-danger">{err}</span> : null}
    </span>
  );
}
