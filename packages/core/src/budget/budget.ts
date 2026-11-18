import { Prisma, prisma, type UsageProvider } from "../lib/db";
import { BudgetExceededError } from "../lib/errors";
import { getSetting } from "../lib/settings";
import { monthRange } from "../lib/time";
import { logger } from "../lib/logger";
import { notify } from "../notifications/notify";

export interface BudgetStatus {
  scope: "brand" | "global";
  spentUsd: number;
  targetUsd: number;
  maxUsd: number;
  remainingUsd: number;
  percentOfMax: number;
  blocked: boolean;
}

/** Bütçeye sayılan değişken (ücretli üretim) maliyetleri. Sunucu/depolama sabit giderleri raporlarda ayrıca gösterilir. */
export const VARIABLE_PROVIDERS: UsageProvider[] = ["OPENAI", "GOOGLE_TTS", "AI_IMAGE", "AI_VIDEO", "STOCK_MEDIA", "OTHER"];

export async function monthlySpend(brandId?: string | null, at = new Date()): Promise<number> {
  const { start, end } = monthRange(undefined, at);
  const agg = await prisma.aIUsageLog.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: start, lte: end }, provider: { in: VARIABLE_PROVIDERS }, ...(brandId ? { brandId } : {}) },
  });
  return Number(agg._sum.costUsd ?? 0);
}

export async function budgetStatus(brandId?: string | null): Promise<BudgetStatus[]> {
  const out: BudgetStatus[] = [];
  const gTarget = Number(await getSetting("budget.monthlyTargetUsd"));
  const gMax = Number(await getSetting("budget.monthlyMaxUsd"));
  const gSpent = await monthlySpend(null);
  out.push(mk("global", gSpent, gTarget, gMax));
  if (brandId) {
    const b = await prisma.brand.findUnique({ where: { id: brandId }, select: { monthlyBudgetUsd: true, maxBudgetUsd: true } });
    if (b) out.push(mk("brand", await monthlySpend(brandId), Number(b.monthlyBudgetUsd), Number(b.maxBudgetUsd)));
  }
  return out;
}

function mk(scope: "brand" | "global", spent: number, target: number, max: number): BudgetStatus {
  return {
    scope,
    spentUsd: round(spent),
    targetUsd: target,
    maxUsd: max,
    remainingUsd: round(Math.max(0, max - spent)),
    percentOfMax: max > 0 ? Math.round((spent / max) * 1000) / 10 : 100,
    blocked: spent >= max,
  };
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Ücretli işlemden ÖNCE çağrılır. Bütçe aşılacaksa BudgetExceededError fırlatır
 * ve yöneticiye bir kez bildirim gönderir. Ücretsiz işlemler (yayınlama vb.) bunu çağırmaz.
 */
export async function assertCanSpend(brandId: string | null, estimatedUsd: number, operation: string) {
  const statuses = await budgetStatus(brandId);
  const warnAt = Number(await getSetting("budget.warnAtPercent"));
  for (const s of statuses) {
    if (s.spentUsd + estimatedUsd > s.maxUsd) {
      const monthKey = new Date().toISOString().slice(0, 7);
      await notify({
        type: "BUDGET_LIMIT",
        severity: "ERROR",
        brandId: s.scope === "brand" ? brandId : null,
        title: "Bütçe sınırına ulaşıldı",
        message: `${s.scope === "brand" ? "Marka" : "Genel"} aylık bütçe sınırı (${s.maxUsd} USD) doldu. Harcanan: ${s.spentUsd} USD. Ücretli üretim durduruldu; yayınlama devam ediyor.`,
        dedupeKey: `budget-limit:${s.scope}:${brandId ?? "global"}:${monthKey}`,
        email: true,
      });
      throw new BudgetExceededError(`Aylık bütçe sınırı aşılacağı için '${operation}' durduruldu`, s);
    }
    if (s.percentOfMax >= warnAt) {
      const monthKey = new Date().toISOString().slice(0, 7);
      await notify({
        type: "BUDGET_LIMIT",
        severity: "WARNING",
        brandId: s.scope === "brand" ? brandId : null,
        title: "Bütçe uyarısı",
        message: `${s.scope === "brand" ? "Marka" : "Genel"} aylık bütçenin %${s.percentOfMax}'i kullanıldı (${s.spentUsd}/${s.maxUsd} USD).`,
        dedupeKey: `budget-warn:${s.scope}:${brandId ?? "global"}:${monthKey}`,
        email: true,
      });
    }
  }
}

export async function recordUsage(entry: {
  brandId?: string | null;
  videoId?: string | null;
  provider: UsageProvider;
  operation: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  characters?: number;
  units?: number;
  costUsd: number;
  metadata?: Record<string, unknown>;
}) {
  const row = await prisma.aIUsageLog.create({
    data: {
      brandId: entry.brandId ?? null,
      videoId: entry.videoId ?? null,
      provider: entry.provider,
      operation: entry.operation,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      characters: entry.characters,
      units: entry.units,
      costUsd: new Prisma.Decimal(entry.costUsd.toFixed(6)),
      metadata: entry.metadata as any,
    },
  });
  if (entry.videoId) {
    await prisma.video
      .update({ where: { id: entry.videoId }, data: { costUsd: { increment: new Prisma.Decimal(entry.costUsd.toFixed(6)) } } })
      .catch((err) => logger.warn({ err }, "video maliyeti güncellenemedi"));
  }
  return row;
}
