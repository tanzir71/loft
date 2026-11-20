import { expect, test } from "@playwright/test";

test.describe("Pages smoke", () => {
  test("landing loads with the preview banner and links to the app", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("note")).toContainText("Preview build: data stays in this browser.");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Open Loft" }).click();
    await expect(page).toHaveURL(/\/app\//);
  });

  test("app shell shows the first-run Home", async ({ page }, info) => {
    await page.goto("./app/");
    await expect(page.getByRole("note")).toContainText("Preview build");
    await expect(page.getByRole("heading", { name: /Welcome, Nusrat/ })).toBeVisible();
    await expect(page.getByText("Your room link")).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "New space" })).toBeVisible();
    if (info.project.name === "phone") {
      await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
      await page.getByRole("link", { name: "More" }).click();
      await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
    } else {
      const side = page.getByRole("navigation", { name: "Main" });
      await expect(side.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
      await side.getByRole("link", { name: "Money" }).click();
      await expect(page.getByRole("heading", { name: /Money arrives in M7/ })).toBeVisible();
    }
  });

  test("no italics anywhere in the app shell", async ({ page }) => {
    await page.goto("./app/");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    const italic = await page.evaluate(() =>
      [...document.querySelectorAll("body *")].filter((el) => getComputedStyle(el).fontStyle === "italic").length
    );
    expect(italic).toBe(0);
  });

  test("milestones index lists releases", async ({ page }) => {
    await page.goto("./milestones/");
    await expect(page.getByRole("heading", { name: "Loft milestones" })).toBeVisible();
    await expect(page.getByText(/M0 · Consolidate/)).toBeVisible();
  });
});
