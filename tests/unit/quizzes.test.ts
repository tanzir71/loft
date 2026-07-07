import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import { createCourse } from "@/lib/courses";
import {
  answerSummary,
  createQuiz,
  createQuizQuestion,
  listQuizBuilder,
  parseQuestionAnswer,
  updateQuiz,
  updateQuizQuestion,
} from "@/lib/quizzes";
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
  });

  return { client, db };
}

describe("quiz builder", () => {
  it("creates and edits quizzes with four question types and zod answer schemas", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    const quiz = await createQuiz(db, {
      courseId: "course_id",
      instructionsMd: "Show your work.",
      makeId: () => "quiz_id",
      maxAttempts: 2,
      title: "Equations quiz",
    });
    await updateQuiz(db, {
      id: quiz.id,
      instructionsMd: "Show your work. No calculators.",
      maxAttempts: 3,
      status: "published",
      timeLimitMin: 20,
      title: "Linear equations quiz",
    });
    await createQuizQuestion(db, {
      answerJson: { correctOptionId: "b" },
      makeId: () => "single_id",
      optionsJson: {
        options: [
          { id: "a", text: "x = 2" },
          { id: "b", text: "x = 5" },
        ],
      },
      points: 2,
      promptMd: "Solve `x + 3 = 8`.",
      quizId: "quiz_id",
      sortOrder: 0,
      type: "mcq_single",
    });
    await createQuizQuestion(db, {
      answerJson: { correctOptionIds: ["a", "c"] },
      makeId: () => "multi_id",
      optionsJson: {
        options: [
          { id: "a", text: "2x" },
          { id: "b", text: "x + x + 1" },
          { id: "c", text: "x + x" },
        ],
      },
      points: 3,
      promptMd: "Pick equivalent expressions.",
      quizId: "quiz_id",
      sortOrder: 1,
      type: "mcq_multi",
    });
    await createQuizQuestion(db, {
      answerJson: { value: true },
      makeId: () => "tf_id",
      optionsJson: null,
      points: 1,
      promptMd: "`2x = 10` has solution `x = 5`.",
      quizId: "quiz_id",
      sortOrder: 2,
      type: "true_false",
    });
    await createQuizQuestion(db, {
      answerJson: { acceptedAnswers: ["combine like terms"] },
      makeId: () => "short_id",
      optionsJson: null,
      points: 4,
      promptMd: "Name the first step.",
      quizId: "quiz_id",
      sortOrder: 3,
      type: "short_answer",
    });
    const edited = await updateQuizQuestion(db, {
      answerJson: { acceptedAnswers: ["combine like terms", "simplify both sides"] },
      id: "short_id",
      optionsJson: null,
      points: 5,
      promptMd: "Name a valid first step.",
      sortOrder: 3,
      type: "short_answer",
    });

    const builder = await listQuizBuilder(db, "course_id");
    client.close();

    expect(() => parseQuestionAnswer("mcq_single", { correctOptionIds: ["a"] })).toThrow();
    expect(answerSummary("true_false", { value: true })).toBe("True");
    expect(edited.points).toBe(5);
    expect(builder).toHaveLength(1);
    expect(builder[0].quiz).toMatchObject({
      maxAttempts: 3,
      status: "published",
      timeLimitMin: 20,
      title: "Linear equations quiz",
    });
    expect(builder[0].questions.map((question) => question.type)).toEqual([
      "mcq_single",
      "mcq_multi",
      "true_false",
      "short_answer",
    ]);
  });
});
