import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { announcements, classSessions, invoices, materials, quizzes, schema } from "@/db/schema";
import { createAnnouncement } from "@/lib/classroom";
import { createMaterial } from "@/lib/content";
import { createCourse, enrollStudent } from "@/lib/courses";
import { isCronRequestAuthorized, runCronTasks } from "@/lib/cron";
import { createQuiz } from "@/lib/quizzes";
import { createRatePlan, setCourseDefaultRatePlan } from "@/lib/billing";
import { createScheduleSlot } from "@/lib/schedule";
import { seedTutor } from "@/lib/seed";
import { createStudent } from "@/lib/students";

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
    makeId: () => "tutor_id",
    password: "correct horse battery staple",
  });

  return { client, db };
}

describe("cron tasks", () => {
  it("authorizes cron requests with bearer or query secret", () => {
    expect(
      isCronRequestAuthorized(
        new Request("https://example.com/api/cron", {
          headers: { authorization: "Bearer cron_secret" },
        }),
        "cron_secret",
      ),
    ).toBe(true);
    expect(
      isCronRequestAuthorized(
        new Request("https://example.com/api/cron?secret=cron_secret"),
        "cron_secret",
      ),
    ).toBe(true);
    expect(
      isCronRequestAuthorized(
        new Request("https://example.com/api/cron", {
          headers: { authorization: "Bearer wrong" },
        }),
        "cron_secret",
      ),
    ).toBe(false);
    expect(isCronRequestAuthorized(new Request("https://example.com/api/cron"), "")).toBe(false);
  });

  it("runs scheduled jobs idempotently across double invocation", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 7, 12);
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await enrollStudent(db, {
      courseId: "course_id",
      makeId: () => "enrollment_id",
      studentId: "student_id",
    });
    const plan = await createRatePlan(db, {
      amount: 5000,
      makeId: () => "plan_id",
      name: "Monthly",
      type: "monthly_flat",
    });
    await setCourseDefaultRatePlan(db, {
      courseId: "course_id",
      ratePlanId: plan.id,
    });
    await createScheduleSlot(db, {
      courseId: "course_id",
      durationMin: 60,
      makeId: () => "slot_id",
      startMin: 10 * 60,
      weekday: 2,
    });
    await createQuiz(db, {
      closeAt: now - 60_000,
      courseId: "course_id",
      makeId: () => "quiz_id",
      status: "published",
      title: "Closing quiz",
    });
    await createAnnouncement(db, {
      bodyMd: "Scheduled note",
      makeId: () => "announcement_id",
      publishAt: now - 60_000,
      status: "draft",
      title: "Scheduled announcement",
    });
    await createMaterial(db, {
      bodyMd: "Scheduled worksheet",
      courseId: "course_id",
      makeId: () => "material_id",
      publishAt: now - 60_000,
      status: "draft",
      title: "Scheduled worksheet",
      type: "worksheet",
      visibility: "students",
    });

    const first = await runCronTasks(db, { now, sessionWeeks: 2 });
    const second = await runCronTasks(db, { now, sessionWeeks: 2 });
    const [sessionRows, invoiceRows, quizRows, announcementRows, materialRows] = await Promise.all([
      db.select().from(classSessions),
      db.select().from(invoices),
      db.select().from(quizzes).where(eq(quizzes.id, "quiz_id")),
      db.select().from(announcements).where(eq(announcements.id, "announcement_id")),
      db.select().from(materials).where(eq(materials.id, "material_id")),
    ]);
    client.close();

    expect(first).toMatchObject({
      announcementsPublished: 1,
      invoicesCreated: 1,
      materialsPublished: 1,
      quizzesClosed: 1,
      sessions: { created: 2, skipped: 0 },
    });
    expect(second).toMatchObject({
      announcementsPublished: 0,
      invoicesCreated: 0,
      materialsPublished: 0,
      quizzesClosed: 0,
      sessions: { created: 0, skipped: 2 },
    });
    expect(sessionRows).toHaveLength(2);
    expect(invoiceRows).toHaveLength(1);
    expect(quizRows[0].status).toBe("closed");
    expect(announcementRows[0].status).toBe("published");
    expect(materialRows[0].status).toBe("published");
  });
});
