import { expect, test } from "@playwright/test";

test("HTTP fallback waits for a valid lease and automatically syncs after it expires", async ({ page }) => {
  const account = "e797175c-b30c-4637-b294-58294f501687";
  const noteId = "32fe58bb-c39d-483a-8571-824ea6ac5b8a";
  const mutations: string[] = [];
  await page.clock.install();
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }));
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { id: account, username: "test-user" } }));
  await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { token: "test-token" } }));
  await page.route("**/api/v1/bootstrap?*", (route) =>
    route.fulfill({ json: { folders: [], notes: [], cursor: "seq:0" } }),
  );
  await page.route("**/api/v1/changes?*", (route) =>
    route.fulfill({ json: { changes: [], nextCursor: "seq:0", hasMore: false } }),
  );
  await page.route("**/api/v1/mutations", (route) => {
    const operation = route.request().postDataJSON().operations[0];
    mutations.push(operation.operationId);
    return route.fulfill({
      json: {
        results: [
          { operationId: operation.operationId, entityId: operation.entityId, status: "accepted", revision: "1" },
        ],
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".sync-indicator")).toContainText("Synced to server");
  await page.evaluate(
    async ({ account, noteId }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(`papyr-account-${account}`);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["entities", "outbox", "syncMeta"], "readwrite");
          const now = Date.now();
          const note = {
            id: noteId,
            kind: "note",
            folderId: null,
            type: "markdown",
            title: "Pending lock recovery",
            content: "Preserved local source",
            revision: null,
            contentSchemaVersion: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          transaction.objectStore("entities").put(note);
          transaction.objectStore("outbox").put({
            operationId: "9c5cab0e-a425-4313-8538-906ee8652e19",
            entityId: noteId,
            entityType: "note",
            action: "create",
            baseRevision: null,
            payload: note,
            createdAt: now,
            attempts: 0,
          });
          transaction.objectStore("syncMeta").put({
            id: "state",
            cursor: "seq:0",
            bootstrapToken: null,
            acceptedOperationIds: [],
            updatedAt: now,
            lockOwner: "other-tab",
            lockExpiresAt: now + 300_000,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { account, noteId },
  );
  await page.locator(".sync-indicator").click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.locator(".sync-indicator")).toContainText("Waiting for another tab");
  expect(mutations).toHaveLength(0);
  await page.clock.fastForward(10_000);
  await expect(page.locator(".sync-indicator")).toContainText("Waiting for another tab");
  expect(mutations).toHaveLength(0);
  await page.clock.fastForward(300_100);
  await expect.poll(() => mutations.length).toBe(1);
  await expect(page.locator(".sync-indicator")).toContainText("Synced to server");
  await expect(page.getByText("Pending lock recovery", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator(".sync-indicator")).toContainText("Synced to server");
  expect(mutations).toHaveLength(1);
});
