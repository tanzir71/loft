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

test("student starts, autosaves, and submits a quiz attempt", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: /^create invite$/i }).click();
  await expect(page).toHaveURL(/\/settings\?created=/);
  const inviteCode = new URL(page.url()).searchParams.get("created");
  expect(inviteCode).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`/join/${inviteCode}`);
  await page.getByLabel("Name").fill("Student One");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^join$/i }).click();
  await expect(page).toHaveURL(/\/home$/);

  await page.context().clearCookies();
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
  await page
    .getByLabel("Enroll student in Algebra I")
    .selectOption({ label: "Student One (student@example.com)" });
  await page.getByRole("button", { name: /^enroll selected student in Algebra I$/i }).click();

  await page.goto("/quizzes");
  await page.getByLabel("Quiz title").fill("Equations quiz");
  await page.getByLabel("Instructions").fill("Show your work.");
  await page.locator('select[name="status"]').first().selectOption("published");
  await page.getByRole("button", { name: /^add quiz$/i }).click();
  await page.getByPlaceholder("Question prompt").fill("Solve `x + 3 = 8`.");
  await page.getByPlaceholder("a|First option").fill("a|x = 2\nb|x = 5");
  await page.getByRole("textbox", { exact: true, name: "Correct ID" }).fill("b");
  await page.getByRole("button", { name: /^add question$/i }).click();
  await expect(page.getByText("Correct option: b")).toBeVisible();
  const quizHref = await page.getByRole("link", { name: /^student view$/i }).getAttribute("href");
  expect(quizHref).toBeTruthy();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  await page.goto(quizHref ?? "/home");
  await page.getByRole("button", { name: /^start quiz$/i }).click();
  await page.getByLabel("x = 5").check();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: /^submit quiz$/i }).click();
  await expect(page.getByText("Submitted")).toBeVisible();
  await expect(page.getByText("Score")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await page.goto("/quizzes");
  await expect(page.getByRole("cell", { name: "Equations quiz" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Student One" })).toBeVisible();
  const csvHref = await page.getByRole("link", { name: /^export csv$/i }).getAttribute("href");
  expect(csvHref).toBeTruthy();
  const csvResponse = await page.request.get(csvHref ?? "/quizzes/results.csv");
  expect(csvResponse.ok()).toBeTruthy();
  expect(await csvResponse.text()).toContain("Equations quiz,Student One,graded,1,1,");
});
