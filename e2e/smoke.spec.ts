import { expect, test } from "@playwright/test";

test.describe("Pages smoke", () => {
  test("landing loads with the preview banner, hero and quick start", async ({ page }, info) => {
    await page.goto("./");
    await expect(page.getByRole("note")).toContainText("Preview build: data stays in this browser.");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Plan the session");
    await expect(page.getByRole("heading", { name: /Let Claude or Codex do the prep/ })).toBeVisible();
    await expect(page.locator(".feat")).toHaveCount(12); // 11 features + organisations band
    await expect(page.locator(".qcard")).toHaveCount(8);
    if (info.project.name === "desktop") {
      // side-by-side FAQ cards share one height
      const heights = await page.locator(".qcard").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      expect(new Set(heights).size).toBe(1);
    }
    await page.getByLabel("Room code or link").fill("k7p-42q");
    await page.getByRole("button", { name: "join" }).click();
    await expect(page).toHaveURL(/\/app\/#\/join\?code=K7P-42Q/);
    await expect(page.getByRole("heading", { name: "Join with a code" })).toBeVisible();
  });

  test("organisations page offers email-first buying, no checkout", async ({ page }) => {
    await page.goto("./organisations/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your name on every screen");
    await expect(page.getByRole("link", { name: /email us to brand loft/ })).toHaveAttribute("href", /^mailto:hello@tanziro\.com/);
    await expect(page.getByText(/custom domains aren't offered/)).toBeVisible();
    await expect(page.locator("form#contact")).toBeVisible();
  });

  test("app shell shows the demo Home, and the first-run state on an empty workspace", async ({ page }, info) => {
    await page.goto("./app/");
    await expect(page.getByRole("note")).toContainText("Preview build");
    await expect(page.getByRole("heading", { name: /(Good (morning|afternoon|evening), Nusrat)|Home/ }).first()).toBeVisible();
    await expect(page.getByText("Acme pricing").first()).toBeVisible();
    if (info.project.name === "phone") {
      await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
      await page.getByRole("link", { name: "More" }).click();
      await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "Start with an empty workspace" }).click();
      await expect(page.getByRole("heading", { name: /Welcome, Nusrat/ })).toBeVisible();
      await expect(page.getByText("Your room link")).toBeVisible();
    } else {
      const side = page.getByRole("navigation", { name: "Main" });
      await expect(side.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
      await expect(side.getByRole("link", { name: /acme-pricing/ })).toBeVisible();
      await side.getByRole("link", { name: "Money" }).click();
      await expect(page.getByRole("heading", { name: /Money arrives in M7/ })).toBeVisible();
    }
  });

  test("no italics and no horizontal scroll", async ({ page }) => {
    for (const path of ["./", "./organisations/", "./app/"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const r = await page.evaluate(() => ({
        italic: [...document.querySelectorAll("body *")].filter((el) => getComputedStyle(el).fontStyle === "italic").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }));
      expect(r.italic, path).toBe(0);
      expect(r.overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("milestones index lists releases", async ({ page }) => {
    await page.goto("./milestones/");
    await expect(page.getByRole("heading", { name: "Loft milestones" })).toBeVisible();
    await expect(page.getByText(/M0 · Consolidate/)).toBeVisible();
  });
});
