import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor generates, edits, and materializes an AI course outline", async ({ page }) => {
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
  await page.getByLabel("Course outline goal").fill("Build a short algebra introduction.");
  await page.getByLabel("Source notes", { exact: true }).fill("Students need confidence with variables.");
  await page.getByRole("button", { name: /^generate AI outline$/i }).click();
  await expect(page).toHaveURL(/outlinePlan=/);
  await expect(page.getByRole("heading", { name: /^editable AI outline$/i })).toBeVisible();
  await expect(page.getByLabel("Module 1 title")).toHaveValue("AI foundations");

  await page.getByLabel("Module 1 title").fill("Edited AI foundations");
  await page.getByLabel("Material 1 title").fill("Edited diagnostic");
  await page.getByRole("button", { name: /^materialize AI outline$/i }).click();
  await expect(page).toHaveURL(/outlineMaterialized=1/);
  await expect(page.getByText("AI outline materialized.")).toBeVisible();
  await expect(page.getByLabel("Title for Edited AI foundations")).toHaveValue(
    "Edited AI foundations",
  );
  await expect(page.getByText("Edited diagnostic")).toBeVisible();
});
