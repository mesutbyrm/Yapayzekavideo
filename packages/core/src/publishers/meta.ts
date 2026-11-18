import { env } from "../lib/env";
import { httpJson } from "../lib/http";
import { NotConfiguredError, ProviderError } from "../lib/errors";
import type { ConnectedAccount, TokenSet } from "./types";

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
];

export function graph(path: string) {
  return `https://graph.facebook.com/${env().META_GRAPH_VERSION}${path.startsWith("/") ? path : `/${path}`}`;
}

export function metaConfigured() {
  return !!(env().META_APP_ID && env().META_APP_SECRET);
}

function requireMeta() {
  if (!metaConfigured()) throw new NotConfiguredError("Meta (Facebook/Instagram)", ["META_APP_ID", "META_APP_SECRET"]);
  return { id: env().META_APP_ID!, secret: env().META_APP_SECRET! };
}

/**
 * Meta Graph API hata sınıflandırması.
 * https://developers.facebook.com/docs/graph-api/guides/error-handling
 */
export function metaError(provider: string, status: number, data: any): ProviderError {
  const e = data?.error ?? {};
  const code = Number(e.code);
  const sub = e.error_subcode ? `/${e.error_subcode}` : "";
  const msg = `${provider}: ${e.message ?? `HTTP ${status}`}`;
  // 190 = geçersiz/süresi dolmuş token, 102 = oturum, 10/200-299 = izin
  if (code === 190 || code === 102 || status === 401) return new ProviderError(msg, provider, `META_${code}${sub}`, false, status, "auth", e);
  if (code === 10 || (code >= 200 && code < 300)) return new ProviderError(msg, provider, `META_${code}${sub}`, false, status, "policy", e);
  // 4, 17, 32, 613 = hız sınırı; 9 = yayın kotası (24 saat)
  if ([4, 17, 32, 613, 80001, 80002].includes(code) || status === 429) return new ProviderError(msg, provider, `META_${code}${sub}`, true, status, "rate_limit", e);
  if (code === 9 || code === 2207042) return new ProviderError(msg, provider, `META_${code}${sub}`, false, status, "rate_limit", e);
  if (code === 1 || code === 2 || e.is_transient || status >= 500) return new ProviderError(msg, provider, `META_${code}${sub}`, true, status, "transient", e);
  if (code === 100 || status === 400) return new ProviderError(msg, provider, `META_${code}${sub}`, false, status, "validation", e);
  return new ProviderError(msg, provider, `META_${code || status}${sub}`, status >= 500, status, "unknown", e);
}

export async function metaGet(provider: string, path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const { status, data } = await httpJson(`${graph(path)}?${qs}`, { provider });
  if (status >= 400 || data?.error) throw metaError(provider, status, data);
  return data;
}

export async function metaPost(provider: string, path: string, params: Record<string, string | undefined>, token: string) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  body.set("access_token", token);
  const { status, data } = await httpJson(graph(path), { method: "POST", body, provider, timeoutMs: 60_000 });
  if (status >= 400 || data?.error) throw metaError(provider, status, data);
  return data;
}

export function metaAuthUrl(state: string, redirectUri: string) {
  const { id } = requireMeta();
  const qs = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, state, response_type: "code", scope: META_SCOPES.join(",") });
  return `https://www.facebook.com/${env().META_GRAPH_VERSION}/dialog/oauth?${qs}`;
}

/**
 * Kod → kısa ömürlü kullanıcı token'ı → uzun ömürlü kullanıcı token'ı → Sayfa token'ları.
 * Uzun ömürlü kullanıcı token'ından türetilen Sayfa token'larının süresi dolmaz
 * (kullanıcı şifre değiştirirse/izin kaldırırsa geçersizleşir; düzenli kontrol edilir).
 */
export async function metaExchange(code: string, redirectUri: string): Promise<ConnectedAccount[]> {
  const { id, secret } = requireMeta();
  const q1 = new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: redirectUri, code });
  const r1 = await httpJson(`${graph("/oauth/access_token")}?${q1}`, { provider: "meta" });
  if (r1.status >= 400) throw metaError("meta", r1.status, r1.data);
  const q2 = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: r1.data.access_token });
  const r2 = await httpJson(`${graph("/oauth/access_token")}?${q2}`, { provider: "meta" });
  if (r2.status >= 400) throw metaError("meta", r2.status, r2.data);
  const userToken: string = r2.data.access_token;

  const perms = await metaGet("meta", "/me/permissions", {}, userToken);
  const granted: string[] = (perms.data ?? []).filter((p: any) => p.status === "granted").map((p: any) => p.permission);

  const pages = await metaGet("meta", "/me/accounts", { fields: "id,name,access_token,picture{url},tasks,instagram_business_account{id,username,name,profile_picture_url}", limit: "100" }, userToken);
  const out: ConnectedAccount[] = [];
  for (const p of pages.data ?? []) {
    if (!p.access_token) continue;
    const token: TokenSet = { accessToken: p.access_token, expiresAt: null, scopes: granted, tokenType: "page" };
    out.push({
      platform: "FACEBOOK",
      externalId: p.id,
      displayName: p.name,
      avatarUrl: p.picture?.data?.url ?? null,
      meta: { pageId: p.id, tasks: p.tasks ?? [] },
      token,
    });
    const ig = p.instagram_business_account;
    if (ig?.id) {
      out.push({
        platform: "INSTAGRAM",
        externalId: ig.id,
        displayName: ig.name ?? ig.username ?? ig.id,
        username: ig.username ?? null,
        avatarUrl: ig.profile_picture_url ?? null,
        meta: { igUserId: ig.id, pageId: p.id },
        token,
      });
    }
  }
  return out;
}

/** Token geçerliliği (debug_token) */
export async function metaDebugToken(token: string) {
  const { id, secret } = requireMeta();
  const qs = new URLSearchParams({ input_token: token, access_token: `${id}|${secret}` });
  const { status, data } = await httpJson(`${graph("/debug_token")}?${qs}`, { provider: "meta" });
  if (status >= 400) throw metaError("meta", status, data);
  return data.data as { is_valid: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[] };
}
