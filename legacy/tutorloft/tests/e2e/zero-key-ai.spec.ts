import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("zero-key mode hides AI controls while manual lesson plans still work", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/courses");
  await page.getByLabel("Course title").fill("Algebra I");
  await page.getByLabel("Subject").fill("Math");
  await page.getByLabel("Description").fill("Foundations for linear equations");
  await page.getByRole("button", { name: /^add course$/i }).click();
  await expect(page.getByLabel("Title for Algebra I")).toHaveValue("Algebra I");

  await page.goto("/content");
  await expect(page.getByRole("button", { name: /^generate AI outline$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^generate AI lesson plan$/i })).toHaveCount(0);
  await page.getByLabel("Material title").fill("Manual lesson plan");
  await page.getByLabel("Material type").selectOption("lesson_plan");
  await page.getByLabel("Material visibility").selectOption("tutor_only");
  await page
    .locator('textarea[name="planSection:objectives:body"]')
    .fill("Students solve one-step equations by undoing operations.");
  await page
    .locator('textarea[name="planSection:practice:body"]')
    .fill("Solve x + 3 = 8 and y - 4 = 9.");
  await page.getByLabel("Material body", { exact: true }).fill("Bring equation cards.");
  await page.getByRole("button", { name: /^add material$/i }).click();
  await expect(page.getByText("Manual lesson plan")).toBeVisible();

  await page.locator("summary").filter({ hasText: "Manual lesson plan" }).click();
  await expect(page.getByRole("button", { name: /^refine material$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^generate derived resources$/i })).toHaveCount(0);
  await expect(
    page
      .locator("p")
      .filter({ hasText: "Students solve one-step equations by undoing operations." })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator("p").filter({ hasText: "Solve x + 3 = 8 and y - 4 = 9." }).first(),
  ).toBeVisible();

  await page.goto("/grading");
  await expect(page.getByRole("button", { name: /^draft AI feedback$/i })).toHaveCount(0);
  await page.goto("/students");
  await expect(page.getByRole("button", { name: /^generate AI progress report$/i })).toHaveCount(0);
});
