import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor creates, edits, and archives a student record", async ({ page }) => {
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
  await expect(page.getByText("No linked parents")).toBeVisible();
  await expect(page.getByText("BDT 0")).toBeVisible();

  await page.getByLabel("Name for student@example.com").fill("Student Renamed");
  await page.getByRole("button", { name: /^save student@example.com$/i }).click();
  await expect(page.getByLabel("Name for student@example.com")).toHaveValue("Student Renamed");

  await page.getByRole("button", { name: /^archive student@example.com$/i }).click();
  await expect(page.getByLabel("Status for student@example.com")).toHaveValue("archived");
  await expect(page.locator("span", { hasText: "Archived" })).toBeVisible();
  await expect(page.getByLabel("Name for student@example.com")).toHaveValue("Student Renamed");
});
