import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Stat({ label, value, hint, tone, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "success" | "danger" | "warning"; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone === "success" && "text-success", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
