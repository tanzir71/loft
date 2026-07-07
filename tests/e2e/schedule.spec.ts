import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor manages weekly slots and generates sessions idempotently", async ({ page }) => {
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
  await page
    .getByLabel("Enroll student in Algebra I")
    .selectOption({ label: "Student One (student@example.com)" });
  await page.getByRole("button", { name: /^enroll selected student in Algebra I$/i }).click();
  await expect(
    page.getByRole("listitem").getByText("Student One (student@example.com)"),
  ).toBeVisible();

  await page.goto("/schedule");
  await page.getByLabel("Course").selectOption({ label: "Algebra I" });
  await page.getByLabel("Weekday").selectOption("1");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("Duration minutes").fill("60");
  await page.getByRole("button", { name: /^add slot$/i }).click();

  await expect(page.locator("span", { hasText: "Monday" })).toBeVisible();
  await expect(page.locator("span", { hasText: "09:00" })).toBeVisible();
  await expect(page.locator("span", { hasText: "60 min" })).toBeVisible();

  await page.getByLabel("Weekday for Algebra I").selectOption("2");
  await page.getByLabel("Start time for Algebra I").fill("10:00");
  await page.getByLabel("Duration minutes for Algebra I").fill("90");
  await page.getByRole("button", { name: /^save slot for Algebra I$/i }).click();
  await expect(page.locator("span", { hasText: "Tuesday" })).toBeVisible();
  await expect(page.locator("span", { hasText: "10:00" })).toBeVisible();
  await expect(page.locator("span", { hasText: "90 min" })).toBeVisible();

  await page.getByLabel("Weeks to generate").fill("2");
  await page.getByRole("button", { name: /^generate sessions$/i }).click();
  await expect(page.getByText("Created 2 sessions. Skipped 0 existing sessions.")).toBeVisible();
  await page.getByLabel("Session status for Algebra I").selectOption("done");
  await page.getByRole("button", { name: /^save status for Algebra I$/i }).click();
  await expect(page.locator("span", { hasText: "Done" })).toBeVisible();
  await expect(page.getByLabel("Attendance for Student One")).toHaveValue("present");
  await page.getByLabel("Attendance for Student One").selectOption("late");
  await page.getByRole("button", { name: /^save attendance record for Student One$/i }).click();
  await expect(page.getByLabel("Attendance for Student One")).toHaveValue("late");

  await page.getByLabel("Weeks to generate").fill("2");
  await page.getByRole("button", { name: /^generate sessions$/i }).click();
  await expect(page.getByText("Created 0 sessions. Skipped 2 existing sessions.")).toBeVisible();

  await page.getByRole("button", { name: /^deactivate slot for Algebra I$/i }).click();
  await expect(page.locator("span", { hasText: "Inactive" })).toBeVisible();
});
