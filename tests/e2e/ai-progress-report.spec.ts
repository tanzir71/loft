import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor generates an AI progress report narrative for a student", async ({ page }) => {
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

  await page.goto("/students");
  await page.getByLabel("Student name").fill("Student One");
  await page.getByLabel("Student email").fill("student@example.com");
  await page.getByRole("button", { name: /^add student$/i }).click();
  await expect(page.getByLabel("Name for student@example.com")).toHaveValue("Student One");

  await page.getByRole("button", { name: /^generate AI progress report$/i }).click();
  await expect(page).toHaveURL(/progressReport=1/);
  await expect(page.getByText("AI progress report generated.")).toBeVisible();
  await expect(page.getByText("Latest progress report")).toBeVisible();
  await expect(
    page.getByText(
      "Student One is building confidence with one-step equations and should keep practicing inverse operations.",
    ),
  ).toBeVisible();
});
