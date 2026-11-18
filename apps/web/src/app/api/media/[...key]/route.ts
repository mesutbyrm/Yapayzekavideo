import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { verifyMediaSignature, localStoragePath, contentTypeFor } from "@asf/core";

/**
 * Yerel depolama için imzalı, süreli herkese açık medya URL'si.
 * Instagram/Facebook gibi platformlar videoyu bu adresten çeker (pull).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!verifyMediaSignature(key, exp, sig)) return new Response("Forbidden", { status: 403 });
  let p: string;
  try {
    p = localStoragePath(key);
    const st = await stat(p);
    const range = req.headers.get("range");
    const type = contentTypeFor(p);
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m?.[1] ? Number(m[1]) : 0;
      const end = m?.[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      return new Response(Readable.toWeb(createReadStream(p, { start, end })) as any, { status: 206, headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(createReadStream(p)) as any, { headers: { "Content-Type": type, "Content-Length": String(st.size), "Accept-Ranges": "bytes" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
