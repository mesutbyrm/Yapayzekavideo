/**
 * Platform yayın servisleri – MOCK fetch ile akış testleri.
 * Bu testler gerçek platformlara bağlanmaz; istek sırasını, parametreleri ve hata sınıflandırmasını doğrular.
 * Gerçek yayın için platform uygulama onayı ve geçerli OAuth token'ı gereklidir.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InstagramPublisher } from "../../src/publishers/instagram";
import { FacebookPublisher } from "../../src/publishers/facebook";
import { TikTokPublisher } from "../../src/publishers/tiktok";
import { YouTubePublisher } from "../../src/publishers/youtube";
import { metaError } from "../../src/publishers/meta";
import { resetEnvCache } from "../../src/lib/env";
import type { PublishContext } from "../../src/publishers/types";
import { mockFetch } from "../helpers/mock-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TIKTOK_DIRECT_POST_AUDITED;
  resetEnvCache();
});

async function ctx(over: Partial<PublishContext> = {}): Promise<PublishContext & { refs: string[] }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "asf-pub-"));
  const file = path.join(dir, "v.mp4");
  await writeFile(file, Buffer.alloc(2048, 1));
  const refs: string[] = [];
  return {
    account: { id: "acc", brandId: "b", externalId: "EXT1", username: "kanal", displayName: "Kanal", meta: {} } as any,
    accessToken: "TEST_TOKEN",
    media: { publicUrl: "https://media.example.invalid/v.mp4", getLocalPath: async () => file, sizeBytes: 2048, durationSec: 24, width: 1080, height: 1920, fps: 30, containsAiImagery: false },
    metadata: { title: "Başlık", caption: "Açıklama #bilgi", description: "Açıklama", tags: ["bilgi"], hashtags: ["#bilgi"] },
    options: {},
    externalRef: null,
    saveRef: async (r: string) => { refs.push(r); },
    publishAt: null,
    refs,
    ...over,
  } as any;
}

describe("Instagram Reels (MOCK)", () => {
  it("container oluşturur, durumu bekler, media_publish ile yayınlar", async () => {
    let polls = 0;
    const calls = mockFetch((c) => {
      if (c.url.includes("/content_publishing_limit")) return { json: { data: [{ quota_usage: 1, config: { quota_total: 100 } }] } };
      if (c.method === "POST" && c.url.endsWith("/EXT1/media")) return { json: { id: "CONT1" } };
      if (c.url.includes("/CONT1?")) return { json: { status_code: polls++ < 1 ? "IN_PROGRESS" : "FINISHED" } };
      if (c.url.endsWith("/EXT1/media_publish")) return { json: { id: "MEDIA9" } };
      if (c.url.includes("/MEDIA9?")) return { json: { id: "MEDIA9", permalink: "https://www.instagram.com/reel/abc/" } };
    });
    const p = new InstagramPublisher();
    p.pollIntervalMs = 1;
    const c = await ctx();
    const out = await p.publishVideo(c);
    expect(out.state).toBe("published");
    expect(out.externalPostId).toBe("MEDIA9");
    expect(c.refs).toEqual(["CONT1"]);
    const create = calls.find((x) => x.url.endsWith("/EXT1/media"))!;
    expect(create.body.media_type).toBe("REELS");
    expect(create.body.video_url).toBe("https://media.example.invalid/v.mp4");
    expect(calls.every((x) => x.url.startsWith("https://graph.facebook.com/v"))).toBe(true);
  });
  it("kayıtlı container zaten yayınlanmışsa ikinci kez yayınlamaz (çift yayın engeli)", async () => {
    const calls = mockFetch((c) => {
      if (c.url.includes("/CONT1?")) return { json: { status_code: "PUBLISHED" } };
      if (c.url.includes("/EXT1/media?")) return { json: { data: [{ id: "M1", caption: "Açıklama #bilgi", permalink: "https://www.instagram.com/reel/x/" }] } };
    });
    const out = await new InstagramPublisher().publishVideo(await ctx({ externalRef: "CONT1" }));
    expect(out.externalPostId).toBe("M1");
    expect(calls.some((x) => x.url.includes("media_publish"))).toBe(false);
  });
  it("kota dolunca yeniden denenebilir hız sınırı hatası verir", async () => {
    mockFetch((c) => (c.url.includes("content_publishing_limit") ? { json: { data: [{ quota_usage: 100, config: { quota_total: 100 } }] } } : undefined));
    await expect(new InstagramPublisher().publishVideo(await ctx())).rejects.toMatchObject({ code: "IG_QUOTA", retryable: true, kind: "rate_limit" });
  });
});

describe("Meta hata sınıflandırması", () => {
  it("190 → auth (yeniden denenmez), 4 → hız sınırı (yeniden denenir), 1 → geçici", () => {
    expect(metaError("instagram", 400, { error: { code: 190 } })).toMatchObject({ kind: "auth", retryable: false });
    expect(metaError("instagram", 400, { error: { code: 4 } })).toMatchObject({ kind: "rate_limit", retryable: true });
    expect(metaError("instagram", 500, { error: { code: 1 } })).toMatchObject({ kind: "transient", retryable: true });
    expect(metaError("instagram", 400, { error: { code: 100 } })).toMatchObject({ kind: "validation", retryable: false });
  });
});

describe("Facebook Reels (MOCK)", () => {
  it("start → rupload (file_url) → finish(PUBLISHED) → durum", async () => {
    const calls = mockFetch((c) => {
      if (c.method === "POST" && c.url.endsWith("/EXT1/video_reels") && c.body?.upload_phase === "start") return { json: { video_id: "V1", upload_url: "https://rupload.facebook.com/video-upload/v26.0/V1" } };
      if (c.url.startsWith("https://rupload.facebook.com")) return { json: { success: true } };
      if (c.method === "POST" && c.body?.upload_phase === "finish") return { json: { success: true } };
      if (c.url.includes("/V1?")) return { json: { status: { video_status: "ready", publishing_phase: { status: "complete" } } } };
    });
    const p = new FacebookPublisher();
    p.pollIntervalMs = 1;
    const out = await p.publishVideo(await ctx());
    expect(out).toMatchObject({ state: "published", externalPostId: "V1" });
    const up = calls.find((x) => x.url.startsWith("https://rupload"))!;
    expect(up.headers["file_url"]).toBe("https://media.example.invalid/v.mp4");
    expect(up.headers["authorization"]).toBe("OAuth TEST_TOKEN");
    expect(calls.find((x) => x.body?.upload_phase === "finish")!.body.video_state).toBe("PUBLISHED");
  });
});

describe("TikTok Direct Post (MOCK)", () => {
  const consent = { consentGivenAt: new Date().toISOString(), privacyLevel: "SELF_ONLY", musicConfirmation: true };
  it("kullanıcı onayı olmadan yayınlamaz", async () => {
    mockFetch(() => undefined);
    await expect(new TikTokPublisher().publishVideo(await ctx())).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });
  it("denetlenmemiş uygulamada herkese açık paylaşımı engeller", async () => {
    mockFetch(() => undefined);
    await expect(new TikTokPublisher().publishVideo(await ctx({ options: { ...consent, privacyLevel: "PUBLIC_TO_EVERYONE" } }))).rejects.toMatchObject({ code: "unaudited_client_can_only_post_to_private_accounts" });
  });
  it("creator_info → init (FILE_UPLOAD) → PUT → status/fetch", async () => {
    let n = 0;
    const calls = mockFetch((c) => {
      if (c.url.endsWith("/creator_info/query/")) return { json: { data: { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], max_video_post_duration_sec: 600, comment_disabled: false, duet_disabled: true, stitch_disabled: false }, error: { code: "ok" } } };
      if (c.url.endsWith("/video/init/")) return { json: { data: { publish_id: "PUB1", upload_url: "https://open-upload.tiktokapis.com/upload/x" }, error: { code: "ok" } } };
      if (c.url.startsWith("https://open-upload.tiktokapis.com")) return { status: 201 };
      if (c.url.endsWith("/status/fetch/")) return { json: { data: n++ ? { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] } : { status: "PROCESSING_UPLOAD" }, error: { code: "ok" } } };
    });
    const p = new TikTokPublisher();
    p.pollIntervalMs = 1;
    const c = await ctx({ options: consent });
    const out = await p.publishVideo(c);
    // SELF_ONLY gönderilerde herkese açık gönderi kimliği dönmez → private_only
    expect(out.state).toBe("private_only");
    expect(c.refs).toEqual(["PUB1"]);
    const init = calls.find((x) => x.url.endsWith("/video/init/"))!;
    expect(init.body.source_info).toMatchObject({ source: "FILE_UPLOAD", video_size: 2048, chunk_size: 2048, total_chunk_count: 1 });
    expect(init.body.post_info.privacy_level).toBe("SELF_ONLY");
    expect(init.body.post_info.disable_duet).toBe(true); // creator ayarına uyulur
    const put = calls.find((x) => x.method === "PUT")!;
    expect(put.headers["content-range"]).toBe("bytes 0-2047/2048");
  });
  it("hesabın desteklemediği gizlilik seviyesini reddeder", async () => {
    process.env.TIKTOK_DIRECT_POST_AUDITED = "true";
    resetEnvCache();
    mockFetch((c) => (c.url.endsWith("/creator_info/query/") ? { json: { data: { privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } } } : undefined));
    await expect(new TikTokPublisher().publishVideo(await ctx({ options: { ...consent, privacyLevel: "PUBLIC_TO_EVERYONE" } }))).rejects.toMatchObject({ code: "privacy_level_option_mismatch" });
  });
});

describe("YouTube Shorts (MOCK)", () => {
  it("resumable upload oturumu açar, yükler ve yt:<id> referansını kaydeder", async () => {
    const calls = mockFetch((c) => {
      if (c.method === "POST" && c.url.includes("uploadType=resumable")) return { json: {}, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1" } };
      if (c.method === "PUT" && c.url.includes("upload_id=U1")) return { json: { id: "YT1", status: { privacyStatus: "public" } } };
    });
    const c = await ctx({ options: { containsSyntheticMedia: true } });
    const out = await new YouTubePublisher().publishVideo(c);
    expect(out).toMatchObject({ state: "published", externalPostId: "YT1", postUrl: "https://www.youtube.com/shorts/YT1" });
    expect(c.refs).toEqual(["https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1", "yt:YT1"]);
    const meta = calls[0].body;
    expect(meta.snippet.title).toContain("#Shorts");
    expect(meta.status.containsSyntheticMedia).toBe(true);
  });
  it("ileri tarihli yayın: publishAt + private", async () => {
    const c = await ctx({ publishAt: new Date(Date.now() + 3 * 3600_000) });
    const m = new YouTubePublisher().buildMetadata(c);
    expect(m.status.privacyStatus).toBe("private");
    expect(m.status.publishAt).toBeDefined();
  });
  it("zaten yüklenmiş videoyu tekrar yüklemez", async () => {
    const calls = mockFetch((c) => (c.url.includes("/youtube/v3/videos?") && c.method === "GET" ? { json: { items: [{ id: "YT1", status: { privacyStatus: "public", uploadStatus: "processed" } }] } } : undefined));
    await new YouTubePublisher().publishVideo(await ctx({ externalRef: "yt:YT1" })).catch(() => null);
    expect(calls.some((x) => x.method === "PUT" || x.method === "POST")).toBe(false);
  });
  it("kota aşımı yeniden denenmez", async () => {
    mockFetch(() => ({ status: 403, json: { error: { errors: [{ reason: "quotaExceeded" }], message: "quota" } } }));
    await expect(new YouTubePublisher().publishVideo(await ctx())).rejects.toMatchObject({ code: "quotaExceeded", retryable: false });
  });
});
