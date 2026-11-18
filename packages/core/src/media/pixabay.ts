import { env } from "../lib/env";
import { httpJson, classifyHttp } from "../lib/http";
import { ProviderError } from "../lib/errors";
import type { MediaCandidate, MediaProvider, SearchOptions } from "./types";

/** Pixabay Videos API – Pixabay Content License: ticari kullanım serbest. */
export class PixabayProvider implements MediaProvider {
  readonly id = "pixabay";
  readonly paid = false;
  isConfigured() {
    return !!env().PIXABAY_API_KEY;
  }
  async search(keywords: string[], opts: SearchOptions): Promise<MediaCandidate[]> {
    const q = encodeURIComponent(keywords.join(" ").slice(0, 100));
    const { status, data } = await httpJson(
      `https://pixabay.com/api/videos/?key=${env().PIXABAY_API_KEY}&q=${q}&video_type=film&safesearch=true&per_page=20`,
      { provider: "pixabay", timeoutMs: 15_000 },
    );
    if (status !== 200) {
      const c = classifyHttp(status);
      throw new ProviderError(`Pixabay HTTP ${status}`, "pixabay", `HTTP_${status}`, c.retryable, status, c.kind);
    }
    const out: MediaCandidate[] = [];
    for (const h of data.hits ?? []) {
      if ((h.duration ?? 0) < opts.minDurationSec) continue;
      const v = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
      if (!v?.url || !v.height || v.height < 720) continue;
      const id = String(h.id);
      if (opts.excludeProviderIds?.has(`pixabay:${id}`)) continue;
      out.push({
        provider: "pixabay",
        providerId: id,
        kind: "VIDEO",
        downloadUrl: v.url,
        sourceUrl: h.pageURL,
        width: v.width,
        height: v.height,
        durationSec: h.duration,
        license: "Pixabay Content License",
        licenseUrl: "https://pixabay.com/service/license-summary/",
        commercialUse: true,
        author: h.user,
        attribution: h.user ? `Video: ${h.user} / Pixabay` : "Pixabay",
        tags: String(h.tags ?? "").split(",").map((t: string) => t.trim()),
      });
    }
    // Dikey olanları öne al
    return out.sort((a, b) => b.height / b.width - a.height / a.width);
  }
}
