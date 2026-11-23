import { expect, test } from "@playwright/test";

test.describe("owner console, Brand studio, sign-in, install, settings (M10)", () => {
  test("owner console: filter, open an organisation, switch branding on with a paid-until date", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/owner");
    await expect(page.getByRole("heading", { name: "Organisations" })).toBeVisible();
    await page.getByRole("button", { name: /^Ending soon 1$/ }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("Bright Minds Academy");
    await page.getByRole("button", { name: /^All \d+$/ }).click();
    await page.getByRole("button", { name: "Acme Foods" }).click();
    const panel = page.getByRole("complementary", { name: "Acme Foods" });
    await panel.getByRole("checkbox", { name: "Branding", exact: true }).check();
    await panel.getByRole("button", { name: "+1 year" }).click();
    await panel.getByLabel("Note · only you see this").fill("INV-0042 · bank transfer · $290");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByRole("button", { name: "Saved" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Acme Foods" }).getByLabel("Branding for Acme Foods")).toBeChecked();
  });

  test("Brand studio: set up while branding is off; publishing needs branding", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/brand");
    await expect(page.getByText("Branding off · preview")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish · needs branding" })).toBeDisabled();
    await page.getByLabel("Name").fill("Nusrat Tutors");
    await page.getByRole("radio", { name: /Sunrise/ }).check();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status")).toContainText("Saved.");
    // The owner switches it on → publish works and the shell takes the brand.
    await page.goto("./app/#/owner");
    await page.getByRole("button", { name: "Nusrat Tutors" }).click();
    const panel = page.getByRole("complementary", { name: "Nusrat Tutors" });
    await panel.getByRole("checkbox", { name: "Branding", exact: true }).check();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByRole("button", { name: "Saved" })).toBeVisible();
    await page.goto("./app/#/brand");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Published");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sunrise");
  });

  test("sign-in and install explain the preview; settings save your profile", async ({ page }) => {
    await page.goto("./app/#/signin");
    await expect(page.getByRole("heading", { name: "Sign in to loft" })).toBeVisible();
    await expect(page.getByText(/Preview: accounts run on your server/)).toBeVisible();
    await page.goto("./app/#/install");
    await expect(page.getByRole("heading", { name: "Create the owner account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create owner and finish" })).toBeDisabled();
    await page.goto("./app/#/settings");
    await page.getByLabel("Title").fill("Tutor · Physics");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved.");
  });
});
