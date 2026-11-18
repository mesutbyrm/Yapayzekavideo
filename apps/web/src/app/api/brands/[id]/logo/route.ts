import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { prisma, storage, env, AppError, audit, contentTypeFor } from "@asf/core";
import { api, ok } from "@/lib/api";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Marka logosu yükleme (PNG önerilir – şeffaf arka plan) */
export const POST = api(async ({ params, brand, req, user, ip }) => {
  const id = String(params.id);
  await brand(id, "write");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("Dosya gerekli", "VALIDATION", 400);
  if (!ALLOWED.has(file.type)) throw new AppError("Yalnızca PNG, JPEG veya WEBP", "VALIDATION", 400);
  if (file.size > 5 * 1024 * 1024) throw new AppError("Logo en fazla 5 MB olabilir", "VALIDATION", 400);
  const ext = file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";
  const tmpDir = path.join(env().WORK_DIR, `upload-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `logo${ext}`);
  try {
    await writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    const key = `brands/${id}/logo-${Date.now()}${ext}`;
    const up = await storage().putFile(key, tmp, contentTypeFor(tmp));
    const asset = await prisma.mediaAsset.create({
      data: { brandId: id, kind: "LOGO", source: "UPLOAD", provider: "upload", providerId: key, storageKey: key, mimeType: file.type, sizeBytes: BigInt(up.sizeBytes), license: "Marka sahibine ait", commercialUse: true, downloadedAt: new Date() },
    });
    await prisma.brand.update({ where: { id }, data: { logoAssetId: asset.id } });
    await audit({ action: "brand.logo", userId: user.id, brandId: id, ip });
    return ok({ assetId: asset.id });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
