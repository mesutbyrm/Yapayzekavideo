export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "APP_ERROR",
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotConfiguredError extends AppError {
  constructor(what: string, envVars: string[]) {
    super(`${what} yapılandırılmadı. Gerekli ortam değişkenleri: ${envVars.join(", ")}`, "NOT_CONFIGURED", 503, {
      envVars,
    });
    this.name = "NotConfiguredError";
  }
}

export class BudgetExceededError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "BUDGET_EXCEEDED", 402, details);
    this.name = "BudgetExceededError";
  }
}

/**
 * Harici sağlayıcı hatası. retryable=false ise iş tekrar denenmez
 * (ör. geçersiz parametre, yetki yok, denetimsiz TikTok istemcisi).
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    public readonly kind: "auth" | "rate_limit" | "validation" | "policy" | "transient" | "unknown" = "unknown",
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
  if (err instanceof BudgetExceededError) return false;
  if (err instanceof NotConfiguredError) return false;
  if (err instanceof AppError) return false;
  return true;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
