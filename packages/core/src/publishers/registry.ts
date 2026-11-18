import type { Platform } from "../lib/db";
import { FacebookPublisher } from "./facebook";
import { InstagramPublisher } from "./instagram";
import { TikTokPublisher } from "./tiktok";
import { YouTubePublisher } from "./youtube";
import type { SocialPublisher } from "./types";

const instances = new Map<Platform, SocialPublisher>();

export function publisherFor(platform: Platform): SocialPublisher {
  let p = instances.get(platform);
  if (!p) {
    p = platform === "INSTAGRAM" ? new InstagramPublisher() : platform === "FACEBOOK" ? new FacebookPublisher() : platform === "TIKTOK" ? new TikTokPublisher() : new YouTubePublisher();
    instances.set(platform, p);
  }
  return p;
}

/** Testlerde sahte publisher enjekte etmek için */
export function setPublisher(platform: Platform, p: SocialPublisher | null) {
  if (p) instances.set(platform, p);
  else instances.delete(platform);
}

export const ALL_PLATFORMS: Platform[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"];

export function platformStatus() {
  return ALL_PLATFORMS.map((pl) => {
    const p = publisherFor(pl);
    return { platform: pl, configured: p.isConfigured(), requiredEnv: p.requiredEnv, scopes: p.scopes };
  });
}
