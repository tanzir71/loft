import { expect, test } from "@playwright/test";

test.describe("spaces, stream, hallway, inbox (M3)", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "desktop flow");

  test("create a space with the wizard and post to its stream", async ({ page }) => {
    await page.goto("./app/#/spaces/new");
    await expect(page.getByRole("dialog", { name: "New space" })).toBeVisible();
    await page.getByRole("radio", { name: /Team/ }).click();
    await page.getByRole("button", { name: "Next: details" }).click();
    await page.getByLabel("Name").fill("Retro club");
    await page.getByRole("button", { name: "Create space" }).click();
    await expect(page).toHaveURL(/#\/s\/retro-club$/);
    await expect(page.getByRole("heading", { name: "Retro club" })).toBeVisible();
    await page.getByRole("button", { name: "Post an update to the team" }).click();
    await page.getByRole("textbox", { name: "Message" }).fill("First retro on Friday.");
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText("First retro on Friday.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /retro-club/ })).toBeVisible();
  });

  test("must-read notice shows who hasn't seen it and sends reminders", async ({ page }) => {
    await page.goto("./app/#/s/acme-pricing");
    await expect(page.getByText("Steering review moved to Monday 24 Nov, 10:00")).toBeVisible();
    await expect(page.getByText("2 haven't seen this yet")).toBeVisible();
    await page.getByRole("button", { name: "Remind them" }).click();
    await expect(page.getByRole("status")).toContainText("Reminded 2 people.");
    await page.getByRole("link", { name: "Actions" }).click();
    await expect(page.getByText("Price test plan")).toBeVisible();
    await page.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
  });

  test("DM, then start a room together from the hallway", async ({ page }) => {
    await page.goto("./app/#/dm/u_leena");
    await expect(page.getByText("Perfect, cut part 3 in half.")).toBeVisible();
    await page.getByLabel("Message Leena").fill("Joining now");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Joining now")).toBeVisible();
    await page.getByRole("button", { name: "Start a room together" }).first().click();
    await expect(page).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeVisible();
  });

  test("To review lists hand-ins; the bell marks notifications read", async ({ page }) => {
    await page.goto("./app/#/review");
    await expect(page.getByText(/hand-in(s)? to review/).first()).toBeVisible();
    await page.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  });
});
