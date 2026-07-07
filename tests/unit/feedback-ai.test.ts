import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { submissions, schema } from "@/db/schema";
import { draftSubmissionFeedback } from "@/lib/ai/feedback";
import { createAssignment, submitAssignment } from "@/lib/classroom";
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

describe("AI feedback drafts", () => {
  it("drafts feedback from assignment, rubric, and submission context", async () => {
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
      bodyText: "x + 3 = 8, so x = 5",
      makeId: () => "submission_id",
      studentId: "student_id",
    });
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  feedbackMd: "Strong equation setup. Add one sentence explaining inverse operations.",
                }),
              },
            },
          ],
        }),
      )) as typeof fetch;

    const result = await draftSubmissionFeedback(db, {
      apiKey: "openrouter-key",
      fetchFn,
      provider: "openrouter",
      submissionId: "submission_id",
    });
    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, "submission_id"));
    client.close();

    expect(result.submission).toMatchObject({
      feedbackMd: "Strong equation setup. Add one sentence explaining inverse operations.",
      grade: null,
      status: "submitted",
    });
    expect(submission.feedbackMd).toBe(result.submission.feedbackMd);
    expect(result.history.inputJson).toMatchObject({
      assignmentId: "assignment_id",
      feature: "feedback",
      submissionId: "submission_id",
    });
  });
});
