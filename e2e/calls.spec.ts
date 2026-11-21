import { expect, test, type Page } from "@playwright/test";

// Chromium's fake microphone + auto-accepted permission prompts; two tabs = two people (BroadcastChannel signalling).
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--enable-usermedia-screen-capturing"] }, permissions: ["microphone"] });

test.describe("calls (M11)", () => {
  test.skip(({ browserName, viewport }) => browserName !== "chromium" || (viewport?.width ?? 0) < 768, "WebRTC loop runs on desktop Chromium");

  async function joinAsGuest(page: Page, code: string, name: string) {
    await page.goto(`./app/#/join?code=${code}&as=guest`);
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Join" }).click();
  }

  test("P2P audio connects, stage mode mutes the guest, a raised hand gets a turn, follow-me and open together", async ({ context }) => {
    const host = await context.newPage();
    await host.goto("./app/#/r/new?name=Calls%20check");
    await expect(host).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const code = host.url().split("/r/")[1]!;
    const guest = await context.newPage();
    await joinAsGuest(guest, code, "Rafi Hasan");
    await expect(host.getByLabel("2 in the room")).toBeVisible();

    await host.getByRole("button", { name: "Join audio" }).click();
    await expect(host.getByText("Audio on")).toBeVisible();
    await guest.getByRole("button", { name: "Join audio" }).click();
    await expect(guest.getByText("2 people")).toBeVisible();
    // Each side receives the other's audio track over the mesh.
    await expect.poll(async () => host.locator("audio").evaluateAll((els) => els.filter((e) => (e as HTMLAudioElement).srcObject).length), { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => guest.locator("audio").evaluateAll((els) => els.filter((e) => (e as HTMLAudioElement).srcObject).length), { timeout: 15_000 }).toBe(1);

    // Stage mode: the guest can only listen until the host gives a turn.
    await host.getByRole("button", { name: "Stage mode" }).click();
    await expect(guest.getByText("Listening")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Unmute" })).toBeDisabled();
    await guest.getByRole("button", { name: "Raise hand" }).click();
    await host.getByRole("button", { name: "Let them speak" }).click();
    await expect(guest.getByText(/your turn/)).toBeVisible();
    await guest.getByRole("button", { name: "Unmute" }).click();
    await expect(guest.getByText("Audio on")).toBeVisible();

    // Follow me: the guest gets a "Following" chip when the host presents.
    await host.getByRole("button", { name: "Follow me" }).click();
    const box = (await host.getByRole("application").boundingBox())!;
    await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await host.mouse.wheel(0, 300);
    await expect(guest.getByText("Following Nusrat")).toBeVisible();
    await guest.getByRole("button", { name: "Stop following" }).click();
    await expect(guest.getByText("Nusrat is presenting")).toBeVisible();

    // Open together: the guest gets a prompt (never proxied or embedded); the host sees who has it open.
    host.once("dialog", (d) => void d.accept("https://example.com/pricing"));
    await host.getByRole("button", { name: "More tools" }).click();
    await host.getByRole("menuitem", { name: /Open together/ }).click();
    await expect(guest.getByText("Nusrat wants everyone on this page")).toBeVisible();
    await expect(host.getByText("Everyone was asked to open")).toBeVisible();
    await guest.getByRole("button", { name: "Not now" }).click();

    // Leaving audio closes the connection on both sides.
    await guest.getByRole("button", { name: "Leave audio" }).click();
    await expect(guest.getByRole("button", { name: "Join audio" })).toBeVisible();
    await expect.poll(async () => host.locator("audio").evaluateAll((els) => els.filter((e) => (e as HTMLAudioElement).srcObject).length), { timeout: 10_000 }).toBe(0);
  });

  test("screen share reaches the other tab; annotations sync; snapshot to board; stop clears it", async ({ context }) => {
    // Headless Chromium has no screen to pick, so an animated canvas stands in for the screen picker's
    // result. Everything after the picker is real: the share connections, the viewer's video, strokes, snapshot.
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return; // about:blank and other frames without media devices
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement("canvas");
        c.width = 1280;
        c.height = 720;
        const g = c.getContext("2d")!;
        let n = 0;
        setInterval(() => {
          g.fillStyle = n % 2 ? "#1f3a8a" : "#0f766e";
          g.fillRect(0, 0, c.width, c.height);
          g.fillStyle = "#ffffff";
          g.font = "64px sans-serif";
          g.fillText(`Slide ${++n}`, 80, 160);
        }, 100);
        return c.captureStream(10);
      };
    });
    const host = await context.newPage();
    await host.goto("./app/#/r/new?name=Share%20check");
    await expect(host).toHaveURL(/#\/r\/[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const code = host.url().split("/r/")[1]!;
    const guest = await context.newPage();
    await joinAsGuest(guest, code, "Sumaiya Khan");
    await expect(host.getByLabel("2 in the room")).toBeVisible();
    await host.getByRole("button", { name: "Share screen" }).click();
    await expect(host.getByText("You're sharing")).toBeVisible();
    // The guest gets the live video (frames arriving), and the host sees one viewer.
    await expect(guest.getByText("Nusrat is sharing")).toBeVisible();
    await expect.poll(async () => guest.locator(".screenshare video").evaluate((v) => (v as HTMLVideoElement).videoWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(host.getByText("1 watching")).toBeVisible();
    // Annotate on the host; the stroke is drawn on the guest's screen too.
    const ink = host.locator(".screenshare__ink");
    const b = (await ink.boundingBox())!;
    await host.mouse.move(b.x + 100, b.y + 100);
    await host.mouse.down();
    await host.mouse.move(b.x + 260, b.y + 180, { steps: 8 });
    await host.mouse.up();
    const inked = (page: Page) =>
      page.locator(".screenshare__ink").evaluate((c) => {
        const cv = c as HTMLCanvasElement;
        const d = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
        return n;
      });
    await expect.poll(() => inked(guest), { timeout: 10_000 }).toBeGreaterThan(50);
    // Snapshot: the frame plus strokes become a new board page everyone gets.
    await host.getByRole("button", { name: "Snapshot to board" }).click();
    await expect(guest.getByRole("application").getByText("Screen snapshot")).toBeAttached({ timeout: 10_000 });
    // Stop: the overlay closes for the guest.
    await host.getByRole("button", { name: "Stop sharing" }).click();
    await expect(guest.getByText("Nusrat is sharing")).toHaveCount(0);
  });
});
