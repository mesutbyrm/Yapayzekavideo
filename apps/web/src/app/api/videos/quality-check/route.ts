import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { z } from "zod";
import { prisma, storage, runQualityCheck, env, getSetting, AppError, audit } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Depolanmış video üzerinde kalite kontrolünü yeniden çalıştırır */
export const POST = api(async ({ json, brand, user, ip }) => {
  const { videoId } = await json(z.object({ videoId: z.string() }));
  const v = await prisma.video.findUniqueOrThrow({ where: { id: videoId }, include: { brand: true } });
  await brand(v.brandId, "write");
  if (!v.storageKey) throw new AppError("Video dosyası yok", "NOT_FOUND", 404);
  const dir = path.join(env().WORK_DIR, `qc-${v.id}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const file = path.join(dir, "v.mp4");
    await storage().getToFile(v.storageKey, file);
    const manifest = (v.mediaManifest ?? {}) as any;
    const qc = await runQualityCheck({
      filePath: file,
      minDurationSec: v.brand.minDurationSec,
      maxDurationSec: Number(manifest.production?.maxSeconds ?? v.brand.maxDurationSec),
      videoFormat: manifest.production?.videoFormat ?? "portrait",
      maxSizeMb: manifest.production?.videoFormat === "landscape" || Number(manifest.production?.maxSeconds ?? 0) > 180 ? 1000 : Number(await getSetting("video.maxSizeMb")),
      captionsCount: Number(manifest.captions ?? 0),
      media: manifest.scenes ?? [],
      contentBlocking: [],
      musicLicensed: manifest.music ? !!manifest.music.commercialUse : null,
    });
    const status = qc.passed ? (v.status === "QC_FAILED" ? "READY" : v.status) : "QC_FAILED";
    await prisma.video.update({ where: { id: v.id }, data: { qcPassed: qc.passed, qcReport: qc as any, status } });
    await audit({ action: "video.qc", userId: user.id, brandId: v.brandId, entity: "Video", entityId: v.id, ip, metadata: { passed: qc.passed } });
    return ok({ qc });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, { rateLimit: 10 });
