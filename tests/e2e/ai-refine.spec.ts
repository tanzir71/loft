import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor refines a material with differentiation controls", async ({ page }) => {
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
  await page.getByLabel("Material title").fill("Equation notes");
  await page.getByLabel("Material body", { exact: true }).fill("Solve x + 3 = 8.");
  await page.getByRole("button", { name: /^add material$/i }).click();
  await expect(page.getByText("Equation notes")).toBeVisible();

  await page.locator("summary").filter({ hasText: "Equation notes" }).click();
  await page.getByLabel("Refine action", { exact: true }).selectOption("examples");
  await page.getByLabel("Level", { exact: true }).selectOption("support");
  await page.getByLabel("Bloom level", { exact: true }).selectOption("analyze");
  await page.getByLabel("Reading level", { exact: true }).selectOption("simple");
  await page.getByLabel("Translate to", { exact: true }).fill("Bangla");
  await page.getByLabel("Custom instruction", { exact: true }).fill("Use a local context.");
  await page.getByRole("button", { name: /^refine material$/i }).click();
  await expect(page).toHaveURL(/refinedMaterial=/);
  await expect(page.getByText("AI refinement applied.")).toBeVisible();

  await page.locator("summary").filter({ hasText: "Equation notes" }).click();
  await expect(
    page.locator("p").filter({ hasText: "Refined examples for x + 3 = 8." }).first(),
  ).toBeVisible();
});
