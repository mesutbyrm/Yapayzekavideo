import type { SocialAccount } from "../lib/db";
import { ProviderError } from "../lib/errors";
import { logger } from "../lib/logger";
import { META_SCOPES, metaAuthUrl, metaConfigured, metaDebugToken, metaExchange, metaGet, metaPost } from "./meta";
import { baseValidate, sleep, type PostMetrics, type PublishContext, type PublishOutcome, type SocialPublisher } from "./types";

const P = "instagram";

/**
 * Instagram Reels – Instagram API with Facebook Login (graph.facebook.com).
 * Akış: POST /{ig-user-id}/media (REELS container) → status_code kontrolü → POST /{ig-user-id}/media_publish
 * Hız sınırı: 24 saatte API ile 100 yayın (content_publishing_limit ile kontrol edilir).
 */
export class InstagramPublisher implements SocialPublisher {
  readonly platform = "INSTAGRAM" as const;
  readonly requiredEnv = ["META_APP_ID", "META_APP_SECRET"];
  readonly scopes = META_SCOPES;
  pollIntervalMs = 15_000;
  maxPollMs = 10 * 60_000;

  isConfigured() {
    return metaConfigured();
  }
  connect({ state, redirectUri }: { state: string; redirectUri: string }) {
    return metaAuthUrl(state, redirectUri);
  }
  async handleCallback({ code, redirectUri }: { code: string; redirectUri: string }) {
    return (await metaExchange(code, redirectUri)).filter((a) => a.platform === "INSTAGRAM");
  }
  async refreshToken() {
    // Sayfa token'ları yenilenmez; geçerlilik debug_token ile kontrol edilir.
    return null;
  }
  async checkToken(token: string) {
    return metaDebugToken(token);
  }
  async getAccountInfo(account: SocialAccount, token: string) {
    const d = await metaGet(P, `/${account.externalId}`, { fields: "id,username,name,profile_picture_url,followers_count,media_count" }, token);
    return { externalId: d.id, displayName: d.name ?? d.username, username: d.username, avatarUrl: d.profile_picture_url, followers: d.followers_count ?? null };
  }
  validateMedia(media: Parameters<SocialPublisher["validateMedia"]>[0]) {
    // Reels: 3 sn – 15 dk, en fazla 300 MB (API), 9:16 önerilir
    return baseValidate(media, { minDurationSec: 3, maxDurationSec: 900, maxSizeBytes: 300 * 1024 * 1024, aspect: "9:16" });
  }

  async publishingQuota(account: SocialAccount, token: string) {
    try {
      const d = await metaGet(P, `/${account.externalId}/content_publishing_limit`, { fields: "config,quota_usage" }, token);
      const row = d.data?.[0];
      return { used: Number(row?.quota_usage ?? 0), total: Number(row?.config?.quota_total ?? 100) };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "instagram kota sorgulanamadı");
      return null;
    }
  }

  async publishVideo(ctx: PublishContext): Promise<PublishOutcome> {
    const ig = ctx.account.externalId;
    // Daha önce oluşturulmuş container varsa yeniden kullan (çift yayın engeli)
    let containerId = ctx.externalRef ?? null;
    if (containerId) {
      const st = await this.containerStatus(containerId, ctx.accessToken);
      if (st === "PUBLISHED") return this.recoverPublished(ctx);
      if (st === "ERROR" || st === "EXPIRED") containerId = null;
    }
    if (!containerId) {
      const quota = await this.publishingQuota(ctx.account, ctx.accessToken);
      if (quota && quota.used >= quota.total) {
        throw new ProviderError(`Instagram 24 saatlik yayın kotası doldu (${quota.used}/${quota.total})`, P, "IG_QUOTA", true, 429, "rate_limit");
      }
      const c = await metaPost(P, `/${ig}/media`, { media_type: "REELS", video_url: ctx.media.publicUrl, caption: ctx.metadata.caption.slice(0, 2200), share_to_feed: "true" }, ctx.accessToken);
      containerId = String(c.id);
      await ctx.saveRef(containerId);
    }
    const started = Date.now();
    while (Date.now() - started < this.maxPollMs) {
      const st = await this.containerStatus(containerId, ctx.accessToken);
      if (st === "FINISHED") break;
      if (st === "PUBLISHED") return this.recoverPublished(ctx);
      if (st === "ERROR" || st === "EXPIRED") {
        throw new ProviderError(`Instagram medya işleme durumu: ${st}`, P, `IG_CONTAINER_${st}`, st === "EXPIRED", undefined, "validation");
      }
      await sleep(this.pollIntervalMs);
    }
    const final = await this.containerStatus(containerId, ctx.accessToken);
    if (final !== "FINISHED") return { state: "processing", ref: containerId };
    const pub = await metaPost(P, `/${ig}/media_publish`, { creation_id: containerId }, ctx.accessToken);
    const mediaId = String(pub.id);
    const info = await metaGet(P, `/${mediaId}`, { fields: "id,permalink,media_product_type" }, ctx.accessToken).catch(() => null);
    return { state: "published", externalPostId: mediaId, postUrl: info?.permalink ?? null, privacy: "PUBLIC", ref: containerId, raw: { id: mediaId, media_product_type: info?.media_product_type } };
  }

  private async containerStatus(id: string, token: string): Promise<string> {
    const d = await metaGet(P, `/${id}`, { fields: "status_code,status" }, token);
    return String(d.status_code ?? "IN_PROGRESS");
  }

  /** Container yayınlanmış ama medya kimliği kaydedilememişse: son medyalardan açıklama eşleştirerek bulur */
  private async recoverPublished(ctx: PublishContext): Promise<PublishOutcome> {
    const list = await metaGet(P, `/${ctx.account.externalId}/media`, { fields: "id,caption,permalink,timestamp", limit: "10" }, ctx.accessToken);
    const head = ctx.metadata.caption.slice(0, 60);
    const m = (list.data ?? []).find((x: any) => typeof x.caption === "string" && x.caption.startsWith(head));
    if (!m) throw new ProviderError("Instagram: container yayınlanmış görünüyor ama gönderi bulunamadı", P, "IG_RECOVER_FAILED", false, undefined, "unknown");
    return { state: "published", externalPostId: m.id, postUrl: m.permalink, privacy: "PUBLIC", ref: ctx.externalRef, raw: { recovered: true } };
  }

  async getPublishStatus(ctx: Omit<PublishContext, "media" | "metadata" | "saveRef">, ref: string): Promise<PublishOutcome> {
    const st = await this.containerStatus(ref, ctx.accessToken);
    return { state: st === "PUBLISHED" ? "published" : "processing", ref, raw: { status_code: st } };
  }

  async getAnalytics(_account: SocialAccount, token: string, mediaId: string): Promise<PostMetrics> {
    // Reels metrikleri: views, likes, comments, shares, saved, reach (plays/ig_reels_aggregated_all_plays_count kullanımdan kaldırıldı)
    const d = await metaGet(P, `/${mediaId}/insights`, { metric: "views,likes,comments,shares,saved,reach" }, token);
    const val = (name: string) => {
      const m = (d.data ?? []).find((x: any) => x.name === name);
      const v = m?.values?.[0]?.value ?? m?.total_value?.value;
      return typeof v === "number" ? v : null;
    };
    return { views: val("views"), likes: val("likes"), comments: val("comments"), shares: val("shares"), saves: val("saved"), reach: val("reach"), raw: d.data };
  }

  async getFollowers(account: SocialAccount, token: string) {
    const d = await metaGet(P, `/${account.externalId}`, { fields: "followers_count" }, token);
    return typeof d.followers_count === "number" ? d.followers_count : null;
  }

  async disconnect() {
    // Instagram hesabı Facebook Sayfası token'ı üzerinden bağlıdır; token yerel olarak silinir.
    // Uygulama iznini tamamen kaldırmak için Facebook bağlantısı da kesilmelidir.
  }
}
