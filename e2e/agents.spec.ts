import { expect, test } from "@playwright/test";

test.describe("agents (M9)", () => {
  test("seats, a question that needs you, and the next.md an agent reads", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/agents");
    await expect(page.getByRole("heading", { name: "Hand the prep to an agent" })).toBeVisible();
    await expect(page.getByText("Get things ready through this link, top to bottom.")).toBeVisible();
    const laptop = page.locator(".ag-seat", { hasText: "codex (laptop)" });
    await laptop.getByRole("button", { name: "Approve" }).click();
    await expect(laptop).toContainText("revoke");
    await page.getByRole("button", { name: "3 dots each" }).click();
    await expect(page.getByText(/Needs you ·/)).toHaveCount(0);
    await page.getByRole("link", { name: "What agents read", exact: true }).click();
    const md = page.getByLabel("next.md");
    await expect(md).toContainText("# Loft · Design sprint · agent link");
    await expect(md).toContainText("## What you can do");
    await expect(md).toContainText("drafts only · never send, invite, charge or confirm payments · 60 requests/min");
  });

  test("queue a prep task, run the demo agent, review and accept its drafts", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    test.setTimeout(60_000);
    // The demo seeds today's sessions at fixed times (Sprint · Decide at 18:30); start the clock at 10:00
    // so that session is still ahead whenever the test runs. Time then runs normally.
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    await page.clock.setSystemTime(morning);
    await page.goto("./app/#/s/acme-sprint/prep");
    await page.getByRole("button", { name: "New prep task" }).click();
    await page.getByRole("radio", { name: "Agenda for a session" }).click();
    await page.getByLabel("Brief").fill("Ninety minutes, end with owners.");
    await page.getByRole("button", { name: "Queue task" }).click();
    await expect(page.locator(".inv-row", { hasText: "Agenda for Sprint · Decide" }).filter({ hasText: "Queued" })).toBeVisible();
    await page.goto("./app/#/agents");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("finished Agenda for Sprint · Decide", { timeout: 20_000 });
    await page.goto("./app/#/s/acme-sprint/prep");
    const ready = page.locator(".inv-row", { hasText: "Agenda for Sprint · Decide" }).filter({ hasText: "Ready" });
    await ready.getByRole("link", { name: "Review" }).click();
    await expect(page.getByText(/by claude \(demo\)/)).toBeVisible();
    await page.getByRole("button", { name: /^Accept all \d+$/ }).click();
    await expect(page.getByRole("status")).toContainText("All done.");
  });

  test("the room shows agent drafts on a dashed layer only to the host, with a way to review them", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/r/SPR-DCD");
    await expect(page.getByText("dashed = draft, only you can see it until you accept")).toBeVisible();
    await expect(page.getByText("draft by codex").first()).toBeVisible();
    await page.getByRole("link", { name: "Review 3 drafts" }).click();
    await expect(page.getByRole("heading", { name: /Board from the brief/ })).toBeVisible();
    await page.getByRole("button", { name: "Accept all 3" }).click();
    await expect(page.getByRole("status")).toContainText("Accepted 3.");
    await page.goto("./app/#/r/SPR-DCD");
    await expect(page.getByText("Sees price on shelf")).toBeVisible();
    await expect(page.getByText("draft by codex")).toHaveCount(0);
  });
});
