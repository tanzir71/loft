import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor publishes an assignment and student submits a revision", async ({ page }) => {
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

  await page.goto("/assignment-builder");
  await page.getByLabel("Title").fill("Linear practice");
  await page.getByLabel("Course").selectOption({ label: "Algebra I" });
  await page.getByLabel("Body").fill("Solve the worksheet.");
  await page.getByLabel("Rubric").fill("Show each step.");
  await page.locator('select[name="status"]').first().selectOption("published");
  await page.getByRole("button", { name: /^add assignment$/i }).click();
  await expect(page.getByText("Linear practice")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  await page.goto("/assignments");
  await expect(page.getByText("Show each step.")).toBeVisible();
  await page.getByPlaceholder("Submission text").fill("First answer");
  await page.getByRole("button", { name: /^submit assignment$/i }).click();
  await page.getByPlaceholder("Submission text").fill("Revised answer");
  await page.getByRole("button", { name: /^submit assignment$/i }).click();
  await expect(page.getByText("Linear practice")).toBeVisible();
});
