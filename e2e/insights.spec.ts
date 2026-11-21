import { expect, test } from "@playwright/test";

test.describe("insights, checks, states (M8)", () => {
  test("insights: at-risk filter, nudge a member in-app", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/insights");
    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
    await expect(page.locator(".kpi", { hasText: "Active members" })).toBeVisible();
    await page.getByRole("button", { name: /^At risk · \d+$/ }).click();
    const dipa = page.locator("tr", { hasText: "Dipa Saha" });
    await expect(dipa).toContainText("9 days ago");
    await dipa.getByRole("button", { name: "Nudge" }).click();
    await expect(page.getByText(/At risk: not seen for 9 days/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=Hi%20Dipa/);
    await page.getByRole("button", { name: "Send in-app" }).click();
    await expect(page.getByRole("status")).toContainText("Sent in-app");
  });

  test("checks: results with integrity signals, mark a short answer", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/s/physics-a/grades");
    await expect(page.getByRole("heading", { name: "Gradebook" })).toBeVisible();
    await page.locator(".inv-row", { hasText: "Projectiles · exit ticket" }).click();
    await expect(page.getByText("Closed", { exact: true })).toBeVisible();
    const sumaiya = page.locator("tr", { hasText: "Sumaiya Khan" });
    await expect(sumaiya).toContainText("Review");
    await expect(sumaiya).toContainText("left the tab ×2");
    await expect(page.locator("tr", { hasText: "Dipa Saha" })).toContainText("Not started");
    await page.getByLabel("Points for Sumaiya Khan").fill("1");
    await page.getByRole("button", { name: "Save mark" }).click();
    await expect(sumaiya).toContainText("6/6 · 100%");
    await expect(page.getByText(/To mark ·/)).toHaveCount(0);
  });

  test("a member takes a timed check; pasting shows up as an integrity signal for the host", async ({ page, context, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/checks/ck_energy");
    await expect(page.getByRole("heading", { name: /Energy warm-up/ })).toBeVisible();
    const href = await page.getByRole("link", { name: /Take it as/ }).getAttribute("href");
    const member = await context.newPage();
    await member.goto(href!);
    await expect(member.getByText(/doesn't use your camera, microphone or screen/)).toBeVisible();
    await member.getByRole("button", { name: "Start" }).click();
    await expect(member.getByRole("timer")).toBeVisible();
    await member.getByRole("radio", { name: "20 J" }).check();
    await member.getByRole("radio", { name: "False" }).check();
    const short = member.getByLabel("Answer to question 3");
    await short.fill("joules");
    await short.dispatchEvent("paste");
    await member.getByRole("button", { name: "Submit" }).first().click();
    await member.getByRole("dialog", { name: "Submit check" }).getByRole("button", { name: "Submit" }).click();
    await expect(member.getByRole("status")).toContainText("100%");
    await page.reload();
    const row = page.locator("tbody tr").filter({ hasText: "3/3" });
    await expect(row).toContainText("Flagged");
    await expect(row).toContainText("pasted text");
  });

  test("hosts build a check: publishing is blocked until every question is complete", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "desktop flow");
    await page.goto("./app/#/s/physics-a/grades");
    await page.getByRole("button", { name: "New check" }).click();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("alert")).toContainText("Question 1: Write the question");
    await page.getByLabel("Question 1", { exact: true }).fill("A vector has size and direction.");
    await page.getByLabel("Question 1 type").selectOption("true_false");
    await page.getByRole("radio", { name: "True" }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Open", { exact: true })).toBeVisible();
  });

  test("offline banner appears and clears with the connection", async ({ page, context }) => {
    await page.goto("./app/#/");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText("You're offline. Changes are saved here and sync when you're back.")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/You're offline/)).toHaveCount(0);
  });
});
