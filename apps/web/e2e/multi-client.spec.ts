import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const account = "557cb831-1aa9-4888-9caf-554e87e1c8d2";
const noteId = "4973121d-1adf-411e-afbe-5131c8458762";

async function mockAccount(context: BrowserContext) {
  await context.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { id: account, username: "test-user" } }));
  await context.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { token: "test-token" } }));
  await context.route("**/api/v1/bootstrap?*", (route) =>
    route.fulfill({ json: { folders: [], notes: [], cursor: "seq:0" } }),
  );
  await context.route("**/api/v1/changes?*", (route) =>
    route.fulfill({ json: { changes: [], nextCursor: "seq:0", hasMore: false } }),
  );
}

async function databaseValue(page: Page, store: string, id?: string) {
  return page.evaluate(
    async ({ account, store, id }) => {
      return new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open(`papyr-account-${account}`);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction(store);
          const request = id ? transaction.objectStore(store).get(id) : transaction.objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          transaction.oncomplete = () => db.close();
          request.onerror = () => reject(request.error);
        };
        open.onerror = () => reject(open.error);
      });
    },
    { account, store, id },
  );
}

for (const type of ["markdown", "typst"] as const) {
  for (const fallback of [false, true]) {
    test(`${type} offline editor handoff flushes the old draft before enabling the new tab (${fallback ? "HTTP fallback" : "Web Locks available"})`, async ({
      page,
      context,
    }) => {
      if (fallback)
        await context.addInitScript(() =>
          Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }),
        );
      await context.route("**/api/v1/auth/me", (route) =>
        route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } }),
      );
      await page.goto("/");
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page
        .locator(".create-menu-popover")
        .getByRole("button", { name: type === "markdown" ? "Create Markdown note" : "Create Typst note" })
        .click();
      await page.getByLabel("Note title").fill("Handoff note");
      await page.getByLabel("Note title").press("Tab");
      const firstEditor = page.getByRole("textbox", { name: type === "markdown" ? "Markdown source" : "Typst source" });
      await expect(firstEditor).toHaveAttribute("aria-readonly", "false");
      // A changed preference must not split ownership of the same shared note.
      await page.evaluate(() => localStorage.setItem("papyr-profile-id", "changed-preference"));
      const second = await context.newPage();
      await second.goto(page.url());
      const secondEditor = second.getByRole("textbox", {
        name: type === "markdown" ? "Markdown source" : "Typst source",
      });
      await expect(secondEditor).toHaveAttribute("aria-readonly", "true");
      await context.setOffline(true);
      await firstEditor.fill("Unsynced source from the first tab");
      await second.getByRole("button", { name: "Continue editing here" }).click();
      await expect(secondEditor).toHaveAttribute("aria-readonly", "false");
      await expect(secondEditor).toHaveText("Unsynced source from the first tab");
      await expect(firstEditor).toHaveAttribute("aria-readonly", "true");
      await secondEditor.fill("Second tab edits offline");
      await expect(
        page.getByRole("textbox", { name: type === "markdown" ? "Markdown source" : "Typst source" }),
      ).toHaveText("Second tab edits offline");
      await context.setOffline(false);
      await second.reload();
      await expect(secondEditor).toHaveText("Second tab edits offline");
      await second.close();
    });
  }
}

test("a late mutation receipt cannot acknowledge work after sync ownership changes", async ({ page, context }) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }),
  );
  await mockAccount(context);
  let releaseResponse!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const requests: string[] = [];
  await context.route("**/api/v1/mutations", async (route) => {
    const operation = route.request().postDataJSON().operations[0];
    expect(route.request().headers()["x-papyr-account"]).toBe(account);
    requests.push(operation.operationId);
    if (requests.length === 1) {
      started();
      await responseGate;
    }
    await route.fulfill({
      json: {
        results: [
          {
            operationId: operation.operationId,
            entityId: operation.entityId,
            status: requests.length === 1 ? "accepted" : "duplicate",
            revision: "1",
          },
        ],
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".sync-indicator")).toContainText("Synced to server");
  await page.evaluate(
    async ({ account, noteId }) => {
      await new Promise<void>((resolve) => {
        const open = indexedDB.open(`papyr-account-${account}`);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction(["entities", "outbox"], "readwrite");
          const now = Date.now();
          const note = {
            id: noteId,
            kind: "note",
            type: "markdown",
            title: "Pending lease",
            content: "Never lose this",
            folderId: null,
            revision: null,
            contentSchemaVersion: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          transaction.objectStore("entities").put(note);
          transaction.objectStore("outbox").put({
            operationId: "19d036be-4124-4b12-b412-923685328a02",
            entityId: noteId,
            entityType: "note",
            action: "create",
            baseRevision: null,
            payload: note,
            createdAt: now,
            attempts: 0,
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    },
    { account, noteId },
  );
  await page.locator(".sync-indicator").click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await requestStarted;
  // Simulate a successor taking the lease while the first response is delayed.
  await page.evaluate(
    async ({ account }) => {
      await new Promise<void>((resolve) => {
        const open = indexedDB.open(`papyr-account-${account}`);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("syncMeta", "readwrite");
          const get = tx.objectStore("syncMeta").get("state");
          get.onsuccess = () =>
            tx
              .objectStore("syncMeta")
              .put({ ...get.result, lockOwner: "successor", lockExpiresAt: Date.now() + 30_000 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    },
    { account },
  );
  releaseResponse();
  await expect(page.locator(".sync-indicator")).toContainText("Waiting for another tab");
  expect(await databaseValue(page, "outbox")).toHaveLength(1);
  expect(await databaseValue(page, "entities", noteId)).toMatchObject({ content: "Never lose this", revision: null });
  expect(await databaseValue(page, "syncMeta", "state")).toMatchObject({ lockOwner: "successor", cursor: "seq:0" });
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]).toBe(requests[1]);
  await expect.poll(async () => await databaseValue(page, "outbox")).toHaveLength(0);
  expect(await databaseValue(page, "entities", noteId)).toMatchObject({ content: "Never lose this", revision: "1" });
});

test("an abandoned editor lease expires and the remaining tab recovers automatically", async ({ page, context }) => {
  await context.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator(".create-menu-popover").getByRole("button", { name: "Create Markdown note" }).click();
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.fill("Durable source before closing");
  await editor.press("Control+s");
  await expect(page.locator(".document-titlebar .save-status")).toContainText("Saved locally");
  const next = await context.newPage();
  await next.goto(page.url());
  const nextEditor = next.getByRole("textbox", { name: "Markdown source" });
  await expect(nextEditor).toHaveAttribute("aria-readonly", "true");
  await page.close();
  await next.clock.install();
  await next.clock.fastForward(31_000);
  await expect(nextEditor).toHaveAttribute("aria-readonly", "false");
  await expect(nextEditor).toHaveText("Durable source before closing");
  await next.close();
});
