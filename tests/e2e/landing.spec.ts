import { expect, test } from "@playwright/test";

test("renders the public TutorLoft landing page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/TutorLoft/);
  await expect(
    page.getByRole("heading", {
      name: /one place for your classes, materials, and billing/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /^log in$/i }),
  ).toBeVisible();
  await expect(
    page.locator("section").first().getByRole("link", { name: /^log in$/i }),
  ).toBeVisible();
  await expect(page.getByText("Billing for Parents")).toBeVisible();
});
