import { expect, test } from "@playwright/test";

test.describe("plans (M6)", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "desktop flow");

  test("library, new plan from a template, edit blocks with autosave", async ({ page }) => {
    await page.goto("./app/#/s/physics-a/plans");
    await expect(page.locator(".plan-row", { hasText: "Lesson 6 · Projectiles lab" })).toContainText("Ready");
    await expect(page.locator(".warn-row").first()).toContainText("has no plan yet");
    await page.getByRole("button", { name: "New plan" }).click();
    await page.getByRole("radio", { name: "Template" }).click();
    await page.getByLabel("Template").selectOption("retro");
    await page.getByLabel("Title").fill("Sprint retro");
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByRole("heading", { name: /Sprint retro/ })).toBeVisible();
    await expect(page.locator(".tl-meta")).toContainText("45 of 45 min planned");
    await page.getByRole("button", { name: /Add block/ }).click();
    await expect(page.locator(".tl-meta")).toContainText("50 of 45 min planned");
    await expect(page.locator(".tl-meta")).toContainText("5 min over");
    await page.getByLabel("Title", { exact: true }).fill("Shout-outs");
    await expect(page.getByText(/Saved · just now/)).toBeVisible({ timeout: 5000 });
  });

  test("attach prepares the room; the host rail runs the plan; members never see host notes", async ({ page }) => {
    await page.goto("./app/#/plans/pl_lesson6");
    await expect(page.getByRole("heading", { name: /Lesson 6/ })).toBeVisible();
    await page.getByRole("button", { name: "Open room" }).click();
    await expect(page).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const rail = page.getByRole("complementary", { name: /Plan/ });
    await expect(rail).toContainText("Check-in");
    await rail.getByRole("button", { name: /Start Check-in/ }).click();
    await rail.getByRole("button", { name: "Start next block" }).click();
    await expect(rail.locator(".rail-now")).toContainText("Predict");
    await expect(rail.locator(".rail-notes")).toContainText("Ask Rafi first");
  });

  test("wrap-up writes billable lines and posts a recap", async ({ page }) => {
    await page.goto("./app/#/review");
    await page.locator(".review-row", { hasText: "Wrap-up pending" }).getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: /Wrap up · Lesson 5/ })).toBeVisible();
    await expect(page.getByLabel("Ayaan Karim attendance")).toHaveValue("attended");
    await expect(page.getByLabel("Sumaiya Khan attendance")).toHaveValue("absent");
    await page.getByRole("radiogroup", { name: "Practice outcome" }).getByRole("radio", { name: "Partly" }).click();
    await page.getByText(/Carry 'Practice'/).click();
    await page.getByRole("button", { name: "Post recap & close" }).click();
    await expect(page.getByRole("heading", { name: "Wrapped up" })).toBeVisible();
    await expect(page.getByText(/1 billable line \(\$15\.00\)/)).toBeVisible();
    await page.getByRole("button", { name: /Back to HSC Physics/ }).click();
    await expect(page.getByText("Recap: Lesson 5 · Vectors")).toBeVisible();
  });
});
