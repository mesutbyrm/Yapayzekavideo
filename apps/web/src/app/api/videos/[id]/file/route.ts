import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma, storage, localStoragePath, AppError } from "@asf/core";
import { api } from "@/lib/api";

/** Panelde oynatma/indirme: oturum + marka yetkisi kontrolü ile */
export const GET = api(async ({ params, brand, req }) => {
  const v = await prisma.video.findUniqueOrThrow({ where: { id: String(params.id) } });
  await brand(v.brandId);
  const kind = req.nextUrl.searchParams.get("kind") === "thumb" ? "thumb" : "video";
  const key = kind === "thumb" ? v.thumbnailKey : v.storageKey;
  if (!key) throw new AppError("Dosya yok", "NOT_FOUND", 404);
  const s = storage();
  if (s.name === "r2" && s.getObjectStream) {
    const rangeHeader = req.headers.get("range") ?? undefined;
    const object = await s.getObjectStream(key, kind === "video" ? rangeHeader : undefined);
    const headers = new Headers({ "Content-Type": kind === "thumb" ? "image/jpeg" : "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300" });
    if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    return new Response(Readable.toWeb(object.body) as any, { status: object.contentRange ? 206 : 200, headers });
  }
  const p = localStoragePath(key);
  const st = await stat(p);
  const type = kind === "thumb" ? "image/jpeg" : "video/mp4";
  const range = req.headers.get("range");
  if (range && kind === "video") {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    return new Response(Readable.toWeb(createReadStream(p, { start, end })) as any, {
      status: 206,
      headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Cache-Control": "private, max-age=300" },
    });
  }
  return new Response(Readable.toWeb(createReadStream(p)) as any, { headers: { "Content-Type": type, "Content-Length": String(st.size), "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300" } });
}, { rateLimit: 600 });
