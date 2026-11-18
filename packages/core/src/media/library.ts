import { prisma } from "../lib/db";
import type { MediaCandidate, MediaProvider, SearchOptions } from "./types";

/** Kendi medya kütüphanemiz: yalnızca ticari kullanım izni işaretlenmiş varlıklar. */
export class LibraryProvider implements MediaProvider {
  readonly id = "library";
  readonly paid = false;
  isConfigured() {
    return true;
  }
  async search(keywords: string[], opts: SearchOptions): Promise<MediaCandidate[]> {
    const tags = keywords.flatMap((k) => k.toLowerCase().split(/\s+/)).filter(Boolean);
    const rows = await prisma.mediaAsset.findMany({
      where: {
        OR: [{ brandId: opts.brandId }, { brandId: null }],
        source: { in: ["LIBRARY", "UPLOAD"] },
        kind: { in: ["VIDEO", "IMAGE"] },
        commercialUse: true,
        storageKey: { not: null },
        tags: { hasSome: tags },
      },
      orderBy: { usageCount: "asc" },
      take: 10,
    });
    return rows
      .filter((r) => !opts.excludeProviderIds?.has(`library:${r.id}`))
      .filter((r) => r.kind === "IMAGE" || (r.durationSec ?? 0) >= opts.minDurationSec)
      .map((r) => ({
        provider: "library",
        providerId: r.id,
        assetId: r.id,
        kind: r.kind as "VIDEO" | "IMAGE",
        storageKey: r.storageKey!,
        sourceUrl: r.sourceUrl ?? `library://${r.id}`,
        width: r.width ?? 1080,
        height: r.height ?? 1920,
        durationSec: r.durationSec ?? undefined,
        license: r.license,
        licenseUrl: r.licenseUrl ?? undefined,
        commercialUse: r.commercialUse,
        author: r.author ?? undefined,
        attribution: r.attribution ?? undefined,
        tags: r.tags,
      }));
  }
}
