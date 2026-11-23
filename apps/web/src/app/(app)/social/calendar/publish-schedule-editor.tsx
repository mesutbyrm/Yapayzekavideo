"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Button, Input } from "@/components/ui";
import { apiFetch } from "@/lib/client";

export function PublishScheduleEditor({ publishJobId, scheduledAt, timezone }: { publishJobId: string; scheduledAt: string; timezone: string }) {
  const router = useRouter();
  const [value, setValue] = useState(() => DateTime.fromISO(scheduledAt, { zone: "utc" }).setZone(timezone).toFormat("yyyy-MM-dd'T'HH:mm"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const local = DateTime.fromISO(value, { zone: timezone });
      if (!local.isValid || local.toMillis() <= Date.now()) throw new Error("Gelecekte bir saat seçin.");
      await apiFetch("/api/publishing/reschedule", { method: "POST", json: { publishJobId, scheduledAt: local.toUTC().toISO() } });
      setMessage("Plan güncellendi.");
      router.refresh();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="mt-2 flex flex-col gap-1.5">
    <Input aria-label="Yeni yayın tarihi ve saati (Türkiye)" type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} />
    <Button size="sm" variant="outline" disabled={busy} onClick={save}>{busy ? "Kaydediliyor…" : "Saati kaydet"}</Button>
    {message ? <span role="status" className="text-[11px] text-muted-foreground">{message}</span> : null}
  </div>;
}
