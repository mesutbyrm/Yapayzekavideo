import type { SocialAccount } from "../lib/db";
import { env } from "../lib/env";
import { httpJson } from "../lib/http";
import { ProviderError } from "../lib/errors";
import { META_SCOPES, graph, metaAuthUrl, metaConfigured, metaDebugToken, metaError, metaExchange, metaGet, metaPost } from "./meta";
import { baseValidate, sleep, type PostMetrics, type PublishContext, type PublishOutcome, type SocialPublisher } from "./types";

const P = "facebook";

/**
 * Facebook Page Reels – Reels Publishing API.
 * Akış: POST /{page-id}/video_reels upload_phase=start → rupload (file_url) →
 *       POST /{page-id}/video_reels upload_phase=finish video_state=PUBLISHED → durum kontrolü.
 * Gerekli izinler: pages_show_list, pages_read_engagement, pages_manage_posts. 24 saatte 30 API yayını.
 */
export class FacebookPublisher implements SocialPublisher {
  readonly platform = "FACEBOOK" as const;
  readonly requiredEnv = ["META_APP_ID", "META_APP_SECRET"];
  readonly scopes = META_SCOPES;
  pollIntervalMs = 10_000;
  maxPollMs = 10 * 60_000;

  isConfigured() {
    return metaConfigured();
  }
  connect({ state, redirectUri }: { state: string; redirectUri: string }) {
    return metaAuthUrl(state, redirectUri);
  }
  async handleCallback({ code, redirectUri }: { code: string; redirectUri: string }) {
    return metaExchange(code, redirectUri);
  }
  async refreshToken() {
    return null;
  }
  async checkToken(token: string) {
    return metaDebugToken(token);
  }
  async getAccountInfo(account: SocialAccount, token: string) {
    const d = await metaGet(P, `/${account.externalId}`, { fields: "id,name,picture{url},followers_count,fan_count" }, token);
    return { externalId: d.id, displayName: d.name, avatarUrl: d.picture?.data?.url, followers: d.followers_count ?? d.fan_count ?? null };
  }
  validateMedia(media: Parameters<SocialPublisher["validateMedia"]>[0]) {
    const errs = baseValidate(media, { minDurationSec: 3, maxDurationSec: 90, maxSizeBytes: 1024 * 1024 * 1024, aspect: "9:16" });
    if (media.width < 540 || media.height < 960) errs.push("Facebook Reels için en az 540x960 gerekli");
    return errs;
  }

  async publishVideo(ctx: PublishContext): Promise<PublishOutcome> {
    const page = ctx.account.externalId;
    let videoId = ctx.externalRef ?? null;
    if (videoId) {
      const st = await this.status(videoId, ctx.accessToken).catch(() => null);
      const pub = st?.publishing_phase?.status;
      if (pub === "complete" || st?.video_status === "ready") {
        return { state: "published", externalPostId: videoId, postUrl: `https://www.facebook.com/reel/${videoId}`, privacy: "PUBLIC", ref: videoId, raw: st };
      }
      if (!st || st.video_status === "error" || st.video_status === "expired" || st.video_status === "upload_failed") videoId = null;
    }
    if (!videoId) {
      const start = await metaPost(P, `/${page}/video_reels`, { upload_phase: "start" }, ctx.accessToken);
      videoId = String(start.video_id);
      await ctx.saveRef(videoId);
      const uploadUrl: string = start.upload_url ?? `https://rupload.facebook.com/video-upload/${env().META_GRAPH_VERSION}/${videoId}`;
      const up = await httpJson(uploadUrl, {
        method: "POST",
        provider: P,
        headers: { Authorization: `OAuth ${ctx.accessToken}`, file_url: ctx.media.publicUrl },
        timeoutMs: 120_000,
      });
      if (up.status >= 400 || up.data?.success !== true) throw metaError(P, up.status, up.data);
    }
    // Finish (idempotent: zaten tamamlandıysa hata dönebilir; durum ile doğrulanır)
    try {
      await metaPost(P, `/${page}/video_reels`, {
        video_id: videoId,
        upload_phase: "finish",
        video_state: "PUBLISHED",
        description: ctx.metadata.caption.slice(0, 2200),
        title: ctx.metadata.title.slice(0, 255),
        is_ai_generated: ctx.media.containsAiImagery ? "true" : undefined,
      }, ctx.accessToken);
    } catch (err) {
      const st = await this.status(videoId, ctx.accessToken).catch(() => null);
      if (st?.publishing_phase?.status !== "complete") throw err;
    }
    const started = Date.now();
    while (Date.now() - started < this.maxPollMs) {
      const st = await this.status(videoId, ctx.accessToken);
      if (st.video_status === "error" || st.processing_phase?.status === "error" || st.publishing_phase?.status === "error") {
        throw new ProviderError(`Facebook Reels işleme hatası: ${JSON.stringify(st.processing_phase?.error ?? st.publishing_phase ?? st.video_status)}`, P, "FB_PROCESSING_ERROR", false, undefined, "validation", st);
      }
      if (st.publishing_phase?.status === "complete" || st.publishing_phase?.publish_status === "published") {
        return { state: "published", externalPostId: videoId, postUrl: `https://www.facebook.com/reel/${videoId}`, privacy: "PUBLIC", ref: videoId, raw: st };
      }
      await sleep(this.pollIntervalMs);
    }
    return { state: "processing", externalPostId: videoId, ref: videoId };
  }

  private async status(videoId: string, token: string) {
    const d = await metaGet(P, `/${videoId}`, { fields: "status" }, token);
    return d.status ?? {};
  }

  async getPublishStatus(ctx: Omit<PublishContext, "media" | "metadata" | "saveRef">, ref: string): Promise<PublishOutcome> {
    const st = await this.status(ref, ctx.accessToken);
    const done = st.publishing_phase?.status === "complete";
    return { state: done ? "published" : "processing", externalPostId: ref, postUrl: done ? `https://www.facebook.com/reel/${ref}` : null, ref, raw: st };
  }

  async getAnalytics(_account: SocialAccount, token: string, videoId: string): Promise<PostMetrics> {
    const out: PostMetrics = { views: null, likes: null, comments: null, shares: null, saves: null, reach: null };
    const ins = await metaGet(P, `/${videoId}/video_insights`, { metric: "blue_reels_play_count,post_impressions_unique,post_video_social_actions,post_video_likes_by_reaction_type" }, token).catch(() => null);
    const val = (n: string) => (ins?.data ?? []).find((x: any) => x.name === n)?.values?.[0]?.value;
    const plays = val("blue_reels_play_count");
    if (typeof plays === "number") out.views = plays;
    const reach = val("post_impressions_unique");
    if (typeof reach === "number") out.reach = reach;
    const social = val("post_video_social_actions");
    if (social && typeof social === "object") {
      if (typeof social.SHARE === "number") out.shares = social.SHARE;
      if (typeof social.COMMENT === "number") out.comments = social.COMMENT;
    }
    const reactions = val("post_video_likes_by_reaction_type");
    if (reactions && typeof reactions === "object") out.likes = Object.values(reactions).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
    out.raw = ins?.data;
    return out;
  }

  async getFollowers(account: SocialAccount, token: string) {
    const d = await metaGet(P, `/${account.externalId}`, { fields: "followers_count" }, token);
    return typeof d.followers_count === "number" ? d.followers_count : null;
  }

  async disconnect(_account: SocialAccount, token: string) {
    // Uygulamanın kullanıcı izinlerini kaldırır (Sayfa token'ı ile /me/permissions DELETE desteklenmez → sessizce geç)
    await httpJson(`${graph("/me/permissions")}?access_token=${encodeURIComponent(token)}`, { method: "DELETE", provider: P }).catch(() => undefined);
  }
}
