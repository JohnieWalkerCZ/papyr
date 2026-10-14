import { expect, test } from "@playwright/test";

test("sync HTTP failures log request metadata and API codes without private messages", async ({ page }) => {
  const logs: string[] = [];
  const pendingLogs: Promise<void>[] = [];
  const capture = (message: import("@playwright/test").ConsoleMessage) => {
    if (message.text().startsWith("[Papyr"))
      pendingLogs.push(
        Promise.all(message.args().map((argument) => argument.jsonValue())).then((values) => {
          logs.push(JSON.stringify(values));
        }),
      );
  };
  page.on("console", capture);
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ json: { id: "a0630fd0-f574-49be-b12e-d3706f62bc52", username: "test-user" } }),
  );
  await page.route("**/api/v1/bootstrap?*", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: "INVALID_CURSOR", message: "private-server-message" }, diagnosticId: "test-reference" },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".sync-indicator")).toContainText("Sync needs attention");
  await expect.poll(() => logs.some((log) => log.includes("INVALID_CURSOR"))).toBe(true);
  expect(logs.some((log) => log.includes("request started") && log.includes("/api/v1/bootstrap"))).toBe(true);
  expect(logs.some((log) => log.includes("attempt failed"))).toBe(true);
  page.off("console", capture);
  await Promise.all(pendingLogs);
  expect(logs.join("\n")).not.toContain("private-server-message");
});

test("sync lock failures are logged and leave an explicit error state", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async () => {
          throw new Error("private lock error");
        },
      },
    });
  });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ json: { id: "0b413aab-3344-4bf4-89aa-ef6858b1c028", username: "test-user" } }),
  );
  await page.goto("/");
  await expect(page.locator(".sync-indicator")).toContainText("Sync needs attention");
  expect(logs.some((log) => log.includes("coordination failed"))).toBe(true);
  expect(logs.join("\n")).not.toContain("private lock error");
});
