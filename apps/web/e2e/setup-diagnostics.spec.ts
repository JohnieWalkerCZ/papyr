import { expect, test } from "@playwright/test";

test("setup database errors are explained in Settings and can be retried", async ({ page }) => {
  let setupChecks = 0;
  await page.route("**/api/v1/auth/setup-status", async (route) => {
    setupChecks += 1;
    await route.fulfill(
      setupChecks === 1
        ? {
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "DATABASE_SCHEMA_ERROR",
                message: "Papyr's database schema is incomplete. Check that API migrations completed.",
              },
              diagnosticId: "test-diagnostic-id",
            }),
          }
        : { status: 200, contentType: "application/json", body: JSON.stringify({ complete: false }) },
    );
  });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));

  await page.goto("/");
  await page.locator(".sidebar-settings").click();
  const diagnostic = page.locator(".setup-diagnostic");
  await expect(diagnostic).toContainText("HTTP 503 · DATABASE_SCHEMA_ERROR");
  await expect(diagnostic).toContainText("database schema is incomplete");
  await expect(diagnostic).toContainText("test-diagnostic-id");

  await diagnostic.getByRole("button", { name: "Retry setup check" }).click();
  await expect(page.getByLabel("One-time setup token")).toBeVisible();
});
