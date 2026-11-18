"use client";

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)asf_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** CSRF başlıklı fetch – API hatalarını ApiError olarak fırlatır */
export async function apiFetch<T = any>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", csrf());
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? `HTTP ${res.status}`, data?.error?.details);
  return data as T;
}
