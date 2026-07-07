import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("student and parent see shared session notes and attendance history", async ({ page }) => {
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

  await page.goto("/courses");
  await page.getByLabel("Course title").fill("Algebra I");
  await page.getByLabel("Subject").fill("Math");
  await page.getByLabel("Description").fill("Algebra foundations");
  await page.getByRole("button", { name: /^add course$/i }).click();
  await page
    .getByLabel("Enroll student in Algebra I")
    .selectOption({ label: "Student One (student@example.com)" });
  await page.getByRole("button", { name: /^enroll selected student in Algebra I$/i }).click();

  await page.goto("/schedule");
  await page.getByLabel("Course").selectOption({ label: "Algebra I" });
  await page.getByLabel("Weekday").selectOption("1");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("Duration minutes").fill("60");
  await page.getByRole("button", { name: /^add slot$/i }).click();
  await page.getByRole("button", { name: /^generate sessions$/i }).click();
  await expect(page.getByText(/Created 2 sessions/)).toBeVisible();
  await page.getByLabel("Session status for Algebra I").selectOption("done");
  await page.getByRole("button", { name: /^save status for Algebra I$/i }).click();
  await page.getByLabel("Attendance for Student One").selectOption("late");
  await page.getByRole("button", { name: /^save attendance record for Student One$/i }).click();
  await expect(page).toHaveURL(/attendanceUpdated=1/);
  await expect(page.getByLabel("Attendance for Student One")).toHaveValue("late");
  await page.getByLabel("Private notes for Algebra I").fill("Tutor-only observation");
  await page.getByLabel("Shared notes for Algebra I").fill("We covered linear equations");
  await page.getByRole("button", { name: /^save notes for Algebra I$/i }).click();
  await expect(page).toHaveURL(/notesUpdated=1/);
  await expect(page.getByLabel("Shared notes for Algebra I")).toHaveValue(
    "We covered linear equations",
  );

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  const studentSession = page.getByRole("article").filter({
    hasText: "We covered linear equations",
  });
  await expect(studentSession.getByText("Algebra I")).toBeVisible();
  await expect(studentSession.getByText("Late")).toBeVisible();
  await expect(studentSession.getByText("We covered linear equations")).toBeVisible();
  await expect(page.getByText("Tutor-only observation")).toHaveCount(0);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("parent@example.com");
  await page.getByLabel("Password").fill("parent password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^overview$/i })).toBeVisible();
  const parentSession = page.getByRole("article").filter({
    hasText: "We covered linear equations",
  });
  await expect(parentSession.getByText("Student One")).toBeVisible();
  await expect(parentSession.getByText("Algebra I")).toBeVisible();
  await expect(parentSession.getByText("Late")).toBeVisible();
  await expect(parentSession.getByText("We covered linear equations")).toBeVisible();
  await expect(page.getByText("Tutor-only observation")).toHaveCount(0);
});
