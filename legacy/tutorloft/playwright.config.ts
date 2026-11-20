import { defineConfig, devices } from "@playwright/test";

const e2eEnv = {
  AUTH_SECRET: "playwright-secret-change-me",
  DATABASE_URL: "file:./data/e2e.db",
  PLAYWRIGHT: "1",
  TUTOR_EMAIL: "tutor@example.com",
  TUTOR_PASSWORD: "correct horse battery staple",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    env: e2eEnv,
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
