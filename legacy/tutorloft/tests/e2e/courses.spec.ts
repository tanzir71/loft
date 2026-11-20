import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor creates, edits, archives, and manages course enrollment", async ({ page }) => {
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
  await page.getByLabel("Title for Algebra I").fill("Algebra IA");
  await page.getByRole("button", { name: /^save Algebra I$/i }).click();
  await expect(page.getByLabel("Title for Algebra IA")).toHaveValue("Algebra IA");

  await page
    .getByLabel("Enroll student in Algebra IA")
    .selectOption({ label: "Student One (student@example.com)" });
  await page.getByRole("button", { name: /^enroll selected student in Algebra IA$/i }).click();
  await expect(
    page.getByRole("listitem").getByText("Student One (student@example.com)"),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /^unenroll student@example.com from Algebra IA$/i })
    .click();
  await expect(page.getByText("No enrolled students")).toBeVisible();

  await page.getByRole("button", { name: /^archive Algebra IA$/i }).click();
  await expect(page.getByLabel("Status for Algebra IA")).toHaveValue("archived");
  await expect(page.locator("span", { hasText: "Archived" })).toBeVisible();
});

test("student home lists enrolled courses", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: /^create invite$/i }).click();
  await expect(page).toHaveURL(/\/settings\?created=/);
  const inviteCode = new URL(page.url()).searchParams.get("created");
  expect(inviteCode).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`/join/${inviteCode}`);
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

  await page.goto("/courses");
  await page.getByLabel("Course title").fill("Algebra I");
  await page.getByLabel("Subject").fill("Math");
  await page.getByLabel("Description").fill("Algebra foundations");
  await page.getByRole("button", { name: /^add course$/i }).click();
  await page
    .getByLabel("Enroll student in Algebra I")
    .selectOption({ label: "Student One (student@example.com)" });
  await page.getByRole("button", { name: /^enroll selected student in Algebra I$/i }).click();
  await expect(
    page.getByRole("listitem").getByText("Student One (student@example.com)"),
  ).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  await expect(page.getByText("Algebra I")).toBeVisible();
  await expect(page.getByText("Math")).toBeVisible();
  await expect(page.getByText("Algebra foundations")).toBeVisible();
});
