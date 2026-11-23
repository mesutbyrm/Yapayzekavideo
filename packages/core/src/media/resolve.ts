import path from "node:path";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { getSetting } from "../lib/settings";
import { storage } from "../storage";
import { BudgetExceededError } from "../lib/errors";
import { downloadToFile } from "./download";
import { PexelsProvider } from "./pexels";
import { PixabayProvider } from "./pixabay";
import { LibraryProvider } from "./library";
import { aiImagesEnabled, generateAiImage } from "./ai-image";
import { probe } from "../video/ffmpeg";
import type { MediaCandidate, MediaProvider } from "./types";

export interface ResolvedScene {
  index: number;
  kind: "VIDEO" | "IMAGE" | "GENERATED";
  filePath?: string;
  durationSec: number;
  assetId?: string;
  provider: string;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
  attribution?: string;
  commercialUse: boolean;
}

export interface SceneInput {
  duration: number;
  visual_description: string;
  search_keywords?: string[];
  subtitle: string;
  label?: string;
}

const REGISTRY: Record<string, () => MediaProvider> = {
  library: () => new LibraryProvider(),
  pexels: () => new PexelsProvider(),
  pixabay: () => new PixabayProvider(),
};

/**
 * Her sahne için lisanslı medya bulur. Öncelik sırası sistem ayarından gelir:
 * library → pexels → pixabay → ai_image → generated (ücretsiz hareketli grafik).
 * Bir sağlayıcı çalışmazsa (anahtar yok, kota, hata) sıradakine geçilir; sistem durmaz.
 */
export async function resolveSceneMedia(opts: { brandId: string; videoId: string; scenes: SceneInput[]; workDir: string; onProgress?: (done: number, total: number) => unknown; template?: string; primaryColor?: string }): Promise<ResolvedScene[]> {
  let order: string[] = await getSetting("media.providerOrder");
  // shorts3d: referanstaki gibi sahneye uygun 3D karakter/nesne için AI görsel stok videodan önce denenir
  if (opts.template === "shorts3d" && order.includes("ai_image")) order = ["library", "ai_image", ...order.filter((p) => p !== "library" && p !== "ai_image")];
  const recentlyUsed = await recentProviderIds(opts.brandId);
  const usedNow = new Set<string>();
  const out: ResolvedScene[] = [];

  for (let i = 0; i < opts.scenes.length; i++) {
    const scene = opts.scenes[i];
    const keywords = scene.search_keywords?.length ? scene.search_keywords : scene.visual_description.split(/\s+/).slice(0, 3);
    let resolved: ResolvedScene | null = null;

    for (const pid of order) {
      if (resolved) break;
      try {
        if (pid === "generated") {
          resolved = generatedScene(i, scene.duration);
          continue;
        }
        if (pid === "ai_image") {
          if (!aiImagesEnabled()) continue;
          const file = path.join(opts.workDir, `scene_${i}_ai.png`);
          const { width, height } = await generateAiImage(scene.visual_description, file, { brandId: opts.brandId, videoId: opts.videoId, template: opts.template, primaryColor: opts.primaryColor });
          const asset = await prisma.mediaAsset.create({
            data: {
              brandId: opts.brandId,
              kind: "IMAGE",
              source: "AI_IMAGE",
              provider: "openai",
              providerId: `${opts.videoId}_${i}`,
              width,
              height,
              license: "OpenAI ile üretildi – kullanıcıya ait (OpenAI Kullanım Koşulları)",
              licenseUrl: "https://openai.com/policies/terms-of-use",
              commercialUse: true,
              attribution: "AI generated",
              downloadedAt: new Date(),
              tags: keywords,
            },
          });
          resolved = { index: i, kind: "IMAGE", filePath: file, durationSec: scene.duration, assetId: asset.id, provider: "openai", license: asset.license, licenseUrl: asset.licenseUrl ?? undefined, commercialUse: true, attribution: "AI generated" };
          continue;
        }
        // Stok video (Pexels/Pixabay) varsayılan olarak kapalı: sahneler kodla üretilir. Açmak için DISABLE_STOCK_VIDEO=false
        if ((pid === "pexels" || pid === "pixabay") && process.env.DISABLE_STOCK_VIDEO !== "false") continue;
        const provider = REGISTRY[pid]?.();
        if (!provider || !provider.isConfigured()) continue;
        const exclude = new Set([...recentlyUsed, ...usedNow]);
        const cands = await provider.search(keywords, { brandId: opts.brandId, minDurationSec: Math.ceil(scene.duration), orientation: "portrait", excludeProviderIds: exclude });
        const cand = cands.find((c) => c.commercialUse);
        if (!cand) continue;
        resolved = await materialize(cand, i, scene.duration, opts);
        usedNow.add(`${cand.provider}:${cand.providerId}`);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          logger.warn({ scene: i }, "bütçe nedeniyle AI görsel atlandı");
          continue;
        }
        logger.warn({ provider: pid, scene: i, err: (err as Error).message }, "medya sağlayıcısı başarısız, sıradakine geçiliyor");
      }
    }
    out.push(resolved ?? generatedScene(i, scene.duration));
    await Promise.resolve(opts.onProgress?.(i + 1, opts.scenes.length)).catch(() => undefined);
  }
  return out;
}

function generatedScene(index: number, durationSec: number): ResolvedScene {
  return {
    index,
    kind: "GENERATED",
    durationSec,
    provider: "generated",
    license: "Sistem tarafından üretilen hareketli grafik (telif içermez)",
    commercialUse: true,
  };
}

async function materialize(c: MediaCandidate, index: number, durationSec: number, opts: { brandId: string; workDir: string }): Promise<ResolvedScene> {
  const ext = c.kind === "VIDEO" ? ".mp4" : ".jpg";
  const file = path.join(opts.workDir, `scene_${index}_${c.provider}${ext}`);
  let sizeBytes = 0;
  if (c.storageKey) {
    await storage().getToFile(c.storageKey, file);
  } else if (c.downloadUrl) {
    sizeBytes = await downloadToFile(c.downloadUrl, file, c.provider);
  } else {
    throw new Error("Aday medya için kaynak yok");
  }
  if (c.kind === "VIDEO") {
    const p = await probe(file);
    if (!p.video) throw new Error("İndirilen dosyada video akışı yok");
  }
  let assetId = c.assetId;
  if (!assetId) {
    const asset = await prisma.mediaAsset.upsert({
      where: { provider_providerId_brandId: { provider: c.provider, providerId: c.providerId, brandId: opts.brandId } },
      update: { usageCount: { increment: 1 }, downloadedAt: new Date() },
      create: {
        brandId: opts.brandId,
        kind: c.kind,
        source: "STOCK",
        provider: c.provider,
        providerId: c.providerId,
        sourceUrl: c.sourceUrl,
        width: c.width,
        height: c.height,
        durationSec: c.durationSec,
        sizeBytes: BigInt(sizeBytes),
        license: c.license,
        licenseUrl: c.licenseUrl,
        commercialUse: c.commercialUse,
        author: c.author,
        attribution: c.attribution,
        tags: c.tags ?? [],
        downloadedAt: new Date(),
        usageCount: 1,
      },
    });
    assetId = asset.id;
  } else {
    await prisma.mediaAsset.update({ where: { id: assetId }, data: { usageCount: { increment: 1 } } });
  }
  return {
    index,
    kind: c.kind,
    filePath: file,
    durationSec,
    assetId,
    provider: c.provider,
    license: c.license,
    licenseUrl: c.licenseUrl,
    sourceUrl: c.sourceUrl,
    attribution: c.attribution,
    commercialUse: c.commercialUse,
  };
}

/** Son 30 günde kullanılan stok kliplerin tekrar kullanımını azaltır */
async function recentProviderIds(brandId: string) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const rows = await prisma.mediaAsset.findMany({
    where: { brandId, source: "STOCK", downloadedAt: { gte: since } },
    select: { provider: true, providerId: true },
  });
  return new Set(rows.map((r) => `${r.provider}:${r.providerId}`));
}

/** Arka plan müziği: yalnızca kütüphanedeki ticari kullanıma uygun lisanslı parçalar */
export async function pickMusic(brandId: string, workDir: string) {
  const track = await prisma.mediaAsset.findFirst({
    where: { OR: [{ brandId }, { brandId: null }], kind: "MUSIC", commercialUse: true, storageKey: { not: null } },
    orderBy: { usageCount: "asc" },
  });
  if (!track?.storageKey) return null;
  const file = path.join(workDir, `music${path.extname(track.storageKey) || ".mp3"}`);
  await storage().getToFile(track.storageKey, file);
  await prisma.mediaAsset.update({ where: { id: track.id }, data: { usageCount: { increment: 1 } } });
  return { file, asset: track };
}
