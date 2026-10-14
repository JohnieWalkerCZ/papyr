import { expect, test } from "@playwright/test";

test("a rejected unsynced delete repairs its missing create and preserves Trash through reload", async ({ page }) => {
  const account = "4d061017-9b42-4778-a472-b3aa2ed2ce69";
  const entityId = "1cbe4bfc-9033-4a3a-8d98-8170d49d6738";
  const operationId = "967e51df-fdfe-42a8-a7f2-884e9ba81c51";
  const actions: string[] = [];
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { id: account, username: "test-user" } }));
  await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { token: "test-token" } }));
  await page.route("**/api/v1/bootstrap?*", (route) =>
    route.fulfill({ json: { folders: [], notes: [], cursor: "seq:0" } }),
  );
  await page.route("**/api/v1/changes?*", (route) =>
    route.fulfill({ json: { changes: [], nextCursor: "seq:0", hasMore: false } }),
  );
  await page.route("**/api/v1/mutations", async (route) => {
    const operation = route.request().postDataJSON().operations[0];
    actions.push(operation.action);
    if (operation.operationId === operationId) {
      await route.fulfill({
        json: {
          results: [
            {
              operationId,
              entityId,
              status: "rejected",
              error: { code: "NOT_FOUND", message: "Entity was not found." },
            },
          ],
        },
      });
    } else {
      if (operation.action === "create") expect(operation.payload.content).toBe("Preserved source");
      else expect(operation.baseRevision).toBe("1");
      await route.fulfill({
        json: {
          results: [
            {
              operationId: operation.operationId,
              entityId,
              status: "accepted",
              revision: operation.action === "create" ? "1" : "2",
            },
          ],
        },
      });
    }
  });
  await page.goto("/");
  await expect(page.locator(".sync-indicator")).toContainText("Synced to server");
  await page.evaluate(
    async ({ account, entityId, operationId }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(`papyr-account-${account}`);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["entities", "outbox"], "readwrite");
          const now = Date.now();
          transaction.objectStore("entities").put({
            id: entityId,
            kind: "note",
            folderId: null,
            title: "Preserved Trash note",
            type: "markdown",
            content: "Preserved source",
            contentSchemaVersion: null,
            revision: null,
            deletedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          transaction.objectStore("outbox").put({
            operationId,
            entityId,
            entityType: "note",
            action: "delete",
            baseRevision: null,
            payload: { deletedAt: now },
            createdAt: now,
            attempts: 0,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { account, entityId, operationId },
  );
  await page.locator(".sync-indicator").click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => actions).toEqual(["delete", "create", "delete"]);
  await expect(page.locator(".sync-indicator")).toContainText("Synced to server");
  await page.reload();
  await page.getByRole("button", { name: /^Trash(?: \d+)?$/ }).click();
  await expect(page.getByText("Preserved Trash note", { exact: true })).toBeVisible();
});
