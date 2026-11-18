import { ProviderError } from "./errors";
import { logger, redactUrl } from "./logger";

export interface HttpOptions extends Omit<RequestInit, "body"> {
  timeoutMs?: number;
  body?: NonNullable<RequestInit["body"]> | Record<string, unknown> | null;
  provider: string;
}

/**
 * Zaman aşımlı, hata sınıflandırmalı fetch.
 * Cevap gövdesi JSON ise ayrıştırılır. Hata mesajlarına token sızmaz.
 */
export async function httpJson<T = any>(url: string, opts: HttpOptions): Promise<{ status: number; data: T; headers: Headers }> {
  const { timeoutMs = 30_000, provider, body, ...init } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let finalBody: NonNullable<RequestInit["body"]> | undefined;
  const headers = new Headers(init.headers);
  if (body && typeof body === "object" && !(body instanceof URLSearchParams) && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && !(typeof (body as any).getReader === "function")) {
    finalBody = JSON.stringify(body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=UTF-8");
  } else {
    finalBody = (body as NonNullable<RequestInit["body"]>) ?? undefined;
  }
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, body: finalBody, signal: ctrl.signal, duplex: "half" } as RequestInit);
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    throw new ProviderError(
      aborted ? `${provider}: istek zaman aşımına uğradı` : `${provider}: ağ hatası (${err?.message ?? err})`,
      provider,
      aborted ? "TIMEOUT" : "NETWORK",
      true,
      undefined,
      "transient",
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* JSON değil */
  }
  logger.debug({ provider, url: redactUrl(url), status: res.status }, "http");
  return { status: res.status, data, headers: res.headers };
}

/** HTTP durumundan genel yeniden deneme kararı */
export function classifyHttp(status: number): { retryable: boolean; kind: ProviderError["kind"] } {
  if (status === 429) return { retryable: true, kind: "rate_limit" };
  if (status === 401) return { retryable: false, kind: "auth" };
  if (status === 403) return { retryable: false, kind: "policy" };
  if (status >= 500) return { retryable: true, kind: "transient" };
  if (status >= 400) return { retryable: false, kind: "validation" };
  return { retryable: false, kind: "unknown" };
}
