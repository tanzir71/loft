import { expect, test } from "@playwright/test";

const month = () => new Date().toLocaleDateString("en-GB", { month: "long" });
const monthYear = () => new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

test.describe("money (M7)", () => {
  test("draft this month's invoices, add a missing payer, send with numbers", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/money/log");
    await expect(page.getByText("Not invoiced yet")).toBeVisible();
    await page.getByRole("button", { name: `Draft ${month()} invoices` }).click();
    await expect(page.getByRole("heading", { name: `Draft invoices · ${monthYear()}` })).toBeVisible();
    const attention = page.locator(".inv-row", { hasText: "no payer set" });
    await expect(attention).toContainText("Dipa Saha");
    await attention.getByRole("button", { name: "Add payer" }).click();
    await page.getByRole("combobox", { name: "Payer" }).selectOption({ label: "Dipa Saha (pays for themself)" });
    await page.getByRole("button", { name: "Save payer" }).click();
    await expect(page.getByText("no payer set")).toHaveCount(0);
    // How many payers are due depends on the date (the demo's sessions and package credits follow the calendar).
    const send = page.getByRole("button", { name: /^Send \d+ ready$/ });
    const count = Number((await send.textContent())!.match(/\d+/)![0]);
    expect(count).toBeGreaterThanOrEqual(3);
    await send.click();
    await expect(page.getByRole("status")).toContainText(`Sent ${count} invoices`);
    await expect(page.getByRole("link", { name: /WhatsApp Shirin Karim/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/8801700000001\?text=/);
    await expect(page.locator(".inv-row", { hasText: "LF-0414" })).toBeVisible();
    await expect(page.locator(".inv-row", { hasText: `LF-${String(413 + count).padStart(4, "0")}` })).toBeVisible();
  });

  test("payer taps I've paid on the pay page; the host confirms and a receipt goes out", async ({ page, context, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/money/invoices");
    await page.locator(".inv-row", { hasText: "LF-0413" }).click();
    await expect(page.getByRole("heading", { name: /LF-0413/ })).toBeVisible();
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
    const href = await page.getByRole("link", { name: "Open the payer's view" }).getAttribute("href");
    const payer = await context.newPage();
    await payer.goto(href!);
    await expect(payer.getByText("Left to pay")).toBeVisible();
    await expect(payer.getByRole("link", { name: /Pay \$400\.00/ })).toHaveAttribute("href", "https://pay.example.com/nusrat");
    await payer.getByRole("button", { name: "I've paid" }).click();
    await payer.getByLabel("Receipt or reference (optional)").fill("TRX-42");
    await payer.getByRole("button", { name: "Tell Nusrat" }).click();
    await expect(payer.getByText(/You said you paid \$400\.00/)).toBeVisible();

    await page.goto("./app/#/money/payments");
    await page.locator(".claim-row", { hasText: "Tania Roy" }).click();
    await expect(page.getByLabel("Claim")).toContainText("TRX-42");
    await page.getByRole("button", { name: "Confirm $400.00 · send receipt" }).click();
    await expect(page.getByRole("status")).toContainText("Receipt RC-0413-2 sent to Tania · paid in full");
    await payer.reload();
    await expect(payer.getByText("Paid in full. Thank you!")).toBeVisible();
  });

  test("a log status re-prices: excused is $0 and earns a makeup credit; billing setup saves", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/money/log");
    const credits = page.locator(".kpi", { hasText: "Makeup credits" });
    await expect(credits).toContainText("1");
    const row = page.locator("tbody tr").filter({ has: page.getByLabel(/^Ayaan Karim .* status$/) }).first();
    const pick = row.getByRole("combobox");
    await expect(row).toContainText("$15.00");
    await pick.selectOption("excused");
    await expect(row).toContainText("$0.00");
    await expect(credits).toContainText("2");

    await page.goto("./app/#/s/physics-a/billing");
    await expect(page.getByRole("heading", { name: "Billing for this space" })).toBeVisible();
    await page.getByLabel("Price").fill("18.00");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Price")).toHaveValue("18.00");
  });

  test("reminders: overdue payer, WhatsApp is a link the host taps, pause stops reminders", async ({ page }) => {
    await page.goto("./app/#/money/reminders");
    const card = page.locator(".od-card", { hasText: "Tania Roy" });
    await expect(card).toContainText("6 days overdue");
    await expect(card.getByRole("link", { name: "Send nudge now" })).toHaveAttribute("href", /^https:\/\/wa\.me\/8801700000003\?text=Hi%20Tania/);
    await card.getByRole("button", { name: "Pause" }).click();
    await expect(card).toContainText("reminders paused");
  });
});
