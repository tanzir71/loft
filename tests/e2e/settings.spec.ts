import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor saves and tests masked AI settings", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Provider").selectOption("openrouter");
  await page.getByLabel("Model").fill("openai/gpt-4.1-mini");
  await page.getByLabel("API key").fill("sk-test-1234567890");
  await page.getByRole("button", { name: /^save AI settings$/i }).click();
  await expect(page).toHaveURL(/ai=saved/);
  await expect(page.getByText("AI settings saved.")).toBeVisible();
  await expect(page.getByText("Saved key: sk-t...7890")).toBeVisible();
  await expect(page.getByLabel("Model")).toHaveValue("openai/gpt-4.1-mini");

  await page.getByRole("button", { name: /^test AI key$/i }).click();
  await expect(page).toHaveURL(/aiTest=ok/);
  await expect(page.getByText("AI key decrypted successfully.")).toBeVisible();
  await expect(page.getByText("Saved key: sk-t...7890")).toBeVisible();
});
