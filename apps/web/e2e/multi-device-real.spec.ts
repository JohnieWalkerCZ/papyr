import { expect, test } from "@playwright/test";

const apiOrigin = process.env.PAPYR_TEST_API_ORIGIN;
const setupToken = process.env.PAPYR_TEST_SETUP_TOKEN;
test.skip(!apiOrigin || !setupToken, "Requires a disposable API/database and setup token.");

test("independent devices sync real API mutations and preserve both offline conflict versions", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  let firstOffline = false;
  try {
    for (const context of [first, second]) {
      await context.route("**/api/v1/**", async (route) => {
        if (context === first && firstOffline) {
          await route.abort("internetdisconnected");
          return;
        }
        const original = new URL(route.request().url());
        const response = await route.fetch({ url: `${apiOrigin}${original.pathname}${original.search}` });
        await route.fulfill({ response });
      });
    }
    const token = await (await first.request.get(`${apiOrigin}/api/v1/auth/csrf`)).json();
    const setup = await first.request.post(`${apiOrigin}/api/v1/setup`, {
      headers: { "X-CSRF-TOKEN": token.token, "X-Papyr-Setup-Token": setupToken! },
      data: { username: "device-owner", password: "test-only-private-password", confirmReset: true },
    });
    expect(setup.status()).toBe(201);
    const account = (await setup.json()).id;
    const secondToken = await (await second.request.get(`${apiOrigin}/api/v1/auth/csrf`)).json();
    expect(
      (
        await second.request.post(`${apiOrigin}/api/v1/auth/login`, {
          headers: { "X-CSRF-TOKEN": secondToken.token },
          data: { username: "device-owner", password: "test-only-private-password" },
        })
      ).ok(),
    ).toBe(true);
    const a = await first.newPage();
    const b = await second.newPage();
    await a.goto("/");
    await expect(a.locator(".sync-indicator")).toContainText("Synced to server");
    await a.getByRole("button", { name: "New", exact: true }).click();
    await a.locator(".create-menu-popover").getByRole("button", { name: "Create Markdown note" }).click();
    await a.getByLabel("Note title").fill("Shared between devices");
    await a.getByLabel("Note title").press("Tab");
    const aSource = a.getByRole("textbox", { name: "Markdown source" });
    await aSource.fill("Initial source");
    await aSource.press("Control+s");
    const noteId = new URL(a.url()).pathname.split("/").at(-1)!;
    await a.locator(".sync-indicator").click();
    await a.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect
      .poll(async () => {
        const response = await second.request.get(`${apiOrigin}/api/v1/notes/${noteId}`);
        return response.ok() ? (await response.json()).content : null;
      })
      .toBe("Initial source");
    await b.goto("/");
    await b.getByRole("link", { name: "Shared between devices", exact: true }).first().click();
    const bSource = b.getByRole("textbox", { name: "Markdown source" });
    await expect(bSource).toHaveText("Initial source");
    await a.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    firstOffline = true;
    await first.setOffline(true);
    await aSource.fill("First device offline draft");
    await aSource.press("Control+s");
    await expect(a.locator(".document-titlebar .save-status")).toContainText("Saved locally");
    await a.reload();
    await expect(aSource).toHaveText("First device offline draft");
    // A hard reload may abandon a lease; advance its bounded expiry without clearing storage.
    await a.clock.install();
    await a.clock.fastForward(31_000);
    await bSource.fill("Second device server version");
    await bSource.press("Control+s");
    await b.locator(".sync-indicator").click();
    await b.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect
      .poll(async () => (await (await second.request.get(`${apiOrigin}/api/v1/notes/${noteId}`)).json()).content)
      .toBe("Second device server version");
    firstOffline = false;
    await first.setOffline(false);
    await a.locator(".sync-indicator").click();
    await a.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect
      .poll(() =>
        a.evaluate(
          async ({ account, noteId }) => {
            return new Promise<{ local: string; remote: string } | null>((resolve) => {
              const open = indexedDB.open(`papyr-account-${account}`);
              open.onsuccess = () => {
                const database = open.result;
                const transaction = database.transaction("conflicts");
                const request = transaction.objectStore("conflicts").get(noteId);
                request.onsuccess = () =>
                  resolve(
                    request.result
                      ? { local: request.result.local.content, remote: request.result.remote.content }
                      : null,
                  );
                transaction.oncomplete = () => database.close();
              };
            });
          },
          { account, noteId },
        ),
      )
      .toEqual({ local: "First device offline draft", remote: "Second device server version" });
    await expect(aSource).toHaveText("First device offline draft");
  } finally {
    await first.close();
    await second.close();
  }
});
