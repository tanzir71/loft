import { expect, test, type Page } from "@playwright/test";

// Two tabs in one browser context share IndexedDB + BroadcastChannel, so they behave like two people.
test.describe("rooms (M2)", () => {

  async function joinAsGuest(page: Page, code: string, name: string) {
    await page.goto(`./app/#/join?code=${code}&as=guest`);
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Join" }).click();
  }

  test("host starts a room, guests join by code, board + chat sync, host ends", async ({ context }, info) => {
    test.skip(info.project.name !== "desktop", "room loop runs on desktop");
    const host = await context.newPage();
    await host.goto("./app/#/r/new?name=Acme%20kickoff");
    await expect(host).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const code = host.url().split("/r/")[1]!;
    await expect(host.getByText("Acme kickoff").first()).toBeVisible();

    // Draw a stroke and add a sticky note.
    const board = host.getByRole("application");
    const box = (await board.boundingBox())!;
    await host.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2);
    await host.mouse.down();
    for (let i = 1; i <= 10; i++) await host.mouse.move(box.x + box.width / 2 - 100 + i * 15, box.y + box.height / 2 + i * 4);
    await host.mouse.up();
    await host.getByRole("button", { name: /Sticky note/ }).click();
    await host.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2 - 100);
    await host.keyboard.type("Repeat orders +15%");
    await host.keyboard.press("Escape");
    await expect(host.locator(".sticky")).toContainText("Repeat orders +15%");

    // Guest joins (guest join is on by default) and sees the note.
    const guest = await context.newPage();
    await joinAsGuest(guest, code, "Rahim Uddin");
    await expect(guest.locator(".sticky")).toContainText("Repeat orders +15%");
    await expect(host.getByLabel("2 in the room")).toBeVisible();

    // Chat from guest shows on the host's pill.
    await guest.getByRole("button", { name: /Open chat/ }).click();
    await guest.getByLabel("Message").fill("sir page 2 also?");
    await guest.getByRole("button", { name: "Send" }).click();
    await expect(host.locator(".chat-pill")).toContainText("sir page 2 also?");

    // Guest join off: the next guest waits until the host lets them in.
    await host.getByRole("button", { name: "Invite to this room" }).click();
    await host.getByText("Guests join without approval").click();
    await expect(host.getByRole("switch")).not.toBeChecked();
    const late = await context.newPage();
    await joinAsGuest(late, code, "Sumaiya Khan");
    await expect(late.getByText("Waiting for Nusrat to let you in")).toBeVisible();
    await expect(host.getByText("Sumaiya Khan (guest) wants to join")).toBeVisible();
    await host.getByRole("button", { name: "Let in" }).click();
    await expect(late.locator(".sticky")).toContainText("Repeat orders +15%");

    // Host ends the session for everyone.
    host.once("dialog", (d) => d.accept());
    await host.getByRole("button", { name: "End" }).click();
    await expect(guest.getByRole("heading", { name: "Session ended" })).toBeVisible();
    await expect(late.getByRole("heading", { name: "Session ended" })).toBeVisible();
  });
});

test.describe("room capacity (M2)", () => {
  test("12 people fit; the 13th waits in line and gets in when someone leaves", async ({ context }, info) => {
    test.skip(info.project.name !== "desktop", "runs once");
    test.setTimeout(120_000);
    const host = await context.newPage();
    await host.goto("./app/#/r/new?name=Full%20house");
    await expect(host).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const code = host.url().split("/r/")[1]!;
    const guests = [];
    for (let i = 1; i <= 11; i++) {
      const g = await context.newPage();
      await g.goto(`./app/#/join?code=${code}&as=guest`);
      await g.getByLabel("Your name").fill(`Guest ${i}`);
      await g.getByRole("button", { name: "Join" }).click();
      await expect(g.getByRole("toolbar", { name: "Board tools" })).toBeVisible();
      guests.push(g);
    }
    await expect(host.getByLabel("12 in the room")).toBeVisible({ timeout: 15_000 });
    const late = await context.newPage();
    await late.goto(`./app/#/join?code=${code}&as=guest`);
    await late.getByLabel("Your name").fill("Number Thirteen");
    await late.getByRole("button", { name: "Join" }).click();
    await expect(late.getByRole("heading", { name: "This room is full" })).toBeVisible();
    await expect(late.getByText("You're #1 in line")).toBeVisible();
    await guests[0]!.close();
    await expect(late.getByRole("toolbar", { name: "Board tools" })).toBeVisible({ timeout: 15_000 });
  });
});
