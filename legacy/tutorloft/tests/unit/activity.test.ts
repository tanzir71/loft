import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import {
  activityDisplay,
  listRecentActivity,
  logActivity,
} from "@/lib/activity";
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
  const db = drizzle(client, { schema });
  await seedTutor(db, {
    email: "tutor@example.com",
    password: "correct horse battery staple",
    now: () => 1000,
    makeId: () => "tutor_id",
  });

  return { client, db };
}

describe("activity log", () => {
  it("logs activity and lists recent entries newest first", async () => {
    const { client, db } = await createMigratedDb();

    await logActivity(db, {
      action: "student_created",
      actorId: "tutor_id",
      entityId: "student_id",
      entityType: "student",
      makeId: () => "student_log",
      meta: { label: "Student One" },
      now: () => 2000,
    });
    await logActivity(db, {
      action: "course_created",
      actorId: "tutor_id",
      entityId: "course_id",
      entityType: "course",
      makeId: () => "course_log",
      meta: { label: "Algebra I" },
      now: () => 3000,
    });

    const recent = await listRecentActivity(db, { limit: 2 });
    client.close();

    expect(recent).toEqual([
      expect.objectContaining({
        action: "course_created",
        actorId: "tutor_id",
        entityId: "course_id",
        entityType: "course",
        id: "course_log",
        metaJson: { label: "Algebra I" },
      }),
      expect.objectContaining({
        action: "student_created",
        entityId: "student_id",
        id: "student_log",
        metaJson: { label: "Student One" },
      }),
    ]);
  });

  it("builds readable display text from known actions and metadata", () => {
    expect(
      activityDisplay({
        action: "student_created",
        metaJson: { label: "Student One" },
      }),
    ).toEqual({
      detail: "Student One",
      title: "Student created",
    });

    expect(
      activityDisplay({
        action: "payment_reminder",
        metaJson: { invoiceNumber: "TL-202607-0001" },
      }),
    ).toEqual({
      detail: "TL-202607-0001",
      title: "Payment reminder",
    });
  });
});
