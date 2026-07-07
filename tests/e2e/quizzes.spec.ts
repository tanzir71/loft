import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor builds a quiz with a previewed multiple-choice question", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/courses");
  await page.getByLabel("Course title").fill("Algebra I");
  await page.getByLabel("Subject").fill("Math");
  await page.getByLabel("Description").fill("Algebra foundations");
  await page.getByRole("button", { name: /^add course$/i }).click();

  await page.goto("/quizzes");
  await page.getByLabel("Quiz title").fill("Equations quiz");
  await page.getByLabel("Instructions").fill("Show your work.");
  await page.getByRole("button", { name: /^add quiz$/i }).click();
  await expect(page.getByText("Equations quiz")).toBeVisible();

  await page.getByPlaceholder("Question prompt").fill("Solve `x + 3 = 8`.");
  await page.getByPlaceholder("a|First option").fill("a|x = 2\nb|x = 5");
  await page.getByRole("textbox", { exact: true, name: "Correct ID" }).fill("b");
  await page.getByRole("button", { name: /^add question$/i }).click();

  await expect(page.locator("p").filter({ hasText: "Solve `x + 3 = 8`." })).toBeVisible();
  await expect(page.getByText("Correct option: b")).toBeVisible();
});
