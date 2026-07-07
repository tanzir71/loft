import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { schema } from "@/db/schema";
import { seedTutor } from "@/lib/seed";

const e2eDbPath = path.join(process.cwd(), "data", "e2e.db");
const tables = [
  "activity_log",
  "announcements",
  "assignments",
  "attachments",
  "attendance",
  "class_sessions",
  "comment_bank",
  "comments",
  "courses",
  "enrollments",
  "invites",
  "invoice_items",
  "invoices",
  "material_links",
  "material_progress",
  "material_standards",
  "materials",
  "modules",
  "package_purchases",
  "parent_links",
  "payments",
  "progress_reports",
  "prompt_history",
  "quiz_answers",
  "quiz_attempts",
  "quiz_questions",
  "quiz_standards",
  "quizzes",
  "rate_plans",
  "schedule_slots",
  "settings",
  "standards",
  "submissions",
  "users",
];

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

async function hasSchema(client: Client) {
  const result = await client.execute(
    "select name from sqlite_master where type = 'table' and name = 'users'",
  );

  return result.rows.length > 0;
}

async function clearExistingData(client: Client) {
  const result = await client.execute("select name from sqlite_master where type = 'table'");
  const existingTables = new Set(result.rows.map((row) => String(row.name)));

  await client.execute("PRAGMA foreign_keys = OFF");

  for (const table of tables) {
    if (existingTables.has(table)) {
      await client.execute(`delete from "${table}"`);
    }
  }

  await client.execute("PRAGMA foreign_keys = ON");
}

export async function resetE2eDb() {
  mkdirSync(path.dirname(e2eDbPath), { recursive: true });

  const client = createClient({ url: "file:./data/e2e.db" });
  const db = drizzle(client, { schema });

  if (await hasSchema(client)) {
    await clearExistingData(client);
  } else {
    await applyInitialMigration(client);
  }

  await seedTutor(db, {
    email: "tutor@example.com",
    password: "correct horse battery staple",
    now: () => 1783410000000,
    makeId: () => "tutor_id",
  });
  client.close();
}
