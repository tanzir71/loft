import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { quizAttempts, schema } from "@/db/schema";
import { createAssignment, gradeSubmission, submitAssignment } from "@/lib/classroom";
import { createCourse, enrollStudent } from "@/lib/courses";
import { getCourseGradebook, gradebookCsv } from "@/lib/gradebook";
import { createQuiz, createQuizQuestion } from "@/lib/quizzes";
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

describe("gradebook", () => {
  it("builds course rows across assignments and quizzes with averages, pending, missing, and CSV", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 7, 12);
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createStudent(db, {
      email: "other@example.com",
      makeId: () => "other_student_id",
      name: "Student Two",
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
    await enrollStudent(db, {
      courseId: "course_id",
      makeId: () => "other_enrollment_id",
      studentId: "other_student_id",
    });
    await createAssignment(db, {
      bodyMd: "Solve.",
      courseId: "course_id",
      makeId: () => "assignment_id",
      points: 10,
      status: "published",
      title: "Linear practice",
    });
    await createAssignment(db, {
      bodyMd: "Reflect.",
      courseId: "course_id",
      makeId: () => "pending_assignment_id",
      points: 5,
      status: "published",
      title: "Reflection",
    });
    await submitAssignment(db, {
      assignmentId: "assignment_id",
      bodyText: "Complete",
      makeId: () => "submission_id",
      now: () => now,
      studentId: "student_id",
    });
    await gradeSubmission(db, {
      actor: { id: "tutor_id", role: "tutor" },
      feedbackMd: "Good work.",
      grade: 8,
      submissionId: "submission_id",
    });
    await submitAssignment(db, {
      assignmentId: "pending_assignment_id",
      bodyText: "Draft",
      makeId: () => "pending_submission_id",
      now: () => now,
      studentId: "student_id",
    });
    await createQuiz(db, {
      courseId: "course_id",
      makeId: () => "quiz_id",
      status: "published",
      title: "Equations quiz",
    });
    await createQuizQuestion(db, {
      answerJson: { correctOptionId: "b" },
      makeId: () => "quiz_question_a",
      optionsJson: {
        options: [
          { id: "a", text: "x = 2" },
          { id: "b", text: "x = 5" },
        ],
      },
      points: 4,
      promptMd: "Solve.",
      quizId: "quiz_id",
      sortOrder: 0,
      type: "mcq_single",
    });
    await createQuizQuestion(db, {
      answerJson: { value: true },
      makeId: () => "quiz_question_b",
      optionsJson: null,
      points: 6,
      promptMd: "True?",
      quizId: "quiz_id",
      sortOrder: 1,
      type: "true_false",
    });
    await db.insert(quizAttempts).values({
      id: "attempt_id",
      autoScore: 9,
      createdAt: now,
      finalScore: 9,
      quizId: "quiz_id",
      startedAt: now,
      status: "graded",
      studentId: "student_id",
      submittedAt: now + 60_000,
      updatedAt: now + 60_000,
    });

    const gradebook = await getCourseGradebook(db, { courseId: "course_id" });
    const csv = await gradebookCsv(db, { courseId: "course_id" });
    client.close();

    expect(gradebook.columns.map((column) => column.title)).toEqual([
      "Linear practice",
      "Reflection",
      "Equations quiz",
    ]);
    expect(gradebook.rows).toMatchObject([
      {
        averagePercent: 85,
        cells: [
          { earned: 8, possible: 10, status: "graded" },
          { earned: null, possible: 5, status: "pending" },
          { earned: 9, possible: 10, status: "graded" },
        ],
        studentName: "Student One",
      },
      {
        averagePercent: 0,
        cells: [
          { earned: null, possible: 10, status: "missing" },
          { earned: null, possible: 5, status: "missing" },
          { earned: null, possible: 10, status: "missing" },
        ],
        studentName: "Student Two",
      },
    ]);
    expect(csv).toContain("Student,Assignment: Linear practice (10),Assignment: Reflection (5),Quiz: Equations quiz (10),Average");
    expect(csv).toContain("Student One,8/10,Pending,9/10,85%");
    expect(csv).toContain("Student Two,Missing,Missing,Missing,0%");
  });
});
