import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor downloads JSON backup and invoice CSV exports", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  const backupHref = await page
    .getByRole("link", { name: /^download JSON backup$/i })
    .getAttribute("href");
  expect(backupHref).toBe("/settings/backup.json");
  const backupResponse = await page.request.get(backupHref ?? "/settings/backup.json");
  expect(backupResponse.ok()).toBeTruthy();
  expect(backupResponse.headers()["content-type"]).toContain("application/json");
  const backup = await backupResponse.json();
  expect(backup.tables.users).toEqual(
    expect.arrayContaining([expect.objectContaining({ email: "tutor@example.com" })]),
  );

  await page.goto("/billing");
  const csvHref = await page
    .getByRole("link", { name: /^export invoices csv$/i })
    .getAttribute("href");
  expect(csvHref).toBe("/billing/invoices.csv");
  const csvResponse = await page.request.get(csvHref ?? "/billing/invoices.csv");
  expect(csvResponse.ok()).toBeTruthy();
  expect(csvResponse.headers()["content-type"]).toContain("text/csv");
  expect(await csvResponse.text()).toContain("Invoice,Student,Email,Status,Total,Paid,Balance,Due date");
});
