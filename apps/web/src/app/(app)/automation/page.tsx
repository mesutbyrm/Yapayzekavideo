import { prisma, getAllSettings, generationLimits } from "@asf/core";
import { EmptyState, PageHeader } from "@/components/ui";
import { currentBrand, requireUser } from "@/lib/auth";
import { AutomationClient } from "./automation-client";

export const metadata = { title: "Otomatik Üretim" };

export default async function AutomationPage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const [schedules, settings, limits] = await Promise.all([
    prisma.schedule.findMany({ where: { brandId: brand.id }, orderBy: { time: "asc" } }),
    getAllSettings(),
    generationLimits(brand.id),
  ]);
  return (
    <>
      <PageHeader title="Otomatik Üretim" description="Günlük üretim hedefi, yayın saatleri (Europe/Istanbul) ve limitler. Üretim, yayın saatinden belirlenen süre önce başlar." />
      <AutomationClient
        isAdmin={user.role === "ADMIN"}
        brand={{ id: brand.id, autoGenerate: brand.autoGenerate, autoPublish: brand.autoPublish, dailyVideoTarget: brand.dailyVideoTarget, monthlyVideoTarget: brand.monthlyVideoTarget, minDurationSec: brand.minDurationSec, maxDurationSec: brand.maxDurationSec }}
        schedules={schedules.map((s) => ({ time: s.time, weekdays: s.weekdays, platforms: s.platforms, leadMinutes: s.leadMinutes, isActive: s.isActive }))}
        settings={settings as any}
        limits={limits}
      />
    </>
  );
}
