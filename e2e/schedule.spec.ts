import { expect, test } from "@playwright/test";

test.describe("scheduling (M5)", () => {
  test("calendar week view, requests and a new weekly series", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop flow");
    await page.goto("./app/#/calendar");
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    await expect(page.locator(".week__open").first()).toBeVisible();
    await expect(page.locator(".ev").first()).toBeVisible();
    const req = page.locator("#requests li", { hasText: "Rafi Hasan" });
    await expect(req).toContainText("asks to move");
    await req.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("Approved");
    await page.getByRole("button", { name: "New session" }).click();
    await page.getByLabel("Title").fill("Office hours");
    await page.getByText("Repeat weekly").click();
    await page.getByLabel("Ends after").fill("3");
    await expect(page.locator(".clash-box")).toBeVisible();
    await page.getByRole("button", { name: /Create \d sessions/ }).click();
    await expect(page.getByRole("status")).toContainText(/session(s)? added/);
  });

  test("public booking page: instant booking, approval booking and the manage link", async ({ page }) => {
    await page.goto("./app/#/book/nusrat");
    await expect(page.getByRole("heading", { name: "Nusrat Rahman" })).toBeVisible();
    await page.getByRole("radio", { name: /Strategy session/ }).click();
    await page.locator(".slot").first().click();
    await page.getByLabel("Your name").fill("Tom Field");
    await page.getByLabel("Email").fill("tom@example.com");
    await page.getByRole("button", { name: /^Book / }).click();
    await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
    await page.getByRole("button", { name: "Book another time" }).click();
    await page.getByRole("radio", { name: /Discovery call/ }).click();
    await page.locator(".slot").nth(1).click();
    await page.getByLabel("Your name").fill("Rina Saha");
    await page.getByLabel("Email").fill("rina@example.com");
    await page.getByRole("button", { name: /^Book / }).click();
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
    await page.getByRole("link", { name: "Reschedule or cancel" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByText(/cancelled/)).toBeVisible();
  });

  test("availability: add a booking type", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop flow");
    await page.goto("./app/#/calendar/availability");
    await expect(page.getByRole("heading", { name: "Bookable hours" })).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Name").fill("Office hours");
    await page.getByRole("button", { name: "Save type" }).click();
    await expect(page.locator(".types__row", { hasText: "Office hours" })).toBeVisible();
  });

  test("phone shows the agenda", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone only");
    await page.goto("./app/#/calendar");
    await expect(page.locator(".agenda__row").first()).toBeVisible();
  });
});
