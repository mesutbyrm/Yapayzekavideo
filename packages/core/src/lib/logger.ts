import pino from "pino";

/**
 * Hassas alanlar loglara asla yazılmaz.
 */
export const REDACT_PATHS = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "access_token",
  "*.access_token",
  "refreshToken",
  "*.refreshToken",
  "refresh_token",
  "*.refresh_token",
  "client_secret",
  "*.client_secret",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.Authorization",
  "apiKey",
  "*.apiKey",
  "cookie",
  "*.cookie",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: process.env.SERVICE_NAME ?? "asf" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

/** URL içindeki access_token vb. parametreleri maskeler. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](access_token|client_secret|refresh_token|key|code|input_token)=)[^&]+/gi, "$1[REDACTED]");
}

/** Serbest metin içindeki token benzeri değerleri maskeler. */
export function redactText(text: string): string {
  return redactUrl(text)
    .replace(/(Bearer|OAuth)\s+[A-Za-z0-9._\-~+/=]+/g, "$1 [REDACTED]")
    .replace(/(sk-[A-Za-z0-9_\-]{8})[A-Za-z0-9_\-]+/g, "$1…");
}
