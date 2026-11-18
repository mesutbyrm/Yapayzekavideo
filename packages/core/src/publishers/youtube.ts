import { open } from "node:fs/promises";
import type { SocialAccount } from "../lib/db";
import { env } from "../lib/env";
import { httpJson, classifyHttp } from "../lib/http";
import { NotConfiguredError, ProviderError } from "../lib/errors";
import { baseValidate, type ConnectedAccount, type PostMetrics, type PublishContext, type PublishOutcome, type SocialPublisher, type TokenSet } from "./types";

const P = "youtube";
const YT = "https://www.googleapis.com/youtube/v3";

export function youtubeError(status: number, data: any): ProviderError {
  const reason: string = data?.error?.errors?.[0]?.reason ?? data?.error?.status ?? `HTTP_${status}`;
  const msg = `YouTube: ${data?.error?.message ?? reason}`;
  if (["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded"].includes(reason)) return new ProviderError(msg, P, reason, false, status, "rate_limit", data?.error);
  if (["rateLimitExceeded", "userRateLimitExceeded", "backendError"].includes(reason)) return new ProviderError(msg, P, reason, true, status, "rate_limit", data?.error);
  const c = classifyHttp(status);
  return new ProviderError(msg, P, reason, c.retryable, status, c.kind, data?.error);
}

function requireGoogle() {
  const e = env();
  if (!e.GOOGLE_OAUTH_CLIENT_ID || !e.GOOGLE_OAUTH_CLIENT_SECRET) throw new NotConfiguredError("YouTube (Google OAuth)", ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]);
  return { id: e.GOOGLE_OAUTH_CLIENT_ID, secret: e.GOOGLE_OAUTH_CLIENT_SECRET };
}

/**
 * YouTube Data API v3 – videos.insert (resumable upload).
 * Shorts: dikey (9:16) ve 3 dakikaya kadar videolar otomatik olarak Shorts kabul edilir.
 * Not: Denetlenmemiş (unverified) API projelerinden yüklenen videolar özel (private) moda kilitlenebilir;
 * herkese açık yayın için Google API denetimi (audit) gerekir.
 */
export class YouTubePublisher implements SocialPublisher {
  readonly platform = "YOUTUBE" as const;
  readonly requiredEnv = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"];
  readonly scopes = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

  isConfigured() {
    return !!(env().GOOGLE_OAUTH_CLIENT_ID && env().GOOGLE_OAUTH_CLIENT_SECRET);
  }

  connect({ state, redirectUri, codeChallenge }: { state: string; redirectUri: string; codeChallenge?: string }) {
    const { id } = requireGoogle();
    const qs = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    if (codeChallenge) {
      qs.set("code_challenge", codeChallenge);
      qs.set("code_challenge_method", "S256");
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
  }

  private async token(params: Record<string, string>): Promise<TokenSet> {
    const { id, secret } = requireGoogle();
    const { status, data } = await httpJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      provider: P,
      body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (status >= 400) {
      throw new ProviderError(`Google OAuth: ${data.error_description ?? data.error ?? status}`, P, String(data.error ?? `HTTP_${status}`), status >= 500, status, "auth");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? params.refresh_token ?? null,
      expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
      scopes: String(data.scope ?? "").split(" ").filter(Boolean),
    };
  }

  async handleCallback({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedAccount[]> {
    const t = await this.token({ code, grant_type: "authorization_code", redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
    const { status, data } = await httpJson(`${YT}/channels?part=snippet,statistics&mine=true`, { provider: P, headers: { Authorization: `Bearer ${t.accessToken}` } });
    if (status >= 400) throw youtubeError(status, data);
    return (data.items ?? []).map((c: any) => ({
      platform: "YOUTUBE" as const,
      externalId: c.id,
      displayName: c.snippet?.title ?? c.id,
      username: c.snippet?.customUrl ?? null,
      avatarUrl: c.snippet?.thumbnails?.default?.url ?? null,
      meta: { channelId: c.id },
      token: t,
    }));
  }

  async refreshToken(token: TokenSet) {
    if (!token.refreshToken) return null;
    return this.token({ grant_type: "refresh_token", refresh_token: token.refreshToken });
  }

  async getAccountInfo(account: SocialAccount, token: string) {
    const { status, data } = await httpJson(`${YT}/channels?part=snippet,statistics&id=${account.externalId}`, { provider: P, headers: { Authorization: `Bearer ${token}` } });
    if (status >= 400) throw youtubeError(status, data);
    const c = data.items?.[0];
    return { externalId: account.externalId, displayName: c?.snippet?.title ?? account.displayName, username: c?.snippet?.customUrl, avatarUrl: c?.snippet?.thumbnails?.default?.url, followers: c?.statistics?.hiddenSubscriberCount ? null : Number(c?.statistics?.subscriberCount ?? 0) };
  }

  validateMedia(media: Parameters<SocialPublisher["validateMedia"]>[0]) {
    // Shorts: en fazla 180 sn, kare veya dikey
    return baseValidate(media, { minDurationSec: 1, maxDurationSec: 180, maxSizeBytes: 256 * 1024 ** 3, aspect: "9:16" });
  }

  buildMetadata(ctx: PublishContext) {
    const o = ctx.options ?? {};
    let title = ctx.metadata.title.replace(/[<>]/g, "").slice(0, 100);
    if (!/#shorts/i.test(title) && title.length <= 92) title = `${title} #Shorts`;
    const publishAt = ctx.publishAt && ctx.publishAt.getTime() > Date.now() + 15 * 60_000 ? ctx.publishAt.toISOString() : undefined;
    return {
      snippet: {
        title,
        description: ctx.metadata.description.replace(/[<>]/g, "").slice(0, 5000),
        tags: ctx.metadata.tags.map((t) => t.replace(/^#/, "")).filter(Boolean).slice(0, 30),
        categoryId: String(o.categoryId ?? "22"),
        defaultLanguage: "tr",
        defaultAudioLanguage: "tr",
      },
      status: {
        // publishAt yalnızca privacyStatus=private iken geçerlidir
        privacyStatus: publishAt ? "private" : (o.privacyStatus ?? "public"),
        publishAt,
        selfDeclaredMadeForKids: !!o.madeForKids,
        containsSyntheticMedia: o.containsSyntheticMedia ?? ctx.media.containsAiImagery,
        embeddable: true,
        license: "youtube",
      },
    };
  }

  async publishVideo(ctx: PublishContext): Promise<PublishOutcome> {
    const filePath = await ctx.media.getLocalPath();
    const size = ctx.media.sizeBytes;
    let session = ctx.externalRef ?? null;
    if (session && session.startsWith("yt:")) {
      // Video daha önce yüklendi
      return this.getPublishStatus(ctx, session);
    }
    let offset = 0;
    if (session) {
      // Yarım kalan oturumun durumunu sorgula
      const r = await fetch(session, { method: "PUT", headers: { Authorization: `Bearer ${ctx.accessToken}`, "Content-Range": `bytes */${size}`, "Content-Length": "0" } });
      if (r.status === 200 || r.status === 201) return this.finish(ctx, await r.json());
      if (r.status === 308) {
        const range = r.headers.get("range");
        offset = range ? Number(range.split("-")[1]) + 1 : 0;
      } else session = null;
    }
    if (!session) {
      const meta = this.buildMetadata(ctx);
      const { status, data, headers } = await httpJson(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
        method: "POST",
        provider: P,
        headers: { Authorization: `Bearer ${ctx.accessToken}`, "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
        body: meta as any,
      });
      if (status >= 400) throw youtubeError(status, data);
      session = headers.get("location");
      if (!session) throw new ProviderError("YouTube yükleme oturumu alınamadı", P, "NO_SESSION", true);
      await ctx.saveRef(session);
    }
    const fh = await open(filePath, "r");
    try {
      const len = size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      const res = await fetch(session, {
        method: "PUT",
        headers: { Authorization: `Bearer ${ctx.accessToken}`, "Content-Type": "video/mp4", "Content-Length": String(len), ...(offset ? { "Content-Range": `bytes ${offset}-${size - 1}/${size}` } : {}) },
        body: buf,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.status >= 400) throw youtubeError(res.status, data);
      if (res.status === 308) throw new ProviderError("YouTube yüklemesi tamamlanmadı, devam edilecek", P, "UPLOAD_INCOMPLETE", true);
      return this.finish(ctx, data);
    } finally {
      await fh.close();
    }
  }

  private async finish(ctx: PublishContext, video: any): Promise<PublishOutcome> {
    const id = video.id as string;
    await ctx.saveRef(`yt:${id}`);
    const scheduled = !!video.status?.publishAt;
    const priv = video.status?.privacyStatus;
    return {
      state: scheduled ? "scheduled" : priv === "private" ? "private_only" : "published",
      externalPostId: id,
      postUrl: `https://www.youtube.com/shorts/${id}`,
      privacy: priv,
      ref: `yt:${id}`,
      raw: { id, status: video.status, uploadStatus: video.status?.uploadStatus },
    };
  }

  async getPublishStatus(ctx: Omit<PublishContext, "media" | "metadata" | "saveRef">, ref: string): Promise<PublishOutcome> {
    const id = ref.replace(/^yt:/, "");
    const { status, data } = await httpJson(`${YT}/videos?part=status,processingDetails&id=${id}`, { provider: P, headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    if (status >= 400) throw youtubeError(status, data);
    const v = data.items?.[0];
    if (!v) throw new ProviderError("YouTube videosu bulunamadı", P, "NOT_FOUND", false, 404, "validation");
    const st = v.status;
    if (st.uploadStatus === "rejected" || st.uploadStatus === "failed") {
      throw new ProviderError(`YouTube yükleme durumu: ${st.uploadStatus} (${st.rejectionReason ?? st.failureReason ?? ""})`, P, `UPLOAD_${st.uploadStatus}`, false, undefined, "validation", st);
    }
    return {
      state: st.publishAt ? "scheduled" : st.privacyStatus === "private" ? "private_only" : "published",
      externalPostId: id,
      postUrl: `https://www.youtube.com/shorts/${id}`,
      privacy: st.privacyStatus,
      ref,
      raw: { status: st, processing: v.processingDetails },
    };
  }

  async getAnalytics(_account: SocialAccount, token: string, videoId: string): Promise<PostMetrics> {
    const { status, data } = await httpJson(`${YT}/videos?part=statistics&id=${videoId}`, { provider: P, headers: { Authorization: `Bearer ${token}` } });
    if (status >= 400) throw youtubeError(status, data);
    const s = data.items?.[0]?.statistics;
    const n = (v: any) => (v === undefined ? null : Number(v));
    // Data API paylaşım/kaydetme metriği sağlamaz → null (tahmin edilmez)
    return { views: n(s?.viewCount), likes: n(s?.likeCount), comments: n(s?.commentCount), shares: null, saves: null, reach: null, raw: s };
  }

  async getFollowers(account: SocialAccount, token: string) {
    return (await this.getAccountInfo(account, token)).followers ?? null;
  }

  async disconnect(_account: SocialAccount, token: string) {
    await httpJson(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", provider: P, headers: { "Content-Type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
  }
}
