import { env } from "../lib/env";
import { httpJson, classifyHttp } from "../lib/http";
import { ProviderError } from "../lib/errors";
import type { MediaCandidate, MediaProvider, SearchOptions } from "./types";

/** Pexels Videos API – Pexels Lisansı: ticari kullanım serbest, atıf zorunlu değil. */
export class PexelsProvider implements MediaProvider {
  readonly id = "pexels";
  readonly paid = false;
  isConfigured() {
    return !!env().PEXELS_API_KEY;
  }
  async search(keywords: string[], opts: SearchOptions): Promise<MediaCandidate[]> {
    const q = encodeURIComponent(keywords.join(" "));
    const { status, data, headers } = await httpJson(
      `https://api.pexels.com/videos/search?query=${q}&orientation=${opts.orientation}&size=medium&per_page=15`,
      { provider: "pexels", headers: { Authorization: env().PEXELS_API_KEY! }, timeoutMs: 15_000 },
    );
    if (status !== 200) {
      const c = classifyHttp(status);
      throw new ProviderError(`Pexels HTTP ${status}`, "pexels", `HTTP_${status}`, c.retryable, status, c.kind);
    }
    void headers;
    const out: MediaCandidate[] = [];
    for (const v of data.videos ?? []) {
      if ((v.duration ?? 0) < opts.minDurationSec) continue;
      // 1080 genişliğe en yakın, 4K'dan küçük dosya
      const files = (v.video_files ?? [])
        .filter((f: any) => f.file_type === "video/mp4" && f.width && f.height && f.height >= 960 && f.width <= 2160)
        .sort((a: any, b: any) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080));
      const f = files[0];
      if (!f) continue;
      const id = String(v.id);
      if (opts.excludeProviderIds?.has(`pexels:${id}`)) continue;
      out.push({
        provider: "pexels",
        providerId: id,
        kind: "VIDEO",
        downloadUrl: f.link,
        sourceUrl: v.url,
        width: f.width,
        height: f.height,
        durationSec: v.duration,
        license: "Pexels License",
        licenseUrl: "https://www.pexels.com/license/",
        commercialUse: true,
        author: v.user?.name,
        attribution: v.user?.name ? `Video: ${v.user.name} / Pexels` : "Pexels",
        tags: keywords,
      });
    }
    return out;
  }
}
