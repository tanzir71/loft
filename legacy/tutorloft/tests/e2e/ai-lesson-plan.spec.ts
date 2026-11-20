import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor generates an AI lesson plan and regenerates one section", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Provider").selectOption("openrouter");
  await page.getByLabel("API key").fill("sk-test-1234567890");
  await page.getByRole("button", { name: /^save AI settings$/i }).click();
  await expect(page).toHaveURL(/ai=saved/);

  await page.goto("/courses");
  await page.getByLabel("Course title").fill("Algebra I");
  await page.getByLabel("Subject").fill("Math");
  await page.getByLabel("Description").fill("Foundations for linear equations");
  await page.getByRole("button", { name: /^add course$/i }).click();
  await expect(page.getByLabel("Title for Algebra I")).toHaveValue("Algebra I");

  await page.goto("/content");
  await page.getByLabel("Framework", { exact: true }).fill("Custom");
  await page.getByLabel("Code", { exact: true }).fill("A1");
  await page.getByLabel("Description", { exact: true }).fill("Solve one-step equations");
  await page.getByRole("button", { name: /^add standard$/i }).click();
  const aiStandard = page.locator("label").filter({ hasText: "Custom A1" }).first();
  await expect(aiStandard).toBeVisible();

  await page.getByLabel("AI lesson plan title").fill("One-step equations");
  await aiStandard.locator("input").check();
  await page.getByLabel("Lesson source notes").fill("Students need guided equation practice.");
  await page.getByRole("button", { name: /^generate AI lesson plan$/i }).click();
  await expect(page).toHaveURL(/lessonPlanCreated=/);
  await expect(page.getByText("AI lesson plan created.")).toBeVisible();

  await page.locator("summary").filter({ hasText: "One-step equations" }).click();
  await expect(
    page.locator("p").filter({ hasText: "Students solve one-step equations." }).first(),
  ).toBeVisible();
  await expect(
    page.locator("p").filter({ hasText: "Guided equation practice." }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: /^regenerate objectives$/i }).click();
  await expect(page).toHaveURL(/lessonSectionRegenerated=/);
  await expect(page.getByText("Lesson plan section regenerated.")).toBeVisible();

  await page.locator("summary").filter({ hasText: "One-step equations" }).click();
  await expect(
    page.locator("p").filter({ hasText: "Regenerated objectives with an exit check." }).first(),
  ).toBeVisible();
  await expect(
    page.locator("p").filter({ hasText: "Guided equation practice." }).first(),
  ).toBeVisible();
});
