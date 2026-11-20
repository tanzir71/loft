import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { schema, settings, users } from "@/db/schema";
import { seedTutor } from "@/lib/seed";

async function applyInitialMigration(client: Client) {
  const migrationDir = path.join(process.cwd(), "drizzle");
  const migrationFile = readdirSync(migrationDir).find(
    (file) => file.startsWith("0000_") && file.endsWith(".sql"),
  );

  if (!migrationFile) {
    throw new Error("Initial migration was not generated.");
  }

  const sql = readFileSync(path.join(migrationDir, migrationFile), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await client.execute(statement);
  }
}

async function createMigratedDb() {
  const client = createClient({ url: "file::memory:" });
  await applyInitialMigration(client);

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

describe("seedTutor", () => {
  it("creates the tutor account from env-style inputs and inserts default settings", async () => {
    const { client, db } = await createMigratedDb();

    await seedTutor(db, {
      email: "tutor@example.com",
      password: "correct horse battery staple",
      name: "Tutor Loft",
      now: () => 1783410000000,
      makeId: () => "seeded_id",
    });

    const [tutor] = await db.select().from(users).where(eq(users.email, "tutor@example.com"));
    const defaultSettings = await db.select().from(settings);
    client.close();

    expect(tutor).toMatchObject({
      id: "seeded_id",
      name: "Tutor Loft",
      email: "tutor@example.com",
      role: "tutor",
      status: "active",
      createdAt: 1783410000000,
      updatedAt: 1783410000000,
    });
    expect(tutor?.passwordHash).not.toBe("correct horse battery staple");
    expect(tutor?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(defaultSettings).toEqual(
      expect.arrayContaining([
        { key: "currency", value: "BDT" },
        { key: "invoice_prefix", value: "TL" },
        { key: "timezone", value: "Asia/Dhaka" },
      ]),
    );
  });
});
