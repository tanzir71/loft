import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { attendance, classSessions, progressReports, schema } from "@/db/schema";
import { createAssignment, gradeSubmission, submitAssignment } from "@/lib/classroom";
import { createCourse, enrollStudent } from "@/lib/courses";
import {
  generateMonthlyProgressReports,
  generateNumbersOnlyProgressReport,
  updateProgressReport,
} from "@/lib/progress-reports";
import { seedTutor } from "@/lib/seed";
import { archiveStudent, createStudent } from "@/lib/students";

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

describe("progress reports", () => {
  it("generates and edits a numbers-only report from structured facts", async () => {
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

    const generated = await generateNumbersOnlyProgressReport(db, {
      makeId: () => "report_id",
      now: () => Date.UTC(2026, 6, 10),
      periodEnd,
      periodStart,
      studentId: "student_id",
    });
    const updated = await updateProgressReport(db, {
      bodyMd: "Edited parent-ready note.",
      id: "report_id",
    });
    const [stored] = await db
      .select()
      .from(progressReports)
      .where(eq(progressReports.id, "report_id"));
    client.close();

    expect(generated.report.bodyMd).toContain("Progress report: Student One");
    expect(generated.report.bodyMd).toContain("Attendance rate: 100%");
    expect(generated.report.bodyMd).toContain("Linear practice (Algebra I): 8/10");
    expect(updated.bodyMd).toBe("Edited parent-ready note.");
    expect(stored.bodyMd).toBe("Edited parent-ready note.");
  });

  it("batch-generates monthly reports for active students only", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "one@example.com",
      makeId: () => "student_one",
      name: "Student One",
    });
    await createStudent(db, {
      email: "two@example.com",
      makeId: () => "student_two",
      name: "Student Two",
    });
    await createStudent(db, {
      email: "archived@example.com",
      makeId: () => "archived_student",
      name: "Archived Student",
    });
    await archiveStudent(db, { id: "archived_student" });

    const result = await generateMonthlyProgressReports(db, {
      makeId: (index) => `report_${index}`,
      now: () => Date.UTC(2026, 6, 31, 12),
      periodEnd: Date.UTC(2026, 6, 31, 23, 59),
      periodStart: Date.UTC(2026, 6, 1),
    });
    const rows = await db.select().from(progressReports);
    client.close();

    expect(result).toEqual({ created: 2, skipped: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.studentId).sort()).toEqual(["student_one", "student_two"]);
  });
});
