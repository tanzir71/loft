import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("dashboard shows recent student and course activity", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/students");
  await page.getByLabel("Student name").fill("Student One");
  await page.getByLabel("Student email").fill("student@example.com");
  await page.getByRole("button", { name: /^add student$/i }).click();
  await expect(page.getByLabel("Name for student@example.com")).toHaveValue("Student One");

  await page.goto("/courses");
  await page.getByLabel("Course title").fill("Algebra I");
  await page.getByLabel("Subject").fill("Math");
  await page.getByLabel("Description").fill("Algebra foundations");
  await page.getByRole("button", { name: /^add course$/i }).click();
  await expect(page.getByLabel("Title for Algebra I")).toHaveValue("Algebra I");

  await page.goto("/dashboard");
  const recentActivity = page.getByRole("region", { name: /^recent activity$/i });

  await expect(recentActivity).toBeVisible();
  await expect(recentActivity.getByText("Course created")).toBeVisible();
  await expect(recentActivity.getByText("Algebra I")).toBeVisible();
  await expect(recentActivity.getByText("Student created")).toBeVisible();
  await expect(recentActivity.getByText("Student One")).toBeVisible();
});
