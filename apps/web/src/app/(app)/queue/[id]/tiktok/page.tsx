import { notFound } from "next/navigation";
import { prisma, assertBrandAccess, env } from "@asf/core";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { TikTokConsent } from "./consent-client";

export const metadata = { title: "TikTok yayın onayı" };

export default async function TikTokConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const job = await prisma.publishJob.findUnique({ where: { id }, include: { video: { include: { script: true } }, socialAccount: true } });
  if (!job || job.platform !== "TIKTOK") notFound();
  try {
    await assertBrandAccess(user, job.brandId, "write");
  } catch {
    notFound();
  }
  const pm = (job.video.script?.platformMetadata as any)?.tiktok ?? {};
  const caption = pm.caption || job.video.title || "";
  return (
    <>
      <PageHeader title="TikTok'ta paylaş" description="TikTok içerik paylaşım kuralları gereği gönderiyi gözden geçirip açıkça onaylamanız gerekir." />
      <TikTokConsent
        job={{ id: job.id, status: job.status, accountId: job.socialAccountId, accountName: job.socialAccount.displayName, videoId: job.videoId, caption, durationSec: job.video.durationSec ?? 0 }}
        audited={!!env().TIKTOK_DIRECT_POST_AUDITED}
      />
    </>
  );
}
