import { readFile } from "node:fs/promises";
import type { SocialAccount } from "../lib/db";
import { env } from "../lib/env";
import { httpJson } from "../lib/http";
import { NotConfiguredError, ProviderError } from "../lib/errors";
import { baseValidate, sleep, type ConnectedAccount, type PostMetrics, type PublishContext, type PublishOutcome, type SocialPublisher, type TokenSet } from "./types";

const P = "tiktok";
const API = "https://open.tiktokapis.com";

export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;

export interface CreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

/**
 * TikTok hata kodları (Content Posting API).
 * Denetimsiz istemci: unaudited_client_can_only_post_to_private_accounts → tekrar denenmez.
 */
export function tiktokError(status: number, data: any): ProviderError {
  const code: string = data?.error?.code ?? `HTTP_${status}`;
  const msg = `TikTok: ${data?.error?.message || code}`;
  if (code === "access_token_invalid" || code === "scope_not_authorized" || status === 401) return new ProviderError(msg, P, code, false, status, "auth", data?.error);
  if (code === "rate_limit_exceeded" || status === 429) return new ProviderError(msg, P, code, true, status, "rate_limit", data?.error);
  if (["spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap", "unaudited_client_can_only_post_to_private_accounts", "url_ownership_unverified", "privacy_level_option_mismatch"].includes(code)) {
    return new ProviderError(msg, P, code, code === "spam_risk_too_many_posts", status, "policy", data?.error);
  }
  if (status >= 500) return new ProviderError(msg, P, code, true, status, "transient", data?.error);
  return new ProviderError(msg, P, code, false, status, "validation", data?.error);
}

function requireTikTok() {
  const e = env();
  if (!e.TIKTOK_CLIENT_KEY || !e.TIKTOK_CLIENT_SECRET) throw new NotConfiguredError("TikTok", ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
  return { key: e.TIKTOK_CLIENT_KEY, secret: e.TIKTOK_CLIENT_SECRET };
}

async function ttPost(path: string, token: string, body: Record<string, unknown> = {}) {
  const { status, data } = await httpJson(`${API}${path}`, {
    method: "POST",
    provider: P,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body,
  });
  if (status >= 400 || (data?.error?.code && data.error.code !== "ok")) throw tiktokError(status, data);
  return data.data;
}

/**
 * TikTok Content Posting API – Direct Post.
 * Kurallar (TikTok UX yönergeleri):
 *  - Her yayından önce creator_info sorgulanır ve kullanıcıya gösterilir.
 *  - Gizlilik seviyesi kullanıcı tarafından seçilir (varsayılan atanmaz); yorum/duet/stitch ayarları gösterilir.
 *  - Kullanıcı içerik önizlemesini görüp açık onay verir (PublishJob.consentGivenAt).
 *  - Uygulama denetimi tamamlanmadıysa yalnızca SELF_ONLY (özel) yayın yapılabilir.
 */
export class TikTokPublisher implements SocialPublisher {
  readonly platform = "TIKTOK" as const;
  readonly requiredEnv = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"];
  readonly scopes = ["user.info.basic", "user.info.stats", "video.publish", "video.list"];
  pollIntervalMs = 10_000;
  maxPollMs = 10 * 60_000;

  isConfigured() {
    return !!(env().TIKTOK_CLIENT_KEY && env().TIKTOK_CLIENT_SECRET);
  }
  isAudited() {
    return !!env().TIKTOK_DIRECT_POST_AUDITED;
  }

  connect({ state, redirectUri, codeChallenge }: { state: string; redirectUri: string; codeChallenge?: string }) {
    const { key } = requireTikTok();
    const qs = new URLSearchParams({ client_key: key, scope: this.scopes.join(","), response_type: "code", redirect_uri: redirectUri, state });
    if (codeChallenge) {
      qs.set("code_challenge", codeChallenge);
      qs.set("code_challenge_method", "S256");
    }
    return `https://www.tiktok.com/v2/auth/authorize/?${qs}`;
  }

  private async tokenRequest(params: Record<string, string>) {
    const { key, secret } = requireTikTok();
    const body = new URLSearchParams({ client_key: key, client_secret: secret, ...params });
    const { status, data } = await httpJson(`${API}/v2/oauth/token/`, { method: "POST", provider: P, body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    if (status >= 400 || data.error) {
      throw new ProviderError(`TikTok OAuth: ${data.error_description ?? data.error ?? status}`, P, String(data.error ?? `HTTP_${status}`), status >= 500, status, "auth");
    }
    const now = Date.now();
    const t: TokenSet & { openId: string } = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(now + Number(data.expires_in) * 1000),
      refreshExpiresAt: data.refresh_expires_in ? new Date(now + Number(data.refresh_expires_in) * 1000) : null,
      scopes: String(data.scope ?? "").split(",").filter(Boolean),
      openId: data.open_id,
    };
    return t;
  }

  async handleCallback({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedAccount[]> {
    const t = await this.tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
    const user = await this.userInfo(t.accessToken).catch(() => null);
    return [
      {
        platform: "TIKTOK",
        externalId: t.openId,
        displayName: user?.display_name ?? "TikTok",
        username: user?.username ?? null,
        avatarUrl: user?.avatar_url ?? null,
        meta: { openId: t.openId },
        token: t,
      },
    ];
  }

  async refreshToken(token: TokenSet) {
    if (!token.refreshToken) return null;
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: token.refreshToken });
  }

  private async userInfo(token: string) {
    const { status, data } = await httpJson(`${API}/v2/user/info/?fields=open_id,avatar_url,display_name,username,follower_count`, { provider: P, headers: { Authorization: `Bearer ${token}` } });
    if (status >= 400 || (data?.error?.code && data.error.code !== "ok")) throw tiktokError(status, data);
    return data.data?.user ?? {};
  }

  async getAccountInfo(account: SocialAccount, token: string) {
    const u = await this.userInfo(token);
    return { externalId: account.externalId, displayName: u.display_name ?? account.displayName, username: u.username, avatarUrl: u.avatar_url, followers: u.follower_count ?? null };
  }

  /** Yayın öncesi zorunlu creator info sorgusu */
  async queryCreatorInfo(token: string): Promise<CreatorInfo> {
    return ttPost("/v2/post/publish/creator_info/query/", token);
  }

  validateMedia(media: Parameters<SocialPublisher["validateMedia"]>[0], account: SocialAccount) {
    const maxDur = Number((account.meta as any)?.creatorInfo?.max_video_post_duration_sec ?? 600);
    return baseValidate(media, { minDurationSec: 3, maxDurationSec: maxDur, maxSizeBytes: 4 * 1024 ** 3, aspect: "9:16" });
  }

  async publishVideo(ctx: PublishContext): Promise<PublishOutcome> {
    const opts = ctx.options ?? {};
    if (!opts.consentGivenAt) {
      throw new ProviderError("TikTok yayını için kullanıcı onayı gerekli (önizleme ekranından onaylayın)", P, "CONSENT_REQUIRED", false, undefined, "policy");
    }
    const privacy: string | undefined = opts.privacyLevel;
    if (!privacy) throw new ProviderError("TikTok gizlilik seviyesi kullanıcı tarafından seçilmeli", P, "PRIVACY_NOT_SELECTED", false, undefined, "policy");
    if (!this.isAudited() && privacy !== "SELF_ONLY") {
      throw new ProviderError("TikTok uygulaması henüz denetlenmedi: yalnızca SELF_ONLY (özel) yayın yapılabilir", P, "unaudited_client_can_only_post_to_private_accounts", false, 403, "policy");
    }
    // Yarıda kalan yayın varsa durumunu kontrol et (çift yayın engeli)
    if (ctx.externalRef) {
      const st = await this.getPublishStatus(ctx, ctx.externalRef);
      if ((st.raw as any)?.status !== "FAILED") {
        return st.state === "processing" ? this.poll(ctx, ctx.externalRef, privacy) : { ...st, privacy };
      }
    }
    const creator = await this.queryCreatorInfo(ctx.accessToken);
    if (!creator.privacy_level_options.includes(privacy)) {
      throw new ProviderError(`Seçilen gizlilik seviyesi (${privacy}) bu hesap için geçerli değil: ${creator.privacy_level_options.join(", ")}`, P, "privacy_level_option_mismatch", false, 400, "validation");
    }
    if (ctx.media.durationSec > creator.max_video_post_duration_sec) {
      throw new ProviderError(`Video süresi hesap sınırını aşıyor (${creator.max_video_post_duration_sec} sn)`, P, "DURATION_LIMIT", false, 400, "validation");
    }
    const size = ctx.media.sizeBytes;
    // Medya aktarımı: 64 MB altı dosyalar tek parça yüklenir
    const MAX_SINGLE = 64 * 1024 * 1024;
    const chunkSize = size <= MAX_SINGLE ? size : 10 * 1024 * 1024;
    const totalChunks = size <= MAX_SINGLE ? 1 : Math.floor(size / chunkSize);
    const init = await ttPost("/v2/post/publish/video/init/", ctx.accessToken, {
      post_info: {
        title: ctx.metadata.caption.slice(0, 2200),
        privacy_level: privacy,
        disable_comment: !!opts.disableComment || creator.comment_disabled,
        disable_duet: !!opts.disableDuet || creator.duet_disabled,
        disable_stitch: !!opts.disableStitch || creator.stitch_disabled,
        video_cover_timestamp_ms: 1000,
        brand_content_toggle: !!opts.brandContent,
        brand_organic_toggle: !!opts.brandOrganic,
        is_aigc: ctx.media.containsAiImagery || !!opts.isAigc,
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks },
    });
    const publishId: string = init.publish_id;
    await ctx.saveRef(publishId);
    const buf = await readFile(await ctx.media.getLocalPath());
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
      const res = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
        body: buf.subarray(start, end + 1),
      });
      if (res.status >= 400) throw new ProviderError(`TikTok yükleme hatası HTTP ${res.status}`, P, `UPLOAD_${res.status}`, res.status >= 500, res.status, "transient");
    }
    return this.poll(ctx, publishId, privacy);
  }

  private async poll(ctx: Pick<PublishContext, "accessToken" | "account">, publishId: string, privacy?: string): Promise<PublishOutcome> {
    const started = Date.now();
    while (Date.now() - started < this.maxPollMs) {
      const st = await this.getPublishStatus(ctx as any, publishId);
      const raw = st.raw as any;
      if (raw?.status === "FAILED") throw new ProviderError(`TikTok yayın başarısız: ${raw.fail_reason ?? "bilinmiyor"}`, P, `FAILED_${raw.fail_reason ?? "unknown"}`, false, undefined, "validation", raw);
      if (st.state !== "processing") return { ...st, privacy: privacy ?? st.privacy };
      await sleep(this.pollIntervalMs);
    }
    return { state: "processing", ref: publishId, privacy };
  }

  async getPublishStatus(ctx: Omit<PublishContext, "media" | "metadata" | "saveRef">, ref: string): Promise<PublishOutcome> {
    const d = await ttPost("/v2/post/publish/status/fetch/", ctx.accessToken, { publish_id: ref });
    const status: string = d.status;
    // Not: API alan adı "publicaly_available_post_id" şeklindedir.
    const postId = (d.publicaly_available_post_id ?? d.publicly_available_post_id ?? [])[0];
    const username = ctx.account.username;
    if (status === "PUBLISH_COMPLETE") {
      return {
        state: postId ? "published" : "private_only",
        externalPostId: postId ? String(postId) : ref,
        postUrl: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : null,
        ref,
        raw: d,
      };
    }
    return { state: "processing", ref, raw: d };
  }

  async getAnalytics(_account: SocialAccount, token: string, postId: string): Promise<PostMetrics> {
    const { status, data } = await httpJson(`${API}/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count`, {
      method: "POST",
      provider: P,
      headers: { Authorization: `Bearer ${token}` },
      body: { filters: { video_ids: [postId] } },
    });
    if (status >= 400 || (data?.error?.code && data.error.code !== "ok")) throw tiktokError(status, data);
    const v = data.data?.videos?.[0];
    if (!v) return { views: null, likes: null, comments: null, shares: null, saves: null, reach: null };
    return { views: v.view_count ?? null, likes: v.like_count ?? null, comments: v.comment_count ?? null, shares: v.share_count ?? null, saves: null, reach: null, raw: v };
  }

  async getFollowers(_account: SocialAccount, token: string) {
    const u = await this.userInfo(token);
    return typeof u.follower_count === "number" ? u.follower_count : null;
  }

  async disconnect(_account: SocialAccount, token: string) {
    const { key, secret } = requireTikTok();
    await httpJson(`${API}/v2/oauth/revoke/`, {
      method: "POST",
      provider: P,
      body: new URLSearchParams({ client_key: key, client_secret: secret, token }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => undefined);
  }
}
