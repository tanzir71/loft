import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { schema, settings } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

type AppDb = LibSQLDatabase<typeof schema>;

const aiProviderSchema = z.enum(["openrouter", "anthropic", "openai", "google"]);

type SaveAiSettingsInput = {
  apiKey?: string;
  encryptionSecret?: string;
  model?: string;
  provider: string;
};

type TestAiSettingsInput = {
  encryptionSecret?: string;
};

const saveAiSettingsSchema = z.object({
  apiKey: z.string().optional(),
  encryptionSecret: z.string().optional(),
  model: z.string().optional(),
  provider: aiProviderSchema,
});

async function readSettingsMap(database: AppDb) {
  const rows = await database.select().from(settings);
  return Object.fromEntries(rows.map((setting) => [setting.key, setting.value]));
}

async function upsertSetting(database: AppDb, key: string, value: string) {
  await database
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    });
}

export function maskSecret(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= 8) {
    return "****";
  }

  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

export async function readAiSettings(database: AppDb) {
  const settingsMap = await readSettingsMap(database);
  const providerResult = aiProviderSchema.safeParse(settingsMap.ai_provider);
  const provider = providerResult.success ? providerResult.data : "openrouter";
  const encryptedKey = settingsMap.ai_key_encrypted?.trim() ?? "";
  const maskedKey = settingsMap.ai_key_hint?.trim() || null;

  return {
    hasKey: Boolean(encryptedKey),
    maskedKey,
    model: settingsMap.ai_model ?? "",
    provider,
  };
}

export async function saveAiSettings(database: AppDb, input: SaveAiSettingsInput) {
  const parsed = saveAiSettingsSchema.parse(input);
  const model = parsed.model?.trim() ?? "";
  const apiKey = parsed.apiKey?.trim() ?? "";

  await upsertSetting(database, "ai_provider", parsed.provider);
  await upsertSetting(database, "ai_model", model);

  if (apiKey) {
    await upsertSetting(database, "ai_key_encrypted", encryptSecret(apiKey, parsed.encryptionSecret));
    await upsertSetting(database, "ai_key_hint", maskSecret(apiKey) ?? "");
  }

  return readAiSettings(database);
}

export async function testAiSettings(database: AppDb, input: TestAiSettingsInput = {}) {
  const settingsMap = await readSettingsMap(database);
  const providerResult = aiProviderSchema.safeParse(settingsMap.ai_provider);
  const provider = providerResult.success ? providerResult.data : "openrouter";
  const encryptedKey = settingsMap.ai_key_encrypted?.trim();

  if (!encryptedKey) {
    return { ok: false as const, provider, reason: "missing_key" as const };
  }

  try {
    const apiKey = decryptSecret(encryptedKey, input.encryptionSecret);
    return {
      maskedKey: maskSecret(apiKey),
      ok: true as const,
      provider,
    };
  } catch {
    return { ok: false as const, provider, reason: "invalid_key" as const };
  }
}

export async function readAiGenerationSettings(
  database: AppDb,
  input: TestAiSettingsInput = {},
) {
  const settingsMap = await readSettingsMap(database);
  const providerResult = aiProviderSchema.safeParse(settingsMap.ai_provider);
  const provider = providerResult.success ? providerResult.data : "openrouter";
  const encryptedKey = settingsMap.ai_key_encrypted?.trim();

  if (!encryptedKey) {
    throw new Error("AI key is not configured.");
  }

  try {
    return {
      apiKey: decryptSecret(encryptedKey, input.encryptionSecret),
      model: settingsMap.ai_model ?? "",
      provider,
    };
  } catch {
    throw new Error("AI key could not be decrypted.");
  }
}
