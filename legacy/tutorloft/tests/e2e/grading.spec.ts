import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor returns assignment feedback and continues a private submission thread", async ({
  page,
}) => {
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
  await page.getByPlaceholder("Submission text").fill("My solution");
  await page.getByRole("button", { name: /^submit assignment$/i }).click();
  await expect(page.getByText("Submitted")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await page.goto("/grading");
  await expect(page.getByText("My solution")).toBeVisible();
  await page.getByRole("textbox", { exact: true, name: "Comment" }).fill(
    "Strong setup; add one more justification.",
  );
  await page.getByRole("button", { name: /^save bank comment$/i }).click();
  await expect(page.locator('select[name="bankText"]')).toContainText(
    "Strong setup; add one more justification.",
  );
  await page.getByLabel("Grade").fill("8");
  await page
    .locator('select[name="bankText"]')
    .selectOption({ label: "Strong setup; add one more justification." });
  await page.getByLabel("Feedback").fill("Returned with next steps.");
  await page.getByRole("button", { name: /^return with feedback$/i }).click();
  await expect(
    page.locator("p").filter({ hasText: "Returned with next steps." }).first(),
  ).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  await page.goto("/assignments");
  await expect(page.getByText("Returned", { exact: true })).toBeVisible();
  await expect(page.getByText("Score 8")).toBeVisible();
  await expect(page.getByText("Strong setup; add one more justification.")).toBeVisible();
  await page.getByPlaceholder("Private comment").fill("Can you check my second line?");
  await page.getByRole("button", { name: /^add private comment$/i }).click();
  await expect(page.getByText("Can you check my second line?")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await page.goto("/grading");
  await expect(page.getByText("Can you check my second line?")).toBeVisible();
  await page.getByPlaceholder("Private comment").fill("Use the distributive property there.");
  await page.getByRole("button", { name: /^add private comment$/i }).click();
  await expect(page.getByText("Use the distributive property there.")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  await page.goto("/assignments");
  await expect(page.getByText("Use the distributive property there.")).toBeVisible();
});
