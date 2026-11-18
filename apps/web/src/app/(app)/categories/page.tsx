import { prisma } from "@asf/core";
import { EmptyState, PageHeader } from "@/components/ui";
import { currentBrand, requireUser } from "@/lib/auth";
import { CategoriesClient } from "./categories-client";

export const metadata = { title: "İçerik Kategorileri" };

export default async function CategoriesPage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const categories = await prisma.contentCategory.findMany({ where: { brandId: brand.id }, orderBy: { name: "asc" }, include: { _count: { select: { ideas: true } } } });
  return (
    <>
      <PageHeader title="İçerik Kategorileri" description="Fikir motoru bu kategorileri ve anahtar kelimeleri kullanır. Ağırlık, kategorinin seçilme önceliğini belirler." />
      <CategoriesClient brandId={brand.id} categories={categories.map((c) => ({ id: c.id, name: c.name, description: c.description ?? "", keywords: c.keywords.join(", "), weight: c.weight, isActive: c.isActive, ideas: c._count.ideas }))} />
    </>
  );
}
