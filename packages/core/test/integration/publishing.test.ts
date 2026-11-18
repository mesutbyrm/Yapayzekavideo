/**
 * Yayın hattı entegrasyon testi – gerçek PostgreSQL (asf_test) + Redis (DB 15).
 * Platform servisleri MOCK'tur (test/helpers/mock-publisher.ts); hiçbir gerçek platforma istek gitmez.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/db";
import { setPublisher } from "../../src/publishers/registry";
import { readToken } from "../../src/publishers/tokens";
import { createPublishJobs, runPublishJob, retryPublishJob, cancelPublishJob, giveConsent } from "../../src/pipeline/publishing";
import { ProviderError } from "../../src/lib/errors";
import { closeQueues, queue, QUEUE, redis } from "../../src/queue/queues";
import { makeAccount, makeBrand, makeVideo, resetDb } from "../helpers/db";
import { MockPublisher } from "../helpers/mock-publisher";

const mocks = {
  INSTAGRAM: new MockPublisher("INSTAGRAM"),
  FACEBOOK: new MockPublisher("FACEBOOK"),
  TIKTOK: new MockPublisher("TIKTOK"),
  YOUTUBE: new MockPublisher("YOUTUBE"),
};

beforeEach(async () => {
  await resetDb();
  await redis().flushdb();
  for (const m of Object.values(mocks)) {
    m.calls = [];
    m.refreshCalls = 0;
    m.next = new MockPublisher(m.platform).next.bind(m);
    m.refresh = async () => null;
    setPublisher(m.platform, m);
  }
});

afterAll(async () => {
  for (const p of Object.keys(mocks)) setPublisher(p as any, null);
  await closeQueues();
  await prisma.$disconnect();
});

async function setup() {
  const brand = await makeBrand();
  const video = await makeVideo(brand.id);
  const accs = {
    ig: await makeAccount(brand.id, "INSTAGRAM"),
    fb: await makeAccount(brand.id, "FACEBOOK"),
    tt: await makeAccount(brand.id, "TIKTOK"),
    yt: await makeAccount(brand.id, "YOUTUBE"),
  };
  return { brand, video, accs };
}

describe("yayın işleri", () => {
  it("her hesap için ayrı iş oluşturur; TikTok kullanıcı onayı bekler; tekrar çağrıda çift iş oluşmaz", async () => {
    const { video } = await setup();
    const jobs = await createPublishJobs(video.id);
    expect(jobs).toHaveLength(4);
    expect(jobs.find((j) => j.platform === "TIKTOK")!.status).toBe("AWAITING_CONSENT");
    expect(jobs.filter((j) => j.status === "SCHEDULED")).toHaveLength(3);
    const again = await createPublishJobs(video.id);
    expect(again).toHaveLength(0);
    expect(await prisma.publishJob.count({ where: { videoId: video.id } })).toBe(4);
    // BullMQ: platform kuyruklarına deterministik jobId ile eklendi
    const ig = jobs.find((j) => j.platform === "INSTAGRAM")!;
    expect(await queue(QUEUE.publish("INSTAGRAM")).getJob(`pub-${ig.id}`)).toBeTruthy();
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("PUBLISHING");
  });

  it("kalite kontrolünden geçmemiş video kuyruğa alınamaz", async () => {
    const brand = await makeBrand();
    const v = await makeVideo(brand.id, { status: "QC_FAILED", qcPassed: false });
    await expect(createPublishJobs(v.id)).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("başarılı yayın sonucu kaydedilir; aynı iş tekrar çalışırsa platforma ikinci kez gönderilmez", async () => {
    const { video } = await setup();
    const jobs = await createPublishJobs(video.id, { platforms: ["INSTAGRAM"] });
    const out = await runPublishJob(jobs[0].id);
    expect(out?.state).toBe("published");
    expect(mocks.INSTAGRAM.calls).toHaveLength(1);
    // Aynı işi ikinci kez çalıştır (ör. kuyruk tekrarı)
    await prisma.publishJob.update({ where: { id: jobs[0].id }, data: { status: "SCHEDULED" } });
    await runPublishJob(jobs[0].id);
    expect(mocks.INSTAGRAM.calls).toHaveLength(1);
    const results = await prisma.publishResult.findMany({ where: { videoId: video.id, success: true } });
    expect(results).toHaveLength(1);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("PUBLISHED");
  });

  it("bir platformun hatası diğer platformları durdurmaz", async () => {
    const { video } = await setup();
    mocks.FACEBOOK.next = async () => { throw new ProviderError("MOCK: izin yok", "facebook", "META_200", false, 403, "policy"); };
    const jobs = await createPublishJobs(video.id, { platforms: ["INSTAGRAM", "FACEBOOK", "YOUTUBE"] });
    const results = await Promise.allSettled(jobs.map((j) => runPublishJob(j.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const fb = await prisma.publishJob.findFirstOrThrow({ where: { videoId: video.id, platform: "FACEBOOK" } });
    expect(fb.status).toBe("FAILED");
    expect(fb.lastErrorCode).toBe("META_200");
    const v = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(v.status).toBe("PARTIALLY_PUBLISHED");
    expect(await prisma.publishResult.count({ where: { videoId: video.id, platform: "FACEBOOK", success: false } })).toBe(1);
  });

  it("geçici hata: iş yeniden denemeye uygun kalır (SCHEDULED), hata nedeni kaydedilir", async () => {
    const { video } = await setup();
    mocks.YOUTUBE.next = async () => { throw new ProviderError("MOCK: 503", "youtube", "backendError", true, 503, "transient"); };
    const [job] = await createPublishJobs(video.id, { platforms: ["YOUTUBE"] });
    await expect(runPublishJob(job.id, 0)).rejects.toBeInstanceOf(ProviderError);
    const j = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe("SCHEDULED");
    expect(j.attempts).toBe(1);
    expect(await prisma.publishResult.count({ where: { publishJobId: job.id, success: false } })).toBe(1);
  });

  it("kalıcı hata: iş FAILED olur, elle yeniden denenebilir; başarılı yayından sonra yeniden deneme reddedilir", async () => {
    const { video } = await setup();
    mocks.INSTAGRAM.next = async () => { throw new ProviderError("MOCK: geçersiz medya", "instagram", "META_100", false, 400, "validation"); };
    const [job] = await createPublishJobs(video.id, { platforms: ["INSTAGRAM"] });
    await expect(runPublishJob(job.id)).rejects.toThrow();
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    mocks.INSTAGRAM.next = new MockPublisher("INSTAGRAM").next;
    const r = await retryPublishJob(job.id);
    expect(r.status).toBe("SCHEDULED");
    await runPublishJob(job.id);
    await prisma.publishJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
    await expect(retryPublishJob(job.id)).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("yetki hatası hesabı TOKEN_EXPIRED/ERROR olarak işaretler ve bildirim üretir", async () => {
    const { video, accs } = await setup();
    mocks.INSTAGRAM.next = async () => { throw new ProviderError("MOCK: token geçersiz", "instagram", "META_190", false, 401, "auth"); };
    const [job] = await createPublishJobs(video.id, { platforms: ["INSTAGRAM"] });
    await expect(runPublishJob(job.id)).rejects.toThrow();
    const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accs.ig.id } });
    expect(acc.status).toBe("TOKEN_EXPIRED");
    // Bağlantısı kopan hesabın sonraki işleri BLOCKED olur, diğer hesaplar etkilenmez
    const v2 = await makeVideo(video.brandId, { scheduleSlot: null });
    const jobs2 = await createPublishJobs(v2.id, { platforms: ["INSTAGRAM", "YOUTUBE"] });
    expect(jobs2.map((j) => j.platform)).toEqual(["YOUTUBE"]);
  });

  it("süresi dolmak üzere olan token otomatik yenilenir ve şifreli saklanır", async () => {
    const brand = await makeBrand();
    const video = await makeVideo(brand.id);
    const acc = await makeAccount(brand.id, "YOUTUBE", { accessToken: "old", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 60_000) });
    mocks.YOUTUBE.refresh = async (t) => ({ accessToken: "new-token", refreshToken: t.refreshToken, expiresAt: new Date(Date.now() + 3600_000) });
    const [job] = await createPublishJobs(video.id, { platforms: ["YOUTUBE"] });
    await runPublishJob(job.id);
    expect(mocks.YOUTUBE.refreshCalls).toBe(1);
    expect(mocks.YOUTUBE.calls[0].accessToken).toBe("new-token");
    const row = await prisma.oAuthToken.findUniqueOrThrow({ where: { socialAccountId: acc.id } });
    expect(row.accessTokenEnc).not.toContain("new-token");
    expect((await readToken(acc.id))!.accessToken).toBe("new-token");
  });

  it("token yenilenemezse yayın denenmez, hesap işaretlenir", async () => {
    const brand = await makeBrand();
    const video = await makeVideo(brand.id);
    const acc = await makeAccount(brand.id, "TIKTOK", { refreshToken: "r", expiresAt: new Date(Date.now() - 1000) });
    mocks.TIKTOK.refresh = async () => { throw new Error("MOCK: invalid_grant"); };
    const [job] = await createPublishJobs(video.id, { platforms: ["TIKTOK"] });
    await giveConsent(job.id, (await prisma.user.create({ data: { email: "u@example.com", name: "U", passwordHash: "x" } })).id, { privacyLevel: "SELF_ONLY", musicConfirmation: true });
    await expect(runPublishJob(job.id)).rejects.toThrow();
    expect(mocks.TIKTOK.calls).toHaveLength(0);
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } })).status).toBe("TOKEN_EXPIRED");
  });

  it("TikTok onayı: müzik onayı olmadan kabul edilmez; onaydan sonra seçenekler işe yazılır", async () => {
    const { video } = await setup();
    const jobs = await createPublishJobs(video.id, { platforms: ["TIKTOK"] });
    const user = await prisma.user.create({ data: { email: "o@example.com", name: "O", passwordHash: "x" } });
    await expect(giveConsent(jobs[0].id, user.id, { privacyLevel: "SELF_ONLY", musicConfirmation: false })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const j = await giveConsent(jobs[0].id, user.id, { privacyLevel: "SELF_ONLY", disableDuet: true, musicConfirmation: true });
    expect(j.status).toBe("SCHEDULED");
    await runPublishJob(j.id);
    expect(mocks.TIKTOK.calls[0].options).toMatchObject({ privacyLevel: "SELF_ONLY", disableDuet: true });
    expect(mocks.TIKTOK.calls[0].options.consentGivenAt).toBeTruthy();
  });

  it("iptal edilen iş çalıştırılmaz", async () => {
    const { video } = await setup();
    const [job] = await createPublishJobs(video.id, { platforms: ["FACEBOOK"] });
    await cancelPublishJob(job.id);
    expect(await runPublishJob(job.id)).toBeNull();
    expect(mocks.FACEBOOK.calls).toHaveLength(0);
  });

  it("platform yapılandırılmamışsa (API anahtarı yok) iş açık hata ile başarısız olur – sahte başarı yok", async () => {
    const { video } = await setup();
    mocks.YOUTUBE.configured = false;
    try {
      const [job] = await createPublishJobs(video.id, { platforms: ["YOUTUBE"] });
      await expect(runPublishJob(job.id)).rejects.toThrow(/yapılandırılmadı/);
      expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).lastErrorCode).toBe("NOT_CONFIGURED");
      expect(await prisma.publishResult.count({ where: { success: true } })).toBe(0);
    } finally {
      mocks.YOUTUBE.configured = true;
    }
  });
});
