import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import {
  AppError,
  BudgetExceededError,
  NotConfiguredError,
  ProviderError,
  getSessionByToken,
  SESSION_COOKIE,
  CSRF_HEADER,
  safeEqual,
  assertBrandAccess,
  logger,
  type SessionUser,
  type BrandAccess,
} from "@asf/core";
import { rateLimit } from "./rate-limit";

export interface ApiCtx {
  req: NextRequest;
  user: SessionUser;
  ip: string | null;
  params: Record<string, string | string[]>;
  json: <T>(schema: ZodType<T>) => Promise<T>;
  brand: (brandId: string, level?: BrandAccess) => Promise<void>;
}

interface Options {
  auth?: boolean;
  admin?: boolean;
  /** Dakikalık istek sınırı (IP + kullanıcı + yol) */
  rateLimit?: number;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(serialize(data), init);
}

/** BigInt / Decimal güvenli JSON */
export function serialize(data: unknown): any {
  return JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v && typeof v === "object" && v.constructor?.name === "Decimal" ? Number(v) : v)));
}

export function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Bütün API uçları için ortak sarmalayıcı:
 * kimlik doğrulama, CSRF (double-submit token), hız sınırı, hata eşleme, gizli bilgi sızdırmama.
 */
export function api(handler: (ctx: ApiCtx) => Promise<Response>, opts: Options = {}) {
  const { auth = true, admin = false, rateLimit: rl = 120 } = opts;
  return async (req: NextRequest, route: { params: Promise<Record<string, string | string[]>> }) => {
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    try {
      const limit = await rateLimit(`${ip ?? "?"}:${req.nextUrl.pathname}:${req.method}`, rl, 60);
      if (!limit.ok) return fail(429, "RATE_LIMITED", "Çok fazla istek. Lütfen biraz bekleyin.");
      let user: SessionUser | null = null;
      if (auth) {
        const session = await getSessionByToken(req.cookies.get(SESSION_COOKIE)?.value);
        if (!session) return fail(401, "UNAUTHENTICATED", "Oturum açmanız gerekiyor");
        if (MUTATING.has(req.method)) {
          const header = req.headers.get(CSRF_HEADER) ?? "";
          if (!header || !safeEqual(header, session.csrfToken)) return fail(403, "CSRF", "Geçersiz CSRF token");
        }
        user = session.user;
        if (admin && user.role !== "ADMIN") return fail(403, "FORBIDDEN", "Yönetici yetkisi gerekli");
      }
      const params = (await route?.params) ?? {};
      const ctx: ApiCtx = {
        req,
        user: user as SessionUser,
        ip,
        params,
        json: async (schema) => schema.parse(await req.json().catch(() => ({}))),
        brand: (brandId, level = "read") => assertBrandAccess(user as SessionUser, brandId, level),
      };
      return await handler(ctx);
    } catch (err) {
      if (err instanceof ZodError) return fail(400, "VALIDATION", "Geçersiz istek", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      if (err instanceof NotConfiguredError) return fail(503, err.code, err.message, err.details);
      if (err instanceof BudgetExceededError) return fail(402, err.code, err.message);
      if (err instanceof AppError) return fail(err.status, err.code, err.message, err.details);
      if (err instanceof ProviderError) return fail(err.httpStatus && err.httpStatus < 500 ? 424 : 502, err.code, err.message);
      if ((err as any)?.code === "P2025") return fail(404, "NOT_FOUND", "Kayıt bulunamadı");
      logger.error({ path: req.nextUrl.pathname, err: (err as Error)?.message }, "API hatası");
      return fail(500, "INTERNAL", "Beklenmeyen bir hata oluştu");
    }
  };
}
