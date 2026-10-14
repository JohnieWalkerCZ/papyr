import { expect, test } from "@playwright/test";

type AxeIssue = { id: string; impact: string | null; nodes: { target: string[]; failureSummary: string | null }[] };

test("implemented routes have no axe WCAG A/AA violations on desktop and mobile themes", async ({ page }) => {
  const cases = [
    { route: "/", width: 1440 },
    { route: "/", width: 390 },
    { route: "/typst", width: 1024 },
    { route: "/typst", width: 768 },
    { route: "/typst", width: 360 },
  ];
  for (const { route, width } of cases) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto(route);
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: { run: (target: Document, options: object) => Promise<{ violations: AxeIssue[] }> };
          }
        ).axe;
        const result = await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
        });
        return result.violations.map(({ id, impact, nodes }) => ({
          id,
          impact,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        }));
      });
      expect(violations, `${route} at ${width}px in ${colorScheme} mode`).toEqual([]);
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, `${route} horizontal overflow at ${width}px`).toBeLessThanOrEqual(
        dimensions.width,
      );
      const background = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
      expect(background, `${route} ${colorScheme} palette at ${width}px`).toBe(
        colorScheme === "dark" ? "rgb(32, 38, 41)" : "rgb(245, 243, 238)",
      );
      const themeColor = await page.locator('meta[name="theme-color"]').getAttribute("content");
      expect(themeColor).toBe(colorScheme === "dark" ? "#202629" : "#f5f3ee");
    }
  }
});

test("empty-library creation actions create a local note and the New menu supports arrow keys", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create Markdown note" }).last().click();
  await expect(page).toHaveURL(/\/notes\//);
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toBeVisible();

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "New", exact: true });
  await trigger.click();
  await trigger.press("ArrowDown");
  const menu = page.locator(".create-menu-popover");
  await expect(menu.getByRole("button", { name: "Create Markdown note" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("button", { name: "Create Typst note" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\//);
  await expect(page.getByRole("textbox", { name: "Typst source" })).toBeVisible();
});

test("sidebar width is adjustable by pointer and keyboard and persists across reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const separator = page.getByRole("separator", { name: "Resize sidebar" });
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "288");
  await page.reload();
  const restored = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(restored).toHaveAttribute("aria-valuenow", "288");
  const bounds = await restored.boundingBox();
  if (!bounds) throw new Error("Sidebar resize handle is not visible.");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 120);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 48, bounds.y + 120);
  await page.mouse.up();
  await expect(restored).toHaveAttribute("aria-valuenow", "336");
  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute("aria-valuenow", "336");
});

test("Czech language persists and Typst narrow view switches source and preview", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".app-header").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Switch language to Czech" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Knihovna");
  await page.goto("/typst");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ukázka editoru Typst");
  await expect(page.getByLabel("Zdrojový kód Typst")).toBeVisible();
  await page.getByRole("button", { name: "Náhled" }).click();
  await expect(page.getByLabel("Zdrojový kód Typst")).toBeHidden();
  await expect(page.getByLabel("Výstupní PDF")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  await page.evaluate(() => localStorage.removeItem("papyr-locale"));
});

test("Typst preview renders a readable PDF page at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/typst");
  await page.getByRole("button", { name: "Compile PDF" }).click();
  await expect(page.getByRole("link", { name: "Export PDF" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Preview" }).click();
  const pageCanvas = page.locator(".typst-pdf-pages canvas").first();
  await expect(pageCanvas).toBeVisible();
  const dimensions = await pageCanvas.evaluate((canvas) => {
    const { width, height } = canvas.getBoundingClientRect();
    return { width, height };
  });
  expect(dimensions.width).toBeGreaterThan(100);
  expect(dimensions.height).toBeGreaterThan(200);
  await expect
    .poll(() => page.locator(".typst-pdf-pages").evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  const fitPage = page.getByRole("button", { name: "Fit page" });
  await fitPage.click();
  await expect(fitPage).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Reset zoom to fit width" })).toHaveText("100%");
  await page.getByRole("button", { name: "Fit width", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fit width", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByRole("button", { name: "Reset zoom to fit width" })).toHaveText("125%");
  await expect.poll(() => pageCanvas.evaluate((canvas) => canvas.getBoundingClientRect().width)).toBeGreaterThan(390);
  await expect
    .poll(() => page.locator(".typst-pdf-pages").evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeGreaterThan(0);
  await page.locator(".typst-pdf-pages").dispatchEvent("wheel", {
    deltaY: -50,
    ctrlKey: true,
    clientX: 200,
    clientY: 200,
    bubbles: true,
    cancelable: true,
  });
  await expect(page.getByRole("button", { name: "Reset zoom to fit width" })).not.toHaveText("125%");
});

test("theme preference cycles through light, dark and system and persists", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.locator(".app-header").getByRole("button", { name: "Settings" }).click();
  const theme = page.getByRole("button", { name: "Theme: System" });
  await theme.click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 243, 238)");
  await page.getByRole("button", { name: "Theme: Light" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(32, 38, 41)");
  await page.reload();
  await page.locator(".app-header").getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("button", { name: "Theme: Dark" })).toBeVisible();
  await page.getByRole("button", { name: "Theme: Dark" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 243, 238)");
  await page.evaluate(() => localStorage.removeItem("papyr-theme"));
});

test("application navigation shows a visible focus ring", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Papyr" })).toBeFocused();
  const focusStyle = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ outlineStyle: "solid", outlineWidth: "2px" });
});

test("local-save failure does not navigate to a note that was not persisted", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBObjectStore.prototype, "add", {
      configurable: true,
      value() {
        throw new DOMException("Storage full", "QuotaExceededError");
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator(".create-menu-popover").getByRole("button", { name: "Create Markdown note" }).click();
  await expect(page.locator(".sync-indicator")).toContainText("Storage full");
  await expect(page).toHaveURL("http://localhost:3001/");
});

test("visible Papyr controls meet 44px touch-target height on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of ["/", "/typst"]) {
    await page.goto(route);
    const heights = await page
      .locator("button, input, a[href]")
      .evaluateAll((controls) =>
        controls
          .filter((control) => control.checkVisibility())
          .map((control) => Math.round(control.getBoundingClientRect().height)),
      );
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect(height, `${route} control height`).toBeGreaterThanOrEqual(44);
  }
});
