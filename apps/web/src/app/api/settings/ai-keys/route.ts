import { z } from "zod";
import { prisma, encryptSecret } from "@asf/core";
import { api, ok } from "@/lib/api";

const providerSchema = z.enum(["anthropic", "openai"]);
const stored = async () => {
  const row = await prisma.systemSetting.findUnique({ where: { key: "ai.providerKeys" } });
  return (row?.value ?? {}) as Record<string, unknown>;
};
const safeStatus = (value: Record<string, unknown>) => ({
  configured: { anthropic: typeof value.anthropic === "string" && !!value.anthropic, openai: typeof value.openai === "string" && !!value.openai },
  models: (value.models && typeof value.models === "object" ? value.models : {}) as Record<string, string>, activeProvider: value.activeProvider === "anthropic" ? "anthropic" : "openai",
});

export const GET = api(async () => ok(safeStatus(await stored())));
export const POST = api(async ({ json }) => {
  const body = await json(z.object({ provider: providerSchema, activeProvider: providerSchema.optional(), apiKey: z.string().trim().max(500).optional(), model: z.string().trim().min(2).max(100).optional(), remove: z.boolean().optional() }));
  if (!body.remove && body.apiKey && body.apiKey.length < 10) throw new Error("API anahtarı çok kısa.");
  const value = { ...(await stored()) };
  if (body.activeProvider) value.activeProvider = body.activeProvider;
  if (body.remove) delete value[body.provider];
  else if (body.apiKey) value[body.provider] = encryptSecret(body.apiKey, "ai-provider:" + body.provider);
  if (body.model) value.models = { ...((value.models ?? {}) as Record<string, string>), [body.provider]: body.model };
  await prisma.systemSetting.upsert({ where: { key: "ai.providerKeys" }, update: { value: value as any }, create: { key: "ai.providerKeys", value: value as any } });
  return ok(safeStatus(value));
});
