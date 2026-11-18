import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { prisma, storage, env, AppError, audit, contentTypeFor } from "@asf/core";
import { api, ok } from "@/lib/api";

const TYPES: Record<string, { kind: "VIDEO" | "IMAGE" | "MUSIC"; ext: string }> = {
  "video/mp4": { kind: "VIDEO", ext: ".mp4" },
  "image/jpeg": { kind: "IMAGE", ext: ".jpg" },
  "image/png": { kind: "IMAGE", ext: ".png" },
  "audio/mpeg": { kind: "MUSIC", ext: ".mp3" },
};

export const GET = api(async ({ req, brand }) => {
  const brandId = req.nextUrl.searchParams.get("brandId") ?? "";
  await brand(brandId);
  const assets = await prisma.mediaAsset.findMany({ where: { OR: [{ brandId }, { brandId: null }], source: { in: ["LIBRARY", "UPLOAD", "STOCK", "AI_IMAGE"] } }, orderBy: { createdAt: "desc" }, take: 200 });
  return ok({ assets });
});

/**
 * Kendi medya kütüphanesine dosya yükleme (video, görsel, müzik).
 * Lisans bilgisi ve ticari kullanım onayı zorunludur – lisanssız içerik kullanılmaz.
 */
export const POST = api(async ({ req, brand, user, ip }) => {
  const form = await req.formData();
  const brandId = String(form.get("brandId") ?? "");
  await brand(brandId, "write");
  const file = form.get("file");
  const license = String(form.get("license") ?? "").trim();
  const commercialUse = form.get("commercialUse") === "true";
  if (!(file instanceof File)) throw new AppError("Dosya gerekli", "VALIDATION", 400);
  const t = TYPES[file.type];
  if (!t) throw new AppError("Desteklenen türler: MP4, JPEG, PNG, MP3", "VALIDATION", 400);
  if (file.size > 200 * 1024 * 1024) throw new AppError("Dosya en fazla 200 MB olabilir", "VALIDATION", 400);
  if (license.length < 3) throw new AppError("Lisans bilgisi zorunlu", "VALIDATION", 400);
  if (!commercialUse) throw new AppError("Yalnızca ticari kullanıma uygun lisanslı içerik yüklenebilir", "VALIDATION", 400);
  const tags = String(form.get("tags") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const dir = path.join(env().WORK_DIR, `upload-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const tmp = path.join(dir, `f${t.ext}`);
    await writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    let durationSec: number | undefined, width: number | undefined, height: number | undefined;
    if (t.kind !== "IMAGE") {
      const { probe } = await import("@asf/core");
      const p = await probe(tmp);
      durationSec = p.durationSec;
      width = p.video?.width;
      height = p.video?.height;
    }
    const key = `library/${brandId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${t.ext}`;
    const up = await storage().putFile(key, tmp, contentTypeFor(tmp));
    const asset = await prisma.mediaAsset.create({
      data: {
        brandId,
        kind: t.kind,
        source: "LIBRARY",
        provider: "library",
        providerId: key,
        storageKey: key,
        mimeType: file.type,
        sizeBytes: BigInt(up.sizeBytes),
        durationSec,
        width,
        height,
        license,
        licenseUrl: String(form.get("licenseUrl") ?? "") || null,
        attribution: String(form.get("attribution") ?? "") || null,
        author: String(form.get("author") ?? "") || null,
        sourceUrl: String(form.get("sourceUrl") ?? "") || null,
        commercialUse: true,
        tags,
        downloadedAt: new Date(),
      },
    });
    await audit({ action: "media.upload", userId: user.id, brandId, entity: "MediaAsset", entityId: asset.id, ip, metadata: { kind: t.kind, license } });
    return ok({ asset }, { status: 201 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, { rateLimit: 20 });
