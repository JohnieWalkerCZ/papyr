import { expect, test } from "@playwright/test";
import snapshot from "./fixtures/whiteboard-v2.json";

test("a previously rejected whiteboard create retries once and preserves Trash through sync and reload", async ({
  page,
}) => {
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
              error: { code: "INVALID_CONTENT", message: "Note content has an invalid format." },
            },
          ],
        },
      });
    } else {
      if (operation.action === "create") expect(operation.payload.content).toEqual(snapshot);
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
    async ({ account, entityId, operationId, snapshot }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(`papyr-account-${account}`);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["entities", "outbox"], "readwrite");
          const now = Date.now();
          const note = {
            id: entityId,
            kind: "note",
            folderId: null,
            title: "Preserved Trash note",
            type: "whiteboard",
            content: snapshot,
            contentSchemaVersion: 1,
            revision: null,
            deletedAt: now,
            createdAt: now,
            updatedAt: now,
          };
          transaction.objectStore("entities").put(note);
          transaction.objectStore("outbox").put({
            operationId,
            entityId,
            entityType: "note",
            action: "create",
            baseRevision: null,
            payload: { ...note, deletedAt: null },
            createdAt: now,
            attempts: 0,
          });
          transaction.objectStore("outbox").put({
            operationId: "efcdb3c9-e02a-4873-ae1d-a4822d0f70d7",
            entityId,
            entityType: "note",
            action: "delete",
            baseRevision: null,
            payload: { deletedAt: now },
            createdAt: now + 1,
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
    { account, entityId, operationId, snapshot },
  );
  await page.locator(".sync-indicator").click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => actions).toEqual(["create", "create", "delete"]);
  await expect(page.locator(".sync-indicator")).toContainText("Synced to server");
  await page.reload();
  await page.getByRole("button", { name: /^Trash(?: \d+)?$/ }).click();
  await expect(page.getByText("Preserved Trash note", { exact: true })).toBeVisible();
});
