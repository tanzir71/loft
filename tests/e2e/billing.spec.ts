import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor creates, edits, and archives a rate plan", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/billing");
  await page.getByLabel("Rate plan name").fill("Per session");
  await page.getByLabel("Plan type").selectOption("per_session");
  await page.getByLabel("Amount minor units").fill("150000");
  await page.getByRole("button", { name: /^add rate plan$/i }).click();

  await expect(page.getByLabel("Name for Per session")).toHaveValue("Per session");
  await page.getByLabel("Name for Per session").fill("Updated per session");
  await page.getByLabel("Amount for Per session").fill("175000");
  await page.getByRole("button", { name: /^save Per session$/i }).click();
  await expect(page.getByLabel("Name for Updated per session")).toHaveValue(
    "Updated per session",
  );

  await page.getByRole("button", { name: /^archive Updated per session$/i }).click();
  await expect(page.locator("span", { hasText: "Inactive" })).toBeVisible();
});

test("tutor sells a package and attendance consumes remaining credits", async ({ page }) => {
  test.setTimeout(70_000);

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
  await page.getByLabel("Invoice due date").fill("2026-07-10");
  await page.getByRole("button", { name: /^sell package$/i }).click();
  await expect(page).toHaveURL(/packageSold=1/);
  let packageCard = page.getByRole("article", {
    name: /Student One Starter package package/,
  });
  await expect(packageCard.getByText("2 credits remaining")).toBeVisible();
  let invoiceCard = page.getByRole("article", { name: "Invoice TL-202607-0001" });
  await expect(invoiceCard.getByText("Draft")).toBeVisible();
  await page.getByRole("button", { name: /^send TL-202607-0001$/i }).click();
  await expect(page).toHaveURL(/invoiceSent=1/);
  invoiceCard = page.getByRole("article", { name: "Invoice TL-202607-0001" });
  await expect(invoiceCard.getByText(/^Sent$/)).toBeVisible();
  await page.getByLabel("Payment amount for TL-202607-0001").fill("300000");
  await page.getByLabel("Payment method for TL-202607-0001").selectOption("bkash");
  await page.getByLabel("Payment reference for TL-202607-0001").fill("trx-123");
  await page.getByLabel("Payment date for TL-202607-0001").fill("2026-07-02");
  await page.getByRole("button", { name: /^record payment for TL-202607-0001$/i }).click();
  await expect(page).toHaveURL(/paymentRecorded=1/);
  invoiceCard = page.getByRole("article", { name: "Invoice TL-202607-0001" });
  await expect(invoiceCard.getByText(/^Paid$/)).toBeVisible();
  await expect(invoiceCard.getByText("Balance 0")).toBeVisible();
  await page.getByRole("button", { name: /^email TL-202607-0001$/i }).click();
  await expect(page).toHaveURL(/invoiceDelivery=copy/);
  await expect(page.getByText("Email is off. Copy this invoice link.")).toBeVisible();
  await expect(page.locator("code", { hasText: "/invoices/" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await expect(page.getByText("Outstanding total")).toBeVisible();
  await expect(page.getByText("Overdue invoices")).toBeVisible();
  await expect(page.getByText("Collected this month")).toBeVisible();
  await expect(page.getByText("300000")).toBeVisible();

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
  await page.getByLabel("Attendance for Student One").selectOption("present");
  await page.getByRole("button", { name: /^save attendance record for Student One$/i }).click();
  await expect(page).toHaveURL(/attendanceUpdated=1/);

  await page.goto("/billing");
  await page.getByLabel("Credit student").selectOption({
    label: "Student One (student@example.com)",
  });
  await page.getByRole("button", { name: /^apply package credits$/i }).click();
  await expect(page).toHaveURL(/creditsApplied=1/);
  packageCard = page.getByRole("article", {
    name: /Student One Starter package package/,
  });
  await expect(packageCard.getByText("1 credit remaining")).toBeVisible();
  await expect(packageCard.getByText("Low credit")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("student password");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^home$/i })).toBeVisible();
  const studentCredit = page.getByRole("article").filter({ hasText: "Starter package" });
  await expect(studentCredit.getByText("1 credit remaining")).toBeVisible();
  await expect(studentCredit.getByText("Low credit")).toBeVisible();

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: /^billing$/i })).toBeVisible();
  await expect(page.getByText("Outstanding balance")).toBeVisible();
  await expect(page.getByText("TL-202607-0001")).toBeVisible();
  await expect(page.getByText(/^Paid$/)).toBeVisible();
  await expect(page.getByText("Balance 0")).toBeVisible();
  await page.getByRole("link", { name: /^view invoice$/i }).click();
  await expect(page).toHaveURL(/\/invoices\//);
  await expect(page.getByRole("heading", { name: "TL-202607-0001" })).toBeVisible();
  await expect(page.getByText("Starter package (2 sessions)")).toBeVisible();
  await expect(page.getByText(/trx-123/)).toBeVisible();
});
