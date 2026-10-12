import { expect, test } from "@playwright/test";

type AxeIssue = { id: string; impact: string | null; nodes: { target: string[]; failureSummary: string | null }[] };

test("development whiteboard passes axe checks in Czech across themes and viewports", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("papyr-locale", "cs"));
  for (const { width, height } of [
    { width: 1440, height: 1000 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme });
      await page.goto("/whiteboard");
      await page.waitForSelector(".tl-container");
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
      expect(violations, `${width}px ${colorScheme}`).toEqual([]);
      await expect(page.locator("html")).toHaveAttribute("lang", "cs");
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        background: getComputedStyle(document.body).backgroundColor,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(width);
      expect(metrics.background).toBe(colorScheme === "dark" ? "rgb(32, 38, 41)" : "rgb(245, 243, 238)");
    }
  }
});
