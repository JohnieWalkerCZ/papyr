import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./sync-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://localhost:3003", ...devices["Desktop Chrome"] },
  webServer: {
    command: "PAPYR_API_ORIGIN=http://localhost:5081 pnpm dev --port 3003",
    url: "http://localhost:3003",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
