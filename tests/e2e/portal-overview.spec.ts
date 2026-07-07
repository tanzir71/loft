import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("student and parent portals show action summaries", async ({ page }) => {
  test.setTimeout(90_000);

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

  await page.goto("/assignment-builder");
  await page.getByLabel("Title").fill("Linear practice");
  await page.getByLabel("Course").selectOption({ label: "Algebra I" });
  await page.getByLabel("Body").fill("Solve the worksheet.");
  await page.locator('select[name="status"]').first().selectOption("published");
  await page.getByRole("button", { name: /^add assignment$/i }).click();
  await expect(page.getByText("Linear practice")).toBeVisible();

  await page.goto("/quizzes");
  await page.getByLabel("Quiz title").fill("Equations quiz");
  await page.getByLabel("Instructions").fill("Show your work.");
  await page.locator('select[name="status"]').first().selectOption("published");
  await page.getByRole("button", { name: /^add quiz$/i }).click();
  await expect(page.getByText("Equations quiz")).toBeVisible();

  await page.goto("/billing");
  await page.getByLabel("Rate plan name").fill("Starter package");
  await page.getByLabel("Plan type").selectOption("package");
  await page.getByLabel("Amount minor units").fill("300000");
  await page.getByLabel("Sessions count").fill("2");
  await page.getByRole("button", { name: /^add rate plan$/i }).click();
  await expect(page.getByLabel("Name for Starter package")).toHaveValue("Starter package");
  await page.getByLabel("Package student").selectOption({
    label: "Student One (student@example.com)",
  });
  await page.getByLabel("Package plan").selectOption({ label: "Starter package (2 sessions)" });
  await page.getByLabel("Purchase date").fill("2026-07-01");
  await page.getByRole("button", { name: /^sell package$/i }).click();
  await expect(page).toHaveURL(/packageSold=1/);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Action summary$/i })).toBeVisible();
  await expect(page.getByText("Outstanding balance")).toBeVisible();
  await expect(page.getByText("300000")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Due assignments$/i })).toBeVisible();
  await expect(page.getByText("Linear practice")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Open quizzes$/i })).toBeVisible();
  await expect(page.getByText("Equations quiz")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("parent@example.com");
  await page.getByLabel("Password").fill("parent password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^overview$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Family summary$/i })).toBeVisible();
  await expect(page.getByText("Linked students")).toBeVisible();
  await expect(page.getByText("Student One").first()).toBeVisible();
  await expect(page.getByText("Outstanding balance")).toBeVisible();
  await expect(page.getByText("300000").first()).toBeVisible();
});
