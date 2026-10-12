import { expect, test } from "@playwright/test";

test("development CSP permits React eval-based diagnostics", async ({ page }) => {
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";

  expect(policy).toContain("'unsafe-eval'");
  expect(policy).toContain("connect-src 'self' blob: ws: wss:");
  expect(policy).toContain("frame-ancestors 'none'");
  await expect(
    page.evaluate(async () => {
      const url = URL.createObjectURL(new Blob(["pdf preview"]));
      try {
        return await (await fetch(url)).text();
      } finally {
        URL.revokeObjectURL(url);
      }
    }),
  ).resolves.toBe("pdf preview");
});

test("whiteboard loads tldraw assets from the Papyr origin", async ({ page }) => {
  const externalRequests: string[] = [];
  const localAssets: number[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "cdn.tldraw.com") externalRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/tldraw/")) localAssets.push(response.status());
  });

  await page.goto("/whiteboard");
  await expect(page.locator(".tl-container")).toBeVisible();
  await expect.poll(() => localAssets.length).toBeGreaterThan(3);
  expect(externalRequests).toEqual([]);
  expect(localAssets.every((status) => status === 200)).toBe(true);
});
