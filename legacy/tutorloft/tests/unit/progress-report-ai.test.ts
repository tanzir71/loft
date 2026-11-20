import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { attendance, classSessions, progressReports, schema } from "@/db/schema";
import { generateProgressReportNarrative } from "@/lib/ai/progress-report";
import { createAssignment, gradeSubmission, submitAssignment } from "@/lib/classroom";
import { createCourse, enrollStudent } from "@/lib/courses";
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
    password: "correct horse battery staple",
  });

  return { client, db };
}

describe("AI progress reports", () => {
  it("generates and stores a narrative from structured student facts", async () => {
    const { client, db } = await createMigratedDb();
    const periodStart = Date.UTC(2026, 6, 1);
    const periodEnd = Date.UTC(2026, 6, 31, 23, 59);
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
      startsAt: Date.UTC(2026, 6, 7, 12),
      durationMin: 60,
      status: "done",
      topic: "Equations",
      notesPrivate: null,
      notesShared: "Solved one-step equations.",
      generatedFromSlot: null,
      createdAt: periodStart,
      updatedAt: periodStart,
    });
    await db.insert(attendance).values({
      id: "attendance_id",
      sessionId: "session_id",
      studentId: "student_id",
      status: "present",
      createdAt: periodStart,
      updatedAt: periodStart,
    });
    await createAssignment(db, {
      bodyMd: "Solve the worksheet.",
      courseId: "course_id",
      makeId: () => "assignment_id",
      points: 10,
      rubricMd: "Show each algebra step.",
      status: "published",
      title: "Linear practice",
    });
    await submitAssignment(db, {
      assignmentId: "assignment_id",
      bodyText: "x = 5",
      makeId: () => "submission_id",
      now: () => Date.UTC(2026, 6, 8, 12),
      studentId: "student_id",
    });
    await gradeSubmission(db, {
      actor: { id: "tutor_id", role: "tutor" },
      feedbackMd: "Good setup.",
      grade: 8,
      submissionId: "submission_id",
    });
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  bodyMd:
                    "Student One attended consistently and is building confidence with one-step equations.",
                }),
              },
            },
          ],
        }),
      )) as typeof fetch;

    const result = await generateProgressReportNarrative(db, {
      apiKey: "openrouter-key",
      fetchFn,
      makeId: () => "report_id",
      periodEnd,
      periodStart,
      provider: "openrouter",
      studentId: "student_id",
    });
    const [report] = await db
      .select()
      .from(progressReports)
      .where(eq(progressReports.id, "report_id"));
    client.close();

    expect(result.report.bodyMd).toContain("building confidence");
    expect(report.bodyMd).toBe(result.report.bodyMd);
    expect(result.history.inputJson).toMatchObject({
      feature: "progress_report",
      facts: {
        assignments: [{ grade: 8, points: 10, title: "Linear practice" }],
        attendance: { present: 1, total: 1 },
        courses: [{ title: "Algebra I" }],
        student: { id: "student_id", name: "Student One" },
      },
      studentId: "student_id",
    });
  });
});
