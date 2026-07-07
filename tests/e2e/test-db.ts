import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { schema } from "@/db/schema";
import { seedTutor } from "@/lib/seed";

const e2eDbPath = path.join(process.cwd(), "data", "e2e.db");

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

export async function resetE2eDb() {
  mkdirSync(path.dirname(e2eDbPath), { recursive: true });

  if (existsSync(e2eDbPath)) {
    rmSync(e2eDbPath);
  }

  const client = createClient({ url: "file:./data/e2e.db" });
  const db = drizzle(client, { schema });
  await applyInitialMigration(client);
  await seedTutor(db, {
    email: "tutor@example.com",
    password: "correct horse battery staple",
    now: () => 1783410000000,
    makeId: () => "tutor_id",
  });
  client.close();
}
