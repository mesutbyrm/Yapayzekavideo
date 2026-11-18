import type { SocialAccount } from "../../src/lib/db";
import type { PublishContext, PublishOutcome, SocialPublisher, TokenSet } from "../../src/publishers/types";
import type { Platform } from "../../src/lib/db";

/**
 * MOCK yayın servisi – yalnızca testlerde kullanılır.
 * Gerçek platforma hiçbir istek göndermez; davranışı test tarafından belirlenir.
 */
export class MockPublisher implements SocialPublisher {
  readonly requiredEnv: string[] = [];
  readonly scopes: string[] = [];
  calls: PublishContext[] = [];
  refreshCalls = 0;
  configured = true;
  next: (ctx: PublishContext) => Promise<PublishOutcome> = async () => ({ state: "published", externalPostId: `mock-${this.platform}-${this.calls.length}`, postUrl: `https://example.invalid/${this.platform}/${this.calls.length}`, privacy: "PUBLIC" });
  refresh: (t: TokenSet) => Promise<TokenSet | null> = async () => null;

  constructor(readonly platform: Platform) {}
  isConfigured() { return this.configured; }
  connect() { return "https://example.invalid/oauth"; }
  async handleCallback() { return []; }
  async refreshToken(t: TokenSet) { this.refreshCalls++; return this.refresh(t); }
  async getAccountInfo(account: SocialAccount) { return { externalId: account.externalId, displayName: account.displayName, followers: null }; }
  validateMedia() { return []; }
  async publishVideo(ctx: PublishContext) { this.calls.push(ctx); return this.next(ctx); }
  async getPublishStatus(_ctx: any, ref: string): Promise<PublishOutcome> { return { state: "published", externalPostId: ref }; }
  async getAnalytics() { return { views: null, likes: null, comments: null, shares: null, saves: null, reach: null }; }
  async disconnect() {}
}
