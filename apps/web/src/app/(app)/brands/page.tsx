import { prisma, accessibleBrandIds, TURKISH_VOICES } from "@asf/core";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { currentBrand, requireUser } from "@/lib/auth";
import { BrandForm } from "./brand-form";

export const metadata = { title: "Markalar" };

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { brand } = await currentBrand(user);
  const ids = await accessibleBrandIds(user);
  const brands = await prisma.brand.findMany({ where: { id: { in: ids } }, include: { _count: { select: { socialAccounts: true, videos: true } } }, orderBy: { createdAt: "asc" } });
  const creating = sp.new === "1" || !brand;
  const voices = TURKISH_VOICES.map((v) => ({ name: v.name, gender: v.gender }));

  return (
    <>
      <PageHeader title="Markalar" description="Her marka kendi hesaplarına, içeriklerine, bütçesine ve yayın geçmişine sahiptir; markalar birbirinin verisini göremez." actions={<a className="text-sm text-primary underline" href="/brands?new=1">+ Yeni marka</a>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {brands.map((b) => (
          <Card key={b.id} className={`p-4 ${b.id === brand?.id ? "ring-2 ring-primary/50" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full" style={{ background: b.primaryColor }} />
              <span className="font-medium">{b.name}</span>
              {!b.isActive ? <span className="text-xs text-muted-foreground">(pasif)</span> : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{b._count.socialAccounts} hesap · {b._count.videos} video · günlük {b.dailyVideoTarget}</div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>{creating ? "Yeni marka oluştur" : `${brand!.name} – düzenle`}</CardTitle></CardHeader>
        <CardContent>
          <BrandForm
            voices={voices}
            initial={
              creating
                ? null
                : {
                    id: brand!.id,
                    name: brand!.name,
                    description: brand!.description ?? "",
                    website: brand!.website ?? "",
                    language: brand!.language,
                    targetAudience: brand!.targetAudience ?? "",
                    primaryColor: brand!.primaryColor,
                    secondaryColor: brand!.secondaryColor,
                    accentColor: brand!.accentColor,
                    fontFamily: brand!.fontFamily,
                    voiceName: brand!.voiceName,
                    voiceGender: brand!.voiceGender as "MALE" | "FEMALE",
                    speakingRate: brand!.speakingRate,
                    voicePitch: brand!.voicePitch,
                    videoTemplate: brand!.videoTemplate,
                    dailyVideoTarget: brand!.dailyVideoTarget,
                    monthlyVideoTarget: brand!.monthlyVideoTarget,
                    publishTimes: brand!.publishTimes.join(", "),
                    hashtags: brand!.hashtags.join(" "),
                    contentRules: brand!.contentRules ?? "",
                    monthlyBudgetUsd: Number(brand!.monthlyBudgetUsd),
                    maxBudgetUsd: Number(brand!.maxBudgetUsd),
                    musicEnabled: brand!.musicEnabled,
                    musicVolume: brand!.musicVolume,
                    isActive: brand!.isActive,
                    hasLogo: !!brand!.logoAssetId,
                  }
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
