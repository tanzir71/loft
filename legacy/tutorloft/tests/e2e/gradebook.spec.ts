import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

async function seedGradebookFixture() {
  const client = createClient({ url: "file:./data/e2e.db" });
  const now = 1783438000000;

  await client.batch(
    [
      {
        sql: `insert into users (id, name, email, password_hash, role, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["student_id", "Student One", "student@example.com", "hash", "student", "active", now, now],
      },
      {
        sql: `insert into users (id, name, email, password_hash, role, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["other_student_id", "Student Two", "other@example.com", "hash", "student", "active", now, now],
      },
      {
        sql: `insert into courses (id, title, subject, description, status, default_rate_plan_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["course_id", "Algebra I", "Math", "Algebra foundations", "active", null, now, now],
      },
      {
        sql: `insert into enrollments (id, course_id, student_id, rate_plan_id, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)`,
        args: ["enrollment_id", "course_id", "student_id", null, "active", now, now],
      },
      {
        sql: `insert into enrollments (id, course_id, student_id, rate_plan_id, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)`,
        args: ["other_enrollment_id", "course_id", "other_student_id", null, "active", now, now],
      },
      {
        sql: `insert into assignments (id, course_id, title, body_md, rubric_md, due_at, points, status, allow_text, allow_link, allow_file, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["assignment_id", "course_id", "Linear practice", "Solve.", null, null, 10, "published", 1, 1, 0, now, now],
      },
      {
        sql: `insert into submissions (id, assignment_id, student_id, body_text, link_url, submitted_at, status, grade, feedback_md, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["submission_id", "assignment_id", "student_id", "Complete", null, now, "returned", 8, "Good work.", now, now],
      },
      {
        sql: `insert into quizzes (id, course_id, title, instructions_md, status, open_at, close_at, time_limit_min, max_attempts, shuffle, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["quiz_id", "course_id", "Equations quiz", "", "published", null, null, null, 1, 0, now, now],
      },
      {
        sql: `insert into quiz_questions (id, quiz_id, type, prompt_md, options_json, answer_json, points, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "question_a",
          "quiz_id",
          "mcq_single",
          "Solve.",
          JSON.stringify({ options: [{ id: "a", text: "x = 2" }, { id: "b", text: "x = 5" }] }),
          JSON.stringify({ correctOptionId: "b" }),
          4,
          0,
          now,
          now,
        ],
      },
      {
        sql: `insert into quiz_questions (id, quiz_id, type, prompt_md, options_json, answer_json, points, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["question_b", "quiz_id", "true_false", "True?", null, JSON.stringify({ value: true }), 6, 1, now, now],
      },
      {
        sql: `insert into quiz_attempts (id, quiz_id, student_id, started_at, submitted_at, auto_score, final_score, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["attempt_id", "quiz_id", "student_id", now, now + 60_000, 9, 9, "graded", now, now + 60_000],
      },
    ],
    "write",
  );
  client.close();
}

test("tutor views course gradebook with missing marks, averages, and CSV export", async ({
  page,
}) => {
  await seedGradebookFixture();
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/gradebook?courseId=course_id");
  await expect(page.getByRole("heading", { name: /^gradebook$/i })).toBeVisible();
  await expect(page.getByText("Linear practice")).toBeVisible();
  await expect(page.getByText("Equations quiz")).toBeVisible();
  await expect(page.getByRole("row", { name: /Student One/ })).toContainText("8/10");
  await expect(page.getByRole("row", { name: /Student One/ })).toContainText("9/10");
  await expect(page.getByRole("row", { name: /Student One/ })).toContainText("85%");
  await expect(page.getByRole("row", { name: /Student Two/ })).toContainText("Missing");

  const csvHref = await page.getByRole("link", { name: /^export csv$/i }).getAttribute("href");
  const response = await page.request.get(csvHref ?? "/gradebook/results.csv?courseId=course_id");
  expect(response.headers()["content-type"]).toContain("text/csv");
  await expect(response).toBeOK();
  await expect(response.text()).resolves.toContain("Student One,8/10,9/10,85%");
});
