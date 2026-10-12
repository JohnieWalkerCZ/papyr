import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./dev-e2e",
  use: { baseURL: "http://localhost:3002", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm dev --port 3002",
    url: "http://localhost:3002",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
