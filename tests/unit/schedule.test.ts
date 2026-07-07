import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { classSessions, schema, scheduleSlots } from "@/db/schema";
import { createCourse } from "@/lib/courses";
import { seedTutor } from "@/lib/seed";
import {
  createScheduleSlot,
  deactivateScheduleSlot,
  generateSessions,
  updateScheduleSlot,
} from "@/lib/schedule";

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
  await createCourse(db, {
    description: "",
    makeId: () => "course_id",
    subject: "Math",
    title: "Algebra I",
  });

  return { client, db };
}

describe("schedule", () => {
  it("creates, updates, and deactivates weekly schedule slots", async () => {
    const { client, db } = await createMigratedDb();
    const slot = await createScheduleSlot(db, {
      courseId: "course_id",
      durationMin: 60,
      makeId: () => "slot_id",
      now: () => 2000,
      startMin: 9 * 60,
      weekday: 1,
    });

    const updated = await updateScheduleSlot(db, {
      durationMin: 90,
      id: "slot_id",
      now: () => 3000,
      startMin: 10 * 60,
      weekday: 2,
    });
    const deactivated = await deactivateScheduleSlot(db, {
      id: "slot_id",
      now: () => 4000,
    });
    const rows = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, "slot_id"));
    client.close();

    expect(slot).toMatchObject({
      active: true,
      courseId: "course_id",
      durationMin: 60,
      startMin: 540,
      weekday: 1,
    });
    expect(updated).toMatchObject({
      durationMin: 90,
      startMin: 600,
      updatedAt: 3000,
      weekday: 2,
    });
    expect(deactivated.active).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("generates future sessions idempotently for active weekly slots", async () => {
    const { client, db } = await createMigratedDb();
    await createScheduleSlot(db, {
      courseId: "course_id",
      durationMin: 60,
      makeId: () => "slot_id",
      now: () => 2000,
      startMin: 9 * 60,
      weekday: 1,
    });

    const first = await generateSessions(db, {
      from: Date.UTC(2026, 0, 5),
      makeId: (index) => `session_${index}`,
      now: () => 3000,
      weeks: 2,
    });
    const second = await generateSessions(db, {
      from: Date.UTC(2026, 0, 5),
      makeId: (index) => `session_again_${index}`,
      now: () => 4000,
      weeks: 2,
    });
    const sessions = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.generatedFromSlot, "slot_id"));
    client.close();

    expect(first).toEqual({ created: 2, skipped: 0 });
    expect(second).toEqual({ created: 0, skipped: 2 });
    expect(sessions.map((session) => session.startsAt).sort()).toEqual([
      Date.UTC(2026, 0, 5, 9),
      Date.UTC(2026, 0, 12, 9),
    ]);
  });
});
