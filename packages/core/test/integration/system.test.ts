/**
 * Bütçe, üretim limitleri, zamanlayıcı, oturum güvenliği ve depolama – gerçek PostgreSQL + Redis.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import { prisma } from "../../src/lib/db";
import { setSetting } from "../../src/lib/settings";
import { assertCanSpend, budgetStatus, recordUsage } from "../../src/budget/budget";
import { BudgetExceededError } from "../../src/lib/errors";
import { generationLimits } from "../../src/pipeline/limits";
import { enqueueGeneration } from "../../src/pipeline/generate";
import { ensureDefaultSchedules, schedulerTick } from "../../src/pipeline/scheduler";
import { createSession, getSessionByToken, login, logout } from "../../src/auth/session";
import { hashPassword } from "../../src/auth/password";
import { storage, verifyMediaSignature, LocalDriver } from "../../src/storage";
import { closeQueues, redis } from "../../src/queue/queues";
import { makeBrand, makeVideo, resetDb } from "../helpers/db";

beforeEach(async () => {
  await resetDb();
  await redis().flushdb();
});
afterAll(async () => {
  await closeQueues();
});

describe("bütçe kontrolü", () => {
  it("yalnızca değişken maliyetler bütçeye sayılır; sınır aşılacaksa ücretli işlem durur ve bildirim bir kez gönderilir", async () => {
    const brand = await makeBrand({ monthlyBudgetUsd: 2, maxBudgetUsd: 3 });
    await prisma.user.create({ data: { email: "admin@example.com", name: "A", passwordHash: "x", role: "ADMIN" } });
    await recordUsage({ brandId: brand.id, provider: "OPENAI", operation: "x", costUsd: 2.9 });
    await recordUsage({ brandId: brand.id, provider: "SERVER", operation: "fixed", costUsd: 100 } as any);
    const st = await budgetStatus(brand.id);
    expect(st.find((s) => s.scope === "brand")!.spentUsd).toBeCloseTo(2.9);
    await expect(assertCanSpend(brand.id, 0.5, "video.generate")).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(assertCanSpend(brand.id, 0.5, "video.generate")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(await prisma.notification.count({ where: { type: "BUDGET_LIMIT", severity: "ERROR" } })).toBe(1);
    await expect(assertCanSpend(brand.id, 0.05, "tts")).resolves.toBeUndefined();
  });
  it("bütçe dolunca üretim kuyruğa alınmaz", async () => {
    const brand = await makeBrand({ maxBudgetUsd: 0.001 });
    await recordUsage({ brandId: brand.id, provider: "GOOGLE_TTS", operation: "x", costUsd: 0.001 });
    await expect(enqueueGeneration(brand.id, { trigger: "manual" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(await prisma.video.count()).toBe(0);
  });
});

describe("üretim limitleri", () => {
  it("marka günlük hedefi (3) dolunca yeni üretim reddedilir; başarısız videolar sayılmaz", async () => {
    const brand = await makeBrand({ dailyVideoTarget: 3 });
    for (let i = 0; i < 2; i++) await makeVideo(brand.id);
    await makeVideo(brand.id, { status: "FAILED" });
    expect((await generationLimits(brand.id)).allowed).toBe(true);
    await makeVideo(brand.id);
    const l = await generationLimits(brand.id);
    expect(l.allowed).toBe(false);
    expect(l.reason).toMatch(/günlük limiti/);
    await expect(enqueueGeneration(brand.id, { trigger: "manual" })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });
  it("sistem geneli limit tüm markaları kapsar", async () => {
    await setSetting("generation.globalDailyLimit", 1);
    const a = await makeBrand();
    const b = await makeBrand();
    await makeVideo(a.id);
    expect((await generationLimits(b.id)).allowed).toBe(false);
  });
});

describe("zamanlayıcı", () => {
  it("10:00/15:00/20:00 slotları için üretimi zamanında başlatır ve aynı slot için ikinci video üretmez", async () => {
    const brand = await makeBrand({ autoGenerate: true, timezone: "Europe/Istanbul" });
    await ensureDefaultSchedules(brand.id, ["10:00", "15:00", "20:00"]);
    const sched = await prisma.schedule.findFirstOrThrow({ where: { brandId: brand.id, time: "15:00" } });
    const slot = DateTime.now().setZone("Europe/Istanbul").set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
    const now = slot.minus({ minutes: sched.leadMinutes - 5 }).toJSDate();
    const first = await schedulerTick(now);
    expect(first).toHaveLength(1);
    const v = await prisma.video.findUniqueOrThrow({ where: { id: first[0] } });
    expect(v.scheduleSlot!.toISOString()).toBe(slot.toUTC().toISO());
    expect(await schedulerTick(now)).toHaveLength(0);
    // Pencere dışı (slot'tan 1 saat sonra) → üretim yok
    expect(await schedulerTick(slot.plus({ hours: 1 }).toJSDate())).toHaveLength(0);
  });
  it("otomatik üretimi kapalı marka için çalışmaz", async () => {
    const brand = await makeBrand({ autoGenerate: false });
    await ensureDefaultSchedules(brand.id, ["10:00"]);
    const now = DateTime.now().setZone("Europe/Istanbul").set({ hour: 9, minute: 50 }).toJSDate();
    expect(await schedulerTick(now)).toHaveLength(0);
  });
});

describe("oturum güvenliği", () => {
  it("doğru şifreyle giriş; token DB'de hash olarak saklanır; çıkış oturumu siler", async () => {
    await prisma.user.create({ data: { email: "u@example.com", name: "U", passwordHash: await hashPassword("Cok-Guclu-Sifre-2026") } });
    const r = await login("U@Example.com", "Cok-Guclu-Sifre-2026", { ip: "127.0.0.1" });
    const row = await prisma.session.findFirstOrThrow();
    expect(row.tokenHash).not.toBe(r.token);
    expect((await getSessionByToken(r.token))?.user.email).toBe("u@example.com");
    await logout(r.token);
    expect(await getSessionByToken(r.token)).toBeNull();
  });
  it("5 hatalı denemeden sonra hesap kilitlenir", async () => {
    await prisma.user.create({ data: { email: "k@example.com", name: "K", passwordHash: await hashPassword("Cok-Guclu-Sifre-2026") } });
    for (let i = 0; i < 5; i++) await expect(login("k@example.com", "yanlis", {})).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(login("k@example.com", "Cok-Guclu-Sifre-2026", {})).rejects.toMatchObject({ code: "LOCKED" });
    expect(await prisma.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(5);
  });
  it("pasif kullanıcının oturumu geçersizdir", async () => {
    const u = await prisma.user.create({ data: { email: "p@example.com", name: "P", passwordHash: "x" } });
    const s = await createSession(u.id, {});
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect(await getSessionByToken(s.token)).toBeNull();
  });
});

describe("depolama (yerel sürücü; R2 aynı arayüzü uygular)", () => {
  it("dosya yükler/indirir, imzalı süreli URL üretir, dizin dışına çıkışı engeller", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "asf-st-"));
    const src = path.join(dir, "a.mp4");
    await writeFile(src, "video-bytes");
    const up = await storage().putFile("videos/b1/a.mp4", src, "video/mp4");
    expect(up.sizeBytes).toBe(11);
    const dst = path.join(dir, "b.mp4");
    await storage().getToFile("videos/b1/a.mp4", dst);
    expect(await readFile(dst, "utf8")).toBe("video-bytes");
    const url = new URL(await storage().publicUrl("videos/b1/a.mp4", 60));
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(verifyMediaSignature("videos/b1/a.mp4", exp, sig)).toBe(true);
    expect(verifyMediaSignature("videos/b1/other.mp4", exp, sig)).toBe(false);
    expect(verifyMediaSignature("videos/b1/a.mp4", Math.floor(Date.now() / 1000) - 10, sig)).toBe(false);
    await expect(new LocalDriver().getToFile("../../etc/passwd", dst)).rejects.toThrow(/Geçersiz/);
  });
});
