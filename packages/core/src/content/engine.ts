import { prisma, Prisma } from "../lib/db";
import { chatJson } from "../ai/openai";
import { AppError, ProviderError, BudgetExceededError, NotConfiguredError } from "../lib/errors";
import { logger } from "../lib/logger";
import { ideasJsonSchema, ideasSchema, scriptJsonSchema, scriptSchema, validateTiming, type VideoScriptJson } from "./schema";
import { brandContext, IDEAS_SYSTEM, ideasUser, scriptSystem, scriptUser } from "./prompts";
import { isNearDuplicate, narrationHash, topicFingerprint } from "./fingerprint";
import { fullSafety } from "./safety";
import { topPerformingTopics } from "../analytics/insights";

const MAX_SCRIPT_ATTEMPTS = 3;

/** Günlük konu/fikir üretimi. Tekrarlar parmak izi + benzerlik ile elenir. */
export async function generateIdeas(brandId: string, count = 5, topic = "") {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
  const categories = await prisma.contentCategory.findMany({ where: { brandId, isActive: true } });
  const used = await prisma.contentIdea.findMany({
    where: { brandId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { topic: true },
  });
  const usedTopics = used.map((u) => u.topic);
  const hints = await topPerformingTopics(brandId, 5).catch(() => []);
  const res = await chatJson({
    system: IDEAS_SYSTEM,
    user: ideasUser(brandContext(brand, categories), count + 3, usedTopics.slice(0, 80), hints, topic),
    brandId,
    operation: "content.ideas",
    schemaName: "ideas",
    jsonSchema: ideasJsonSchema as any,
    maxOutputTokens: 3000,
  });
  const parsed = ideasSchema.safeParse(res.data);
  if (!parsed.success) throw new ProviderError("Fikir JSON doğrulaması başarısız", "openai", "IDEAS_INVALID", true);

  const created = [];
  for (const idea of parsed.data.ideas) {
    if (created.length >= count) break;
    if (isNearDuplicate(idea.topic, usedTopics)) continue;
    const cat = categories.find((c) => c.name.toLocaleLowerCase("tr") === idea.category?.toLocaleLowerCase("tr"));
    try {
      const row = await prisma.contentIdea.create({
        data: { brandId, topic: idea.topic, angle: idea.angle, categoryId: cat?.id, fingerprint: topicFingerprint(idea.topic) },
      });
      created.push(row);
      usedTopics.push(idea.topic);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  logger.info({ brandId, created: created.length }, "fikirler üretildi");
  return created;
}

/** Kullanılmamış bir fikir seçer; yoksa yenisini üretir. Kategori ağırlıkları dikkate alınır. */
export async function pickIdea(brandId: string) {
  let idea = await prisma.contentIdea.findFirst({ where: { brandId, status: "NEW" }, orderBy: [{ score: "desc" }, { createdAt: "asc" }] });
  if (!idea) {
    const created = await generateIdeas(brandId, 5);
    idea = created[0] ?? null;
  }
  if (!idea) throw new AppError("Yeni ve özgün bir fikir üretilemedi", "NO_UNIQUE_IDEA", 409);
  return idea;
}

/**
 * Senaryo üretimi: JSON şema doğrulama + süre kontrolü + tekrar kontrolü + güvenlik.
 * Hatalı çıktıda hatalar modele geri bildirilerek en fazla 3 kez kontrollü yeniden üretim yapılır.
 */
export async function generateScript(brandId: string, ideaId: string, videoId?: string | null, opts?: { minSeconds?: number; maxSeconds?: number; language?: string; subtitles?: boolean }) {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
  const idea = await prisma.contentIdea.findUniqueOrThrow({ where: { id: ideaId } });
  if (idea.brandId !== brandId) throw new AppError("Fikir bu markaya ait değil", "FORBIDDEN", 403);
  const categories = await prisma.contentCategory.findMany({ where: { brandId, isActive: true } });
  const ctx = brandContext(brand, categories);
  const minSeconds = opts?.minSeconds ?? brand.minDurationSec;
  const maxSeconds = opts?.maxSeconds ?? brand.maxDurationSec;
  const language = opts?.language ?? "tr";
  const languageName = ({ tr: "Turkish", en: "English", de: "German", fr: "French", es: "Spanish", ar: "Arabic" } as Record<string, string>)[language] ?? "Turkish";
  const recent = await prisma.videoScript.findMany({ where: { brandId }, orderBy: { createdAt: "desc" }, take: 100, select: { title: true, narration: true } });
  const banned = (brand.contentRules ?? "")
    .split("\n")
    .filter((l) => /^yasak:/i.test(l.trim()))
    .map((l) => l.split(":")[1]?.trim() ?? "");

  let feedback: string[] = [];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SCRIPT_ATTEMPTS; attempt++) {
    try {
      const res = await chatJson<unknown>({
        system: scriptSystem(minSeconds, maxSeconds, languageName, brand.videoTemplate),
        user: scriptUser(ctx, idea.topic, idea.angle, feedback) + "\nWrite the title, hook, narration, subtitles, CTA, and metadata entirely in " + languageName + ".",
        brandId,
        videoId,
        operation: "content.script",
        schemaName: "video_script",
        jsonSchema: scriptJsonSchema as any,
        maxOutputTokens: 4000,
      });
      const parsed = scriptSchema.safeParse(normalizeScript(res.data));
      if (!parsed.success) {
        feedback = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`);
        lastErr = new ProviderError("Senaryo JSON doğrulaması başarısız", "openai", "SCRIPT_INVALID", true);
        continue;
      }
      const script = parsed.data;
      const timing = validateTiming(script, minSeconds, maxSeconds);
      if (timing.length) {
        feedback = timing;
        lastErr = new ProviderError(timing.join("; "), "openai", "SCRIPT_TIMING", true);
        continue;
      }
      const nHash = narrationHash(script.narration);
      if (isNearDuplicate(script.narration, recent.map((r) => r.narration), 0.55) || isNearDuplicate(script.title, recent.map((r) => r.title), 0.7)) {
        feedback = ["Metin daha önce üretilen bir videoya çok benziyor. Farklı bir anlatım, farklı örnekler ve farklı başlık kullan."];
        lastErr = new AppError("Tekrarlanan içerik", "DUPLICATE_CONTENT", 409);
        continue;
      }
      const safety = await fullSafety(script, banned);
      if (!safety.ok) {
        feedback = [`Şu sorunlar nedeniyle metin reddedildi: ${safety.blocking.join(", ")}. Bu unsurları tamamen çıkar.`];
        lastErr = new AppError("İçerik güvenlik kontrolünden geçemedi: " + safety.blocking.join(", "), "UNSAFE_CONTENT", 422);
        continue;
      }
      const row = await prisma.videoScript.create({
        data: {
          brandId,
          ideaId,
          title: script.title,
          hook: script.hook,
          narration: script.narration,
          scenes: script.scenes as any,
          cta: script.cta,
          hashtags: mergeHashtags(script.hashtags, brand.hashtags),
          platformMetadata: script.platform_metadata as any,
          raw: { ...(res.data as any), productionOptions: { minSeconds, maxSeconds, language, subtitles: opts?.subtitles ?? true } },
          model: res.model,
          attempts: attempt,
          safetyFlags: safety.flags,
          narrationHash: nHash,
        },
      });
      await prisma.contentIdea.update({ where: { id: ideaId }, data: { status: "SCRIPTED" } });
      return row;
    } catch (err) {
      if (err instanceof BudgetExceededError || err instanceof NotConfiguredError) throw err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        feedback = ["Bu anlatım birebir daha önce kullanıldı. Tamamen yeni bir metin yaz."];
        lastErr = err;
        continue;
      }
      if (err instanceof ProviderError && err.code === "INVALID_JSON") {
        feedback = ["Çıktı geçerli JSON değildi. Yalnızca şemaya uygun JSON döndür."];
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  await prisma.contentIdea.update({ where: { id: ideaId }, data: { status: "REJECTED" } });
  throw lastErr instanceof Error ? lastErr : new AppError("Senaryo üretilemedi", "SCRIPT_FAILED");
}

/** Model çıktısındaki küçük biçim farklarını düzeltir (ör. # eksik hashtag) */
export function normalizeScript(data: any): any {
  if (!data || typeof data !== "object") return data;
  const fixTag = (t: unknown) =>
    typeof t === "string" ? "#" + t.trim().replace(/^#+/, "").replace(/\s+/g, "").replace(/[^\p{L}\p{N}_]/gu, "") : t;
  if (Array.isArray(data.hashtags)) data.hashtags = [...new Set(data.hashtags.map(fixTag).filter((t: any) => typeof t === "string" && t.length > 1))];
  if (Array.isArray(data.scenes)) {
    data.scenes = data.scenes.map((s: any) => ({ ...s, duration: typeof s.duration === "string" ? parseFloat(s.duration) : s.duration }));
  }
  if (data.platform_metadata) {
    for (const k of Object.keys(data.platform_metadata)) {
      const m = data.platform_metadata[k];
      if (m && Array.isArray(m.hashtags)) m.hashtags = m.hashtags.map(fixTag);
    }
  }
  return data;
}

function mergeHashtags(a: string[], b: string[]) {
  return [...new Set([...a, ...b.map((t) => (t.startsWith("#") ? t : `#${t}`))])].slice(0, 15);
}

export type { VideoScriptJson };
