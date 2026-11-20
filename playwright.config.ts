import { defineConfig, devices } from "@playwright/test";

// Smoke tests run against the built Pages output (`npm run build:pages -- --milestone N`),
// served under /loft/ like GitHub Pages. Set PAGES_URL to test the live site instead.
const live = process.env.PAGES_URL;
const baseURL = (live ?? "http://localhost:4173/loft/").replace(/\/?$/, "/");

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } }
  ],
  webServer: live
    ? undefined
    : { command: "node scripts/serve-site.mjs --port 4173", url: "http://localhost:4173/loft/", reuseExistingServer: !process.env.CI, timeout: 20_000 }
});
