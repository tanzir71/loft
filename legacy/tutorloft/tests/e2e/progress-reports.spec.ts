import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor generates, edits, prints, and shares a progress report", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: /^create invite$/i }).click();
  await expect(page).toHaveURL(/\/settings\?created=/);
  const studentInvite = new URL(page.url()).searchParams.get("created");
  expect(studentInvite).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`/join/${studentInvite}`);
  await page.getByLabel("Name").fill("Student One");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^join$/i }).click();
  await expect(page).toHaveURL(/\/home$/);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await page.goto("/settings");
  await page.getByLabel("Role").selectOption("parent");
  await page
    .getByLabel("Linked student for parent invites")
    .selectOption({ label: "Student One (student@example.com)" });
  await page.getByRole("button", { name: /^create invite$/i }).click();
  await expect(page).toHaveURL(/\/settings\?created=/);
  const parentInvite = new URL(page.url()).searchParams.get("created");
  expect(parentInvite).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`/join/${parentInvite}`);
  await page.getByLabel("Name").fill("Parent One");
  await page.getByLabel("Email").fill("parent@example.com");
  await page.getByLabel("Password").fill("parent password");
  await page.getByRole("button", { name: /^join$/i }).click();
  await expect(page).toHaveURL(/\/overview$/);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await page.goto("/students");
  await page.getByRole("button", { name: /^generate progress report for Student One$/i }).click();
  await expect(page.getByText("Progress report generated.")).toBeVisible();
  await page.getByLabel("Report body for Student One").fill("Edited parent-ready note.");
  await page.getByRole("button", { name: /^save progress report for Student One$/i }).click();
  await expect(page.getByText("Progress report updated.")).toBeVisible();
  await page.getByRole("link", { name: /^view progress report for Student One$/i }).click();
  await expect(page.getByRole("heading", { name: /^Progress report: Student One$/ })).toBeVisible();
  await expect(page.getByText("Edited parent-ready note.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^copy share link$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^print$/i })).toBeVisible();
  const reportUrl = page.url();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Progress reports$/i })).toBeVisible();
  await expect(page.getByText("Edited parent-ready note.")).toBeVisible();
  await page.goto(reportUrl);
  await expect(page.getByText("Edited parent-ready note.")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("parent@example.com");
  await page.getByLabel("Password").fill("parent password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^overview$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Progress reports$/i })).toBeVisible();
  await expect(page.getByText("Student One").first()).toBeVisible();
  await expect(page.getByText("Edited parent-ready note.")).toBeVisible();
  await page.goto(reportUrl);
  await expect(page.getByText("Edited parent-ready note.")).toBeVisible();
});
