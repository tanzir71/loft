import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor creates, edits, and archives a rate plan", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/billing");
  await page.getByLabel("Rate plan name").fill("Per session");
  await page.getByLabel("Plan type").selectOption("per_session");
  await page.getByLabel("Amount minor units").fill("150000");
  await page.getByRole("button", { name: /^add rate plan$/i }).click();

  await expect(page.getByLabel("Name for Per session")).toHaveValue("Per session");
  await page.getByLabel("Name for Per session").fill("Updated per session");
  await page.getByLabel("Amount for Per session").fill("175000");
  await page.getByRole("button", { name: /^save Per session$/i }).click();
  await expect(page.getByLabel("Name for Updated per session")).toHaveValue(
    "Updated per session",
  );

  await page.getByRole("button", { name: /^archive Updated per session$/i }).click();
  await expect(page.locator("span", { hasText: "Inactive" })).toBeVisible();
});
