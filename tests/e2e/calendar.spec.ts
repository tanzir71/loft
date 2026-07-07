import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor regenerates an ICS feed URL that serves a calendar", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: /^generate calendar feed$/i }).click();
  await expect(
    page.getByRole("button", { name: /^regenerate calendar feed$/i }),
  ).toBeVisible();

  const feedUrl = await page.locator("code", { hasText: "/api/ics/" }).textContent();
  expect(feedUrl).toBeTruthy();
  const response = await page.request.get(feedUrl!);
  const body = await response.text();

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/calendar");
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("END:VCALENDAR");
});
