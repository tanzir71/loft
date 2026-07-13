import { expect, test } from "@playwright/test";

test("read-only demo switches between tutor, student, and parent views", async ({
  page,
}) => {
  await page.goto("/demo");

  await expect(page.getByText(/read-only demo/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /good morning, samira/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /create \(disabled\)/i }),
  ).toBeDisabled();

  await page.getByRole("button", { name: /student learning/i }).click();
  await expect(
    page.getByRole("heading", { name: /your next lesson is ready/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: /parent read-only/i }).click();
  await expect(
    page.getByRole("heading", { name: /clear view between reports/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Billing" }).click();
  await expect(page.getByText(/not payment processing/i)).toBeVisible();
});
