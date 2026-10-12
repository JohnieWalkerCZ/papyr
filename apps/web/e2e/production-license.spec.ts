import { expect, test } from "@playwright/test";

test("production keeps tldraw disabled without a license key", async ({ page }) => {
  await page.goto("/whiteboard");
  await expect(page.getByRole("heading", { name: "Whiteboard unavailable" })).toBeVisible();
  await expect(
    page.getByText("Production is blocked until an applicable tldraw license key is configured."),
  ).toBeVisible();
});
