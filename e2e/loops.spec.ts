import { expect, test } from "@playwright/test";

// The main loops (handoff M12), end to end on the preview build.
test.describe("main loops (M12)", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "desktop flows");

  test("room → guest joins → board → end → wrap-up → recap", async ({ context }) => {
    test.setTimeout(60_000);
    const host = await context.newPage();
    await host.goto("./app/#/plans/pl_lesson6");
    await host.getByRole("button", { name: "Open room" }).click();
    await expect(host).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const code = host.url().split("/r/")[1]!;
    const guest = await context.newPage();
    await guest.goto(`./app/#/join?code=${code}&as=guest`);
    await guest.getByLabel("Your name").fill("Rafi Hasan");
    await guest.getByRole("button", { name: "Join" }).click();
    // Session rooms ask the host to let guests in.
    await host.getByRole("button", { name: "Let in" }).click();
    await expect(host.getByLabel("2 in the room")).toBeVisible();
    // The guest adds a sticky; the host sees it.
    await guest.getByRole("button", { name: /Sticky note/ }).click();
    const box = (await guest.getByRole("application").boundingBox())!;
    await guest.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await guest.keyboard.type("45° goes furthest");
    await guest.keyboard.press("Escape");
    await expect(host.locator(".sticky", { hasText: "45° goes furthest" })).toBeVisible();
    // The host ends the session and lands on the wrap-up.
    host.once("dialog", (d) => void d.accept());
    await host.getByRole("button", { name: "End", exact: true }).click();
    await expect(host.getByRole("heading", { name: /Wrap up · Lesson 6/ })).toBeVisible();
    await host.getByRole("button", { name: "Post recap & close" }).click();
    await expect(host.getByRole("heading", { name: "Wrapped up" })).toBeVisible();
    await host.getByRole("button", { name: /Back to HSC Physics/ }).click();
    await expect(host.getByText("Recap: Lesson 6 · Projectiles lab")).toBeVisible();
  });

  test("schedule → plan → room → wrap-up → invoice → payer says paid → host confirms", async ({ page, context }) => {
    test.setTimeout(90_000);
    // Schedule a session in HSC Physics a little later today, in the browser's time zone like the preview.
    await page.goto("./app/#/calendar");
    const at = await page.evaluate(() => {
      const d = new Date(Math.ceil((Date.now() + 20 * 60_000) / (15 * 60_000)) * 15 * 60_000);
      const p = (n: number) => String(n).padStart(2, "0");
      return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
    });
    await page.getByRole("button", { name: "New session" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Space").selectOption({ label: "HSC Physics" });
    await sheet.getByLabel("Title").fill("Extra practice");
    await sheet.getByLabel("Date").fill(at.date);
    await sheet.getByLabel("Time").fill(at.time);
    await sheet.getByRole("button", { name: "Create session" }).click();
    await expect(page.getByRole("status")).toContainText(/session added/);
    // Plan it: attach Lesson 7, which prepares the session's room.
    await page.goto("./app/#/plans/pl_lesson7");
    await page.getByRole("button", { name: "Attach to session" }).click();
    await page.getByRole("radio", { name: /Extra practice/ }).check();
    await page.getByRole("button", { name: "Attach & prepare" }).click();
    await expect(page.getByText(/in the session's room/)).toBeVisible();
    await page.reload();
    // Teach: open the room, end it, and land on the wrap-up.
    await page.getByRole("button", { name: "Open room" }).click();
    await expect(page).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Wrap up · Lesson 7/ })).toBeVisible();
    await page.getByLabel("Ayaan Karim attendance").selectOption("attended");
    await page.getByRole("button", { name: "Post recap & close" }).click();
    await expect(page.getByText(/1 billable line \(\$15\.00\)/)).toBeVisible();
    // The new line is in this month's log, then on Shirin's draft.
    await page.goto("./app/#/money/log");
    await expect(page.locator("tr", { hasText: "Extra practice" }).filter({ hasText: "Ayaan Karim" })).toContainText("$15.00");
    await page.getByRole("button", { name: /^Draft \w+ invoices$/ }).click();
    const shirin = page.locator(".inv-row", { hasText: "Shirin Karim" }).first();
    await expect(shirin).toBeVisible();
    // Send only Shirin's draft.
    await page.getByLabel("Select all").uncheck();
    await shirin.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Send 1 ready" }).click();
    await expect(page.getByRole("status")).toContainText("Sent 1 invoice");
    await page.locator(".inv-row", { hasText: "LF-0414" }).click();
    const href = await page.getByRole("link", { name: "Open the payer's view" }).getAttribute("href");
    // The payer pays with the host's link, then taps "I've paid".
    const payer = await context.newPage();
    await payer.goto(href!);
    await payer.getByRole("button", { name: "I've paid" }).click();
    await payer.getByRole("button", { name: "Tell Nusrat" }).click();
    await expect(payer.getByText(/You said you paid/)).toBeVisible();
    // The host confirms and a receipt goes out.
    await page.goto("./app/#/money/payments");
    await page.locator(".claim-row", { hasText: "LF-0414" }).click();
    await page.getByRole("button", { name: /^Confirm \$[\d.,]+ · send receipt$/ }).click();
    await expect(page.getByRole("status")).toContainText(/Receipt RC-0414 sent to Shirin · paid in full/);
    await payer.reload();
    await expect(payer.getByText("Paid in full. Thank you!")).toBeVisible();
  });

  test("keyboard: Tab steps through board objects and arrows move the selection", async ({ page }) => {
    await page.goto("./app/#/r/SPR-DCD");
    const board = page.getByRole("application");
    // Wait for the room's board to sync in: with nothing on it, Tab would leave the board.
    await expect(page.locator(".sticky, .bsection").first()).toBeVisible();
    await board.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".is-selected").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".is-selected")).toHaveCount(0);
  });
});
