import { prisma } from "@asf/core";
import { AppShell } from "@/components/shell/app-shell";
import { currentBrand, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { brand, brands } = await currentBrand(user);
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  return (
    <AppShell user={user} brands={brands} brandId={brand?.id ?? null} unread={unread}>
      {children}
    </AppShell>
  );
}
