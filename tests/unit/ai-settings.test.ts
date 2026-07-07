import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { schema, settings } from "@/db/schema";
import {
  readAiGenerationSettings,
  readAiSettings,
  saveAiSettings,
  testAiSettings,
} from "@/lib/ai-settings";
import { decryptSecret } from "@/lib/crypto";

async function applyInitialMigration(client: Client) {
  const migrationDir = path.join(process.cwd(), "drizzle");
  const migrationFile = readdirSync(migrationDir).find(
    (file) => file.startsWith("0000_") && file.endsWith(".sql"),
  );

  if (!migrationFile) {
    throw new Error("Initial migration was not generated.");
  }

  const sql = readFileSync(path.join(migrationDir, migrationFile), "utf8");

  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) {
      await client.execute(trimmed);
    }
  }
}

async function createMigratedDb() {
  const client = createClient({ url: "file::memory:" });
  await applyInitialMigration(client);
  const db = drizzle(client, { schema });

  return { client, db };
}

describe("AI settings", () => {
  it("stores encrypted API keys, masks saved keys, and preserves keys on blank updates", async () => {
    const { client, db } = await createMigratedDb();
    const secret = "auth-secret-for-ai-settings";

    await saveAiSettings(db, {
      apiKey: "sk-test-1234567890",
      encryptionSecret: secret,
      model: "openai/gpt-4.1-mini",
      provider: "openrouter",
    });
    const [storedKey] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "ai_key_encrypted"));
    const firstRead = await readAiSettings(db);
    await saveAiSettings(db, {
      apiKey: "",
      encryptionSecret: secret,
      model: "claude-sonnet-4",
      provider: "anthropic",
    });
    const secondRead = await readAiSettings(db);
    const generationSettings = await readAiGenerationSettings(db, {
      encryptionSecret: secret,
    });
    const testResult = await testAiSettings(db, { encryptionSecret: secret });
    client.close();

    expect(storedKey.value).not.toContain("sk-test");
    expect(decryptSecret(storedKey.value, secret)).toBe("sk-test-1234567890");
    expect(firstRead).toMatchObject({
      hasKey: true,
      maskedKey: "sk-t...7890",
      model: "openai/gpt-4.1-mini",
      provider: "openrouter",
    });
    expect(secondRead).toMatchObject({
      hasKey: true,
      maskedKey: "sk-t...7890",
      model: "claude-sonnet-4",
      provider: "anthropic",
    });
    expect(testResult).toMatchObject({
      maskedKey: "sk-t...7890",
      ok: true,
      provider: "anthropic",
    });
    expect(generationSettings).toMatchObject({
      apiKey: "sk-test-1234567890",
      model: "claude-sonnet-4",
      provider: "anthropic",
    });
  });

  it("reports missing or invalid saved keys without exposing secret material", async () => {
    const { client, db } = await createMigratedDb();

    await saveAiSettings(db, {
      apiKey: "",
      encryptionSecret: "auth-secret-for-ai-settings",
      model: "openai/gpt-4.1-mini",
      provider: "openrouter",
    });
    const missing = await testAiSettings(db, {
      encryptionSecret: "auth-secret-for-ai-settings",
    });
    await saveAiSettings(db, {
      apiKey: "sk-test-1234567890",
      encryptionSecret: "auth-secret-for-ai-settings",
      model: "openai/gpt-4.1-mini",
      provider: "openrouter",
    });
    const invalid = await testAiSettings(db, { encryptionSecret: "wrong-secret" });
    client.close();

    expect(missing).toMatchObject({ ok: false, reason: "missing_key" });
    expect(invalid).toMatchObject({ ok: false, reason: "invalid_key" });
    expect(JSON.stringify(invalid)).not.toContain("sk-test");
  });
});
