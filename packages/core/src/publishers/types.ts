import type { Platform, SocialAccount } from "../lib/db";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  scopes?: string[];
  tokenType?: string;
}

export interface ConnectedAccount {
  platform: Platform;
  externalId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  meta?: Record<string, unknown>;
  token: TokenSet;
}

export interface PublishMedia {
  /** Platformun çekebileceği herkese açık URL (Instagram, Facebook) */
  publicUrl: string;
  /** Yerel dosya (TikTok FILE_UPLOAD, YouTube resumable) – gerektiğinde indirilir */
  getLocalPath: () => Promise<string>;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  containsAiImagery: boolean;
}

export interface PublishMetadata {
  title: string;
  caption: string;
  description: string;
  tags: string[];
  hashtags: string[];
}

export interface PublishContext {
  account: SocialAccount;
  accessToken: string;
  media: PublishMedia;
  metadata: PublishMetadata;
  /** Platforma özel seçenekler (ör. TikTok privacy_level, YouTube privacyStatus) */
  options: Record<string, any>;
  /** Daha önceki denemeden kalan platform referansı (container id, upload session vb.) */
  externalRef?: string | null;
  /** Referansı kalıcı olarak kaydet (yarıda kalan işlemleri tekrar göndermemek için) */
  saveRef: (ref: string) => Promise<void>;
  publishAt?: Date | null;
}

export type PublishState = "published" | "processing" | "scheduled" | "private_only";

export interface PublishOutcome {
  state: PublishState;
  externalPostId?: string | null;
  postUrl?: string | null;
  privacy?: string | null;
  ref?: string | null;
  raw?: unknown;
}

export interface AccountInfo {
  externalId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  followers?: number | null;
  meta?: Record<string, unknown>;
}

export interface PostMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  raw?: unknown;
}

export interface MediaRules {
  minDurationSec: number;
  maxDurationSec: number;
  maxSizeBytes: number;
  aspect: "9:16";
}

export interface SocialPublisher {
  readonly platform: Platform;
  readonly requiredEnv: string[];
  readonly scopes: string[];
  isConfigured(): boolean;
  /** OAuth yetkilendirme URL'si */
  connect(params: { state: string; redirectUri: string; codeChallenge?: string }): string;
  /** OAuth callback: kodu token ile değiştirir ve bağlanabilir hesapları döndürür */
  handleCallback(params: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedAccount[]>;
  refreshToken(token: TokenSet): Promise<TokenSet | null>;
  getAccountInfo(account: SocialAccount, accessToken: string): Promise<AccountInfo>;
  validateMedia(media: Pick<PublishMedia, "sizeBytes" | "durationSec" | "width" | "height" | "fps">, account: SocialAccount): string[];
  publishVideo(ctx: PublishContext): Promise<PublishOutcome>;
  getPublishStatus(ctx: Omit<PublishContext, "media" | "metadata" | "saveRef">, ref: string): Promise<PublishOutcome>;
  getAnalytics(account: SocialAccount, accessToken: string, externalPostId: string): Promise<PostMetrics>;
  getFollowers?(account: SocialAccount, accessToken: string): Promise<number | null>;
  disconnect(account: SocialAccount, accessToken: string): Promise<void>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function baseValidate(media: Pick<PublishMedia, "sizeBytes" | "durationSec" | "width" | "height" | "fps">, rules: MediaRules): string[] {
  const errs: string[] = [];
  if (media.durationSec < rules.minDurationSec) errs.push(`Süre en az ${rules.minDurationSec} sn olmalı`);
  if (media.durationSec > rules.maxDurationSec) errs.push(`Süre en fazla ${rules.maxDurationSec} sn olmalı`);
  if (media.sizeBytes > rules.maxSizeBytes) errs.push(`Dosya en fazla ${Math.round(rules.maxSizeBytes / 1024 / 1024)} MB olmalı`);
  if (Math.abs(media.width / media.height - 9 / 16) > 0.01) errs.push("En-boy oranı 9:16 olmalı");
  if (media.fps < 23 || media.fps > 60) errs.push("Kare hızı 23-60 FPS arasında olmalı");
  return errs;
}
