import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import { verifyCredentials } from "@/lib/credentials";
import { roleHomePath } from "@/lib/session-routing";
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

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

describe("roleHomePath", () => {
  it("routes each role to its home screen", () => {
    expect(roleHomePath("tutor")).toBe("/dashboard");
    expect(roleHomePath("student")).toBe("/home");
    expect(roleHomePath("parent")).toBe("/overview");
  });
});

describe("verifyCredentials", () => {
  it("returns an active user for a valid email/password pair and rejects a wrong password", async () => {
    const { client, db } = await createMigratedDb();
    await seedTutor(db, {
      email: "Tutor@Example.com",
      password: "correct horse battery staple",
      now: () => 1783410000000,
      makeId: () => "tutor_id",
    });

    const valid = await verifyCredentials(db, {
      email: "tutor@example.com",
      password: "correct horse battery staple",
    });
    const invalid = await verifyCredentials(db, {
      email: "tutor@example.com",
      password: "wrong password",
    });
    client.close();

    expect(valid).toMatchObject({
      id: "tutor_id",
      email: "tutor@example.com",
      role: "tutor",
      name: "Tutor",
    });
    expect(invalid).toBeNull();
  });
});
