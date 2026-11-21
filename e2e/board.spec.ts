import { expect, test, type Page } from "@playwright/test";

// 1×1 PNG for the upload test.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function newRoom(page: Page) {
  await page.goto("./app/#/r/new?name=Board%20v2");
  await expect(page).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeVisible();
  return (await page.getByRole("application").boundingBox())!;
}

test.describe("board v2 (M4)", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "desktop flow");

  test("shapes, quick-create, connectors and sections", async ({ page }) => {
    const box = await newRoom(page);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.keyboard.press("r");
    await page.mouse.click(cx - 200, cy - 150);
    await page.keyboard.type("Lead comes in");
    await page.keyboard.press("Escape");
    await expect(page.locator(".bshape-label", { hasText: "Lead comes in" })).toBeVisible();
    await page.getByRole("button", { name: "Add a connected shape below" }).click();
    await page.keyboard.type("Qualified?");
    await page.keyboard.press("Escape");
    await expect(page.locator(".bshape")).toHaveCount(2);
    await expect(page.locator(".bconn")).toHaveCount(1);

    // Draw a connector from a new shape to the first one.
    await page.keyboard.press("r");
    await page.mouse.click(cx + 150, cy - 150);
    await page.keyboard.type("Book a call");
    await page.keyboard.press("Escape");
    await page.keyboard.press("x");
    const from = (await page.locator(".bshape-label", { hasText: "Book a call" }).boundingBox())!;
    const to = (await page.locator(".bshape-label", { hasText: "Lead comes in" }).boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".bconn")).toHaveCount(2);
    await expect(page.getByRole("toolbar", { name: "Connector" })).toBeVisible();
    await page.getByRole("button", { name: "curved line" }).click();

    // Section.
    await page.keyboard.press("f");
    await page.mouse.move(box.x + 60, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 420, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator(".bsection")).toHaveCount(1);
  });

  test("diagram as code renders live and detaches to freeform", async ({ page }) => {
    await newRoom(page);
    await page.getByRole("button", { name: "More tools" }).click();
    await page.getByRole("menuitem", { name: "Diagram as code" }).click();
    await expect(page.getByRole("complementary", { name: "Diagram as code" })).toContainText("flowchart · 6 boxes · 6 links");
    await page.getByRole("button", { name: "Add to board" }).click();
    await expect(page.locator(".bdiagram")).toHaveCount(1);
    await expect(page.locator(".bshape-label", { hasText: "Qualified?" })).toBeVisible();
    // Adding a diagram selects it, so its bar (with Detach) is already open.
    await page.getByRole("button", { name: "Detach to freeform" }).click();
    await expect(page.locator(".bdiagram")).toHaveCount(0);
    await expect(page.locator(".bshape")).toHaveCount(6);
    await expect(page.locator(".bconn-label", { hasText: "30 days" })).toBeVisible();
    // Find on board.
    await page.keyboard.press("Control+f");
    await page.getByLabel("Find on board").fill("won");
    await expect(page.locator(".find-bar__count")).toHaveText(/\/1$/);
  });

  test("rough box becomes a clean shape; undo brings the stroke back", async ({ page }) => {
    const box = await newRoom(page);
    await page.keyboard.press("p");
    const x = box.x + 400, y = box.y + 250;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const path: [number, number][] = [];
    for (let i = 0; i <= 20; i++) path.push([x + i * 10, y + (i % 2)]);
    for (let i = 0; i <= 12; i++) path.push([x + 200 + (i % 2), y + i * 10]);
    for (let i = 0; i <= 20; i++) path.push([x + 200 - i * 10, y + 120 + (i % 2)]);
    for (let i = 0; i <= 12; i++) path.push([x + (i % 2), y + 120 - i * 10]);
    for (const [px, py] of path) await page.mouse.move(px, py);
    await page.mouse.up();
    await expect(page.locator(".bshape")).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect(page.locator(".bshape")).toHaveCount(0);
    await expect(page.locator(".board__svg--ink path[data-obj]")).toHaveCount(1);
  });

  test("export a page as PNG and upload an image as a page", async ({ page }) => {
    await newRoom(page);
    await page.getByRole("button", { name: "More tools" }).click();
    const dl = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export this page (PNG)" }).click();
    expect((await dl).suggestedFilename()).toMatch(/\.png$/);
    await page.locator('input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator(".board__page")).toHaveCount(2);
    await expect(page.locator(".board__page img")).toHaveCount(1);
  });
});
