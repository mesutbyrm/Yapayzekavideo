import { expect, type APIRequestContext } from "@playwright/test";

export const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
export const PASSWORD = process.env.E2E_PASSWORD ?? "";
export const AUTH_FILE = "e2e/.auth.json";

/** Kayıtlı oturumdan CSRF token'ını döndürür */
export async function csrfOf(request: APIRequestContext) {
  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === "asf_csrf")?.value;
  expect(csrf).toBeTruthy();
  return csrf!;
}
