import { prisma, getAllSettings } from "@asf/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireUser, currentBrand } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";
import { AccountSettings, ProviderOrder, UserAdmin } from "./settings-client";

export const metadata = { title: "Sistem Ayarları" };

export default async function SettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const { brands } = await currentBrand(user);
  const [settings, users, audits] = await Promise.all([
    getAllSettings(),
    isAdmin ? prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    prisma.auditLog.findMany({ where: isAdmin ? {} : { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { email: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Sistem Ayarları" description="Medya sağlayıcı önceliği, kullanıcılar ve yetkiler, hesap güvenliği, veri dışa aktarma ve denetim kaydı." />
      <div className="grid gap-4 lg:grid-cols-2">
        {isAdmin ? <ProviderOrder initial={settings["media.providerOrder"] as string[]} maxSizeMb={Number(settings["video.maxSizeMb"])} /> : null}
        <AccountSettings email={user.email} />
        {isAdmin ? <UserAdmin users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))} brands={brands} selfId={user.id} /> : null}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Denetim kaydı (audit log)</CardTitle><CardDescription>Son 50 kritik işlem{isAdmin ? " – tüm kullanıcılar" : ""}</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Zaman</Th><Th>Kullanıcı</Th><Th>İşlem</Th><Th>Kayıt</Th><Th>IP</Th></tr></thead>
              <tbody>{audits.map((a) => <tr key={a.id}><Td className="text-xs">{fmtDate(a.createdAt)}</Td><Td className="text-xs">{a.user?.email ?? "—"}</Td><Td className="font-mono text-xs">{a.action}</Td><Td className="text-xs">{a.entity ? `${a.entity}:${a.entityId}` : ""}</Td><Td className="text-xs">{a.ip ?? ""}</Td></tr>)}</tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
