import { decryptSecret } from "../lib/crypto";
import { prisma } from "../lib/db";

export type ProviderApiKeys = { anthropic?: string; openai?: string; models?: { anthropic?: string; openai?: string }; activeProvider?: "anthropic" | "openai" };

export async function getProviderApiKeys(): Promise<ProviderApiKeys> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "ai.providerKeys" } });
  const value = row?.value as Record<string, unknown> | null;
  if (!value) return {};
  const out: ProviderApiKeys = { activeProvider: value.activeProvider === "anthropic" ? "anthropic" : "openai" };
  for (const provider of ["anthropic", "openai"] as const) {
    const encrypted = value[provider];
    if (typeof encrypted === "string" && encrypted) {
      try { out[provider] = decryptSecret(encrypted, "ai-provider:" + provider); } catch { /* ignore invalid old ciphertext */ }
    }
  }
  const models = value.models && typeof value.models === "object" ? value.models as Record<string, unknown> : {};
  out.models = { anthropic: typeof models.anthropic === "string" ? models.anthropic : undefined, openai: typeof models.openai === "string" ? models.openai : undefined };
  return out;
}
