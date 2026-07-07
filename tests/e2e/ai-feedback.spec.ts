import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor drafts AI feedback for an assignment submission", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Provider").selectOption("openrouter");
  await page.getByLabel("API key").fill("sk-test-1234567890");
  await page.getByRole("button", { name: /^save AI settings$/i }).click();
  await expect(page).toHaveURL(/ai=saved/);
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
  await page.getByLabel("Rubric").fill("Show each algebra step.");
  await page.locator('input[name="points"]').first().fill("10");
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
  await page.getByPlaceholder("Submission text").fill("x + 3 = 8, so x = 5");
  await page.getByRole("button", { name: /^submit assignment$/i }).click();
  await expect(page.getByText("Submitted")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await page.goto("/grading");
  await expect(page.getByText("x + 3 = 8, so x = 5")).toBeVisible();
  await page.getByRole("button", { name: /^draft AI feedback$/i }).click();
  await expect(page).toHaveURL(/feedbackDrafted=/);
  await expect(page.getByText("AI feedback draft added.")).toBeVisible();
  await expect(page.getByText("Draft feedback")).toBeVisible();
  await expect(page.getByLabel("Feedback")).toHaveValue(
    "Strong equation setup. Add one sentence explaining inverse operations.",
  );
});
