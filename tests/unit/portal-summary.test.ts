import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import { createCourse, enrollStudent } from "@/lib/courses";
import { createQuiz, listStudentQuizCards } from "@/lib/quizzes";
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

describe("portal summaries", () => {
  it("lists open quiz cards for an enrolled student", async () => {
    const { client, db } = await createMigratedDb();
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
    await createQuiz(db, {
      closeAt: Date.UTC(2026, 6, 31),
      courseId: "course_id",
      makeId: () => "quiz_id",
      now: () => Date.UTC(2026, 6, 1),
      openAt: Date.UTC(2026, 6, 1),
      status: "published",
      title: "Equations quiz",
    });
    await createQuiz(db, {
      courseId: "course_id",
      makeId: () => "draft_quiz_id",
      status: "draft",
      title: "Draft quiz",
    });

    const cards = await listStudentQuizCards(db, {
      now: Date.UTC(2026, 6, 10),
      studentId: "student_id",
    });
    client.close();

    expect(cards).toEqual([
      expect.objectContaining({
        attemptsUsed: 0,
        courseTitle: "Algebra I",
        id: "quiz_id",
        title: "Equations quiz",
      }),
    ]);
  });
});
