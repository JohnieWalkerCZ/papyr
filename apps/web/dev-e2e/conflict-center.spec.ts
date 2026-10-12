import { expect, test } from "@playwright/test";

type AxeIssue = { id: string; impact: string | null; nodes: { target: string[]; failureSummary: string | null }[] };

test("conflict center reviews real local and server snapshots and keeps a local copy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Sync status: Saved on this device")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("papyr-local");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const now = Date.now();
    const markdown = {
      id: "conflict-markdown",
      kind: "note",
      folderId: null,
      title: "Draft",
      type: "markdown",
      content: "shared\nlocal line",
      contentSchemaVersion: null,
      revision: "1",
      deletedAt: null,
      createdAt: now - 10_000,
      updatedAt: now - 5_000,
    };
    const remote = { ...markdown, content: "shared\nserver line", revision: "2", updatedAt: now - 1_000 };
    const typst = {
      id: "conflict-typst",
      kind: "note",
      folderId: null,
      title: "Formula",
      type: "typst",
      content: "$x^2$",
      contentSchemaVersion: null,
      revision: "3",
      deletedAt: null,
      createdAt: now - 10_000,
      updatedAt: now - 4_000,
    };
    const transaction = database.transaction(["entities", "conflicts"], "readwrite");
    transaction.objectStore("entities").put(markdown);
    transaction.objectStore("entities").put(typst);
    transaction.objectStore("conflicts").put({ id: markdown.id, local: markdown, remote, detectedAt: now });
    transaction
      .objectStore("conflicts")
      .put({ id: typst.id, local: typst, remote: { ...typst, revision: "4", updatedAt: now - 500 }, detectedAt: now });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await page.reload();
  await expect(page.locator(".conflict-banner").getByText("2 sync conflicts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review conflicts" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Conflict center" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review conflict" })).toHaveCount(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/conflict-overview-1440.png", fullPage: true });
  await dialog.getByRole("button", { name: "Review conflict" }).first().click();
  await expect(dialog.getByRole("heading", { name: "Draft" })).toBeVisible();
  await expect(dialog.getByText("Source differences")).toBeVisible();
  await expect(dialog.locator(".diff-removed")).toContainText("local line");
  await expect(dialog.locator(".diff-added")).toContainText("server line");
  await expect(dialog.getByText("Local version", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Server version", { exact: true })).toBeVisible();
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run: (target: Document, options: object) => Promise<{ violations: AxeIssue[] }> } }
    ).axe;
    return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }))
      .violations;
  });
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);

  for (const { width, height } of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const size = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(size.page).toBeLessThanOrEqual(size.viewport);
      await page.screenshot({ path: `test-results/conflict-detail-${width}-${theme}.png`, fullPage: true });
    }
  }

  expect(
    await dialog
      .getByRole("button", { name: "Keep both versions" })
      .evaluate((button) => button.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);

  page.once("dialog", (confirm) => confirm.accept());
  await dialog.getByRole("button", { name: "Keep both versions" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("papyr-local");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction(["entities", "conflicts", "outbox"], "readonly");
        const entities = await new Promise<Array<{ id: string; title: string; content: string }>>((resolve) => {
          const request = transaction.objectStore("entities").getAll();
          request.onsuccess = () => resolve(request.result);
        });
        const conflicts = await new Promise<number>((resolve) => {
          const request = transaction.objectStore("conflicts").count();
          request.onsuccess = () => resolve(request.result);
        });
        const copies = entities.filter((item) => item.title === "Draft (local copy)");
        return { conflicts, copies: copies.map(({ id, content }) => ({ id, content })) };
      }),
    )
    .toEqual({ conflicts: 1, copies: [{ id: expect.any(String), content: "shared\nlocal line" }] });
  await dialog.getByRole("button", { name: "Review conflict" }).click();
  await expect(dialog.getByRole("heading", { name: "Formula" })).toBeVisible();
  await expect(dialog.locator(".conflict-version pre").first()).toContainText("$x^2$");
  await expect(dialog.getByText("Source differences")).toBeVisible();
});

test("whiteboard conflict explains the snapshot limitation and offers preservation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Sync status: Saved on this device")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("papyr-local");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const local = {
      id: "conflict-board",
      kind: "note",
      folderId: null,
      title: "Board",
      type: "whiteboard",
      content: { store: "local" },
      contentSchemaVersion: 1,
      revision: "5",
      deletedAt: null,
      createdAt: Date.now() - 10_000,
      updatedAt: Date.now(),
    };
    const remote = { ...local, content: { store: "server" }, revision: "6" };
    const transaction = database.transaction(["entities", "conflicts"], "readwrite");
    transaction.objectStore("entities").put(local);
    transaction.objectStore("conflicts").put({ id: local.id, local, remote, detectedAt: Date.now() });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Review conflicts" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Review conflict" }).click();
  await expect(dialog.getByText(/Whiteboard snapshots cannot be previewed here/).first()).toBeVisible();
  await expect(dialog.locator(".conflict-diff")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Keep both versions" })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/conflict-whiteboard-390.png", fullPage: true });
});
