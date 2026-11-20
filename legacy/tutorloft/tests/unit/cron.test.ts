import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { activityLog, announcements, classSessions, invoices, materials, quizzes, schema } from "@/db/schema";
import { createAnnouncement, createAssignment, submitAssignment } from "@/lib/classroom";
import { createMaterial } from "@/lib/content";
import { createCourse, enrollStudent } from "@/lib/courses";
import { isCronRequestAuthorized, runCronTasks, runReadTimeFallbacks } from "@/lib/cron";
import { createQuiz, createQuizQuestion, saveQuizAnswer, startQuizAttempt, submitQuizAttempt } from "@/lib/quizzes";
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

  it("runs non-email read-time fallbacks without relying on cron delivery", async () => {
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

    const first = await runReadTimeFallbacks(db, { now, sessionWeeks: 2 });
    const second = await runReadTimeFallbacks(db, { now, sessionWeeks: 2 });
    const [sessionRows, invoiceRows, quizRows] = await Promise.all([
      db.select().from(classSessions),
      db.select().from(invoices),
      db.select().from(quizzes).where(eq(quizzes.id, "quiz_id")),
    ]);
    client.close();

    expect(first).toMatchObject({
      invoicesCreated: 0,
      quizzesClosed: 1,
      sessions: { created: 2, skipped: 0 },
    });
    expect(second).toMatchObject({
      invoicesCreated: 0,
      quizzesClosed: 0,
      sessions: { created: 0, skipped: 2 },
    });
    expect(sessionRows).toHaveLength(2);
    expect(invoiceRows).toHaveLength(0);
    expect(quizRows[0].status).toBe("closed");
  });

  it("emails a daily tutor digest once per day with sessions, grading, and overdue invoices", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 7, 8);
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
    await db.insert(classSessions).values({
      id: "session_id",
      courseId: "course_id",
      startsAt: Date.UTC(2026, 6, 7, 10),
      durationMin: 60,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    });
    await createAssignment(db, {
      bodyMd: "Solve the worksheet.",
      courseId: "course_id",
      makeId: () => "assignment_id",
      points: 10,
      status: "published",
      title: "Linear practice",
    });
    await submitAssignment(db, {
      assignmentId: "assignment_id",
      bodyText: "My solution",
      makeId: () => "submission_id",
      now: () => now,
      studentId: "student_id",
    });
    await createQuiz(db, {
      courseId: "course_id",
      makeId: () => "quiz_id",
      maxAttempts: 1,
      now: () => now,
      status: "published",
      title: "Exit ticket",
    });
    await createQuizQuestion(db, {
      answerJson: { acceptedAnswers: ["factor"] },
      makeId: () => "question_id",
      optionsJson: null,
      points: 5,
      promptMd: "What is the next step?",
      quizId: "quiz_id",
      sortOrder: 0,
      type: "short_answer",
    });
    const attempt = await startQuizAttempt(db, {
      makeId: () => "attempt_id",
      now: () => now,
      quizId: "quiz_id",
      studentId: "student_id",
    });
    await saveQuizAnswer(db, {
      answerJson: { response: "expand" },
      attemptId: attempt.id,
      makeId: () => "answer_id",
      now: () => now,
      questionId: "question_id",
      studentId: "student_id",
    });
    await submitQuizAttempt(db, {
      attemptId: attempt.id,
      now: () => now + 60_000,
      studentId: "student_id",
    });
    await db.insert(invoices).values({
      id: "overdue_invoice_id",
      createdAt: now,
      dueDate: now - 24 * 60 * 60 * 1000,
      notes: "Needs follow-up",
      number: "TL-202607-0099",
      periodEnd: now,
      periodStart: now - 30 * 24 * 60 * 60 * 1000,
      status: "draft",
      studentId: "student_id",
      total: 2500,
      updatedAt: now,
    });
    const sentPayloads: unknown[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentPayloads.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    const first = await runCronTasks(db, {
      env: { RESEND_API_KEY: "key" },
      fetchFn,
      now,
      origin: "https://tutorloft.test",
    });
    const second = await runCronTasks(db, {
      env: { RESEND_API_KEY: "key" },
      fetchFn,
      now,
      origin: "https://tutorloft.test",
    });
    const logs = await db.select().from(activityLog).where(eq(activityLog.action, "daily_digest"));
    client.close();

    expect(first.dailyDigest).toMatchObject({
      assignmentSubmissions: 1,
      overdueInvoices: 1,
      quizAnswers: 1,
      sent: 1,
      sessions: 1,
      skipped: 0,
    });
    expect(second.dailyDigest).toMatchObject({ sent: 0, skipped: 1 });
    expect(logs).toHaveLength(1);
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({
      subject: "TutorLoft daily digest - 2026-07-07",
      to: "tutor@example.com",
      text: expect.stringContaining("Today's sessions"),
    });
    expect(JSON.stringify(sentPayloads[0])).toContain("Algebra I");
    expect(JSON.stringify(sentPayloads[0])).toContain("Linear practice");
    expect(JSON.stringify(sentPayloads[0])).toContain("Exit ticket");
    expect(JSON.stringify(sentPayloads[0])).toContain("TL-202607-0099");
  });
});
