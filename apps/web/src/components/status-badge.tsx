import { Badge } from "@/components/ui";
import { STATUS_TR } from "@/lib/i18n";

const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral" | "primary"> = {
  READY: "info",
  PUBLISHED: "success",
  SUCCEEDED: "success",
  CONNECTED: "success",
  PARTIALLY_PUBLISHED: "warning",
  AWAITING_CONSENT: "warning",
  TOKEN_EXPIRED: "danger",
  QC_FAILED: "danger",
  FAILED: "danger",
  BLOCKED: "danger",
  ERROR: "danger",
  CANCELLED: "neutral",
  DISCONNECTED: "neutral",
  REVOKED: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? "primary"}>{STATUS_TR[status] ?? status}</Badge>;
}

export function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    INSTAGRAM: "bg-pink-500/10 text-pink-500 border-pink-500/25",
    FACEBOOK: "bg-blue-500/10 text-blue-500 border-blue-500/25",
    TIKTOK: "bg-zinc-500/10 text-foreground border-zinc-500/25",
    YOUTUBE: "bg-red-500/10 text-red-500 border-red-500/25",
  };
  const name: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok", YOUTUBE: "YouTube" };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${colors[platform] ?? ""}`}>{name[platform] ?? platform}</span>;
}
