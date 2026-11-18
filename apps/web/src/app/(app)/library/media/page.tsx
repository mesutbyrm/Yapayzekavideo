import { prisma } from "@asf/core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { currentBrand, requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Medya Kütüphanesi" };

export default async function MediaLibraryPage() {
  const user = await requireUser();
  const { brand } = await currentBrand(user);
  if (!brand) return <EmptyState title="Önce bir marka oluşturun" />;
  const assets = await prisma.mediaAsset.findMany({ where: { OR: [{ brandId: brand.id }, { brandId: null }], kind: { not: "LOGO" } }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <>
      <PageHeader title="Medya Kütüphanesi" description="Kendi videolarınız, görselleriniz ve ticari kullanıma uygun lisanslı müzikleriniz. Stok kaynaklardan indirilenlerin lisans kaydı da burada tutulur." />
      <UploadForm brandId={brand.id} />
      <Card className="mt-4">
        <CardHeader><CardTitle>Varlıklar</CardTitle><CardDescription>{assets.length} kayıt</CardDescription></CardHeader>
        <CardContent>
          {assets.length === 0 ? <p className="text-sm text-muted-foreground">Kayıt yok.</p> : (
            <Table>
              <thead><tr><Th>Tür</Th><Th>Kaynak</Th><Th>Lisans</Th><Th>Atıf</Th><Th>Etiketler</Th><Th>İndirme</Th><Th>Kullanım</Th><Th /></tr></thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <Td><Badge>{a.kind}</Badge></Td>
                    <Td className="text-xs">{a.sourceUrl ? <a className="underline" href={a.sourceUrl} target="_blank" rel="noreferrer noopener">{a.provider}</a> : a.provider}</Td>
                    <Td className="text-xs">{a.licenseUrl ? <a className="underline" href={a.licenseUrl} target="_blank" rel="noreferrer noopener">{a.license}</a> : a.license}{a.commercialUse ? <Badge tone="success" className="ml-1">ticari ✓</Badge> : <Badge tone="danger" className="ml-1">ticari ✗</Badge>}</Td>
                    <Td className="text-xs">{a.attribution ?? "—"}</Td>
                    <Td className="text-xs">{a.tags.slice(0, 5).join(", ")}</Td>
                    <Td className="text-xs">{fmtDate(a.downloadedAt)}</Td>
                    <Td>{a.usageCount}</Td>
                    <Td>{a.brandId && a.source !== "STOCK" ? <ActionButton url={`/api/media-assets/${a.id}`} method="DELETE" variant="ghost" confirm="Varlık silinsin mi?">Sil</ActionButton> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
