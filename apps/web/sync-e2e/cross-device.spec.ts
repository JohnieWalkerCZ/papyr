import { expect, test } from "@playwright/test";

const setupToken = process.env.PAPYR_TEST_SETUP_TOKEN;
test.skip(!setupToken, "Run with a disposable API database and PAPYR_TEST_SETUP_TOKEN.");

test("two browser profiles receive live sync hints and preserve divergent edits as conflicts", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  let hubConnected = false;
  secondPage.on("websocket", (socket) => {
    if (socket.url().includes("/hubs/changes")) hubConnected = true;
  });

  try {
    await firstPage.goto("/");
    await firstPage.getByRole("button", { name: "Settings" }).first().click();
    await firstPage.getByRole("button", { name: "First-time setup" }).click();
    await firstPage.getByLabel("Username").fill("sync-owner");
    await firstPage.getByLabel("Password").fill("correct horse battery staple");
    await firstPage.getByLabel("One-time setup token").fill(setupToken!);
    await firstPage.getByLabel(/I understand this permanently resets/).check();
    await firstPage.getByRole("button", { name: "Initialize owner" }).click();
    await expect(firstPage.getByText("Signed in as sync-owner")).toBeVisible({ timeout: 15_000 });
    await firstPage.getByRole("button", { name: "Close" }).click();

    await secondPage.goto("/");
    await secondPage.getByRole("button", { name: "Settings" }).first().click();
    const hubStarted = secondPage.waitForEvent("websocket", (socket) => socket.url().includes("/hubs/changes"));
    await secondPage.getByLabel("Username").fill("sync-owner");
    await secondPage.getByLabel("Password").fill("correct horse battery staple");
    await secondPage.getByRole("button", { name: "Sign in" }).click();
    await expect(secondPage.getByText("Signed in as sync-owner")).toBeVisible();
    await secondPage.getByRole("button", { name: "Close" }).click();
    await hubStarted;
    expect(hubConnected).toBeTruthy();

    await firstPage.getByRole("button", { name: "New", exact: true }).click();
    await firstPage.locator(".create-menu-popover").getByRole("button", { name: "Create Markdown note" }).click();
    await firstPage.getByLabel("Note title").fill("Cross-device note");
    await firstPage.getByLabel("Note title").press("Tab");
    const noteLink = secondPage.getByRole("link", { name: "Cross-device note", exact: true });
    await expect(noteLink).toBeVisible({ timeout: 15_000 });

    await firstPage.getByRole("link", { name: "Cross-device note", exact: true }).click();
    const firstEditor = firstPage.getByRole("textbox", { name: "Markdown source" });
    await firstPage.getByLabel("Add image").setInputFiles({
      name: "cross-device.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await expect(firstEditor).toHaveValue(/papyr-asset:\/\/[0-9a-f-]{36}/, { timeout: 5_000 });
    const noteId = firstPage.url().split("/").at(-1)!;
    await firstPage.getByRole("link", { name: "← Back to Papyr" }).click();
    await expect
      .poll(() =>
        firstPage.evaluate(async (id) => {
          const databaseName = (await indexedDB.databases()).find((database) =>
            database.name?.startsWith("papyr-account-"),
          )?.name;
          if (!databaseName) throw new Error("Account database was not created");
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(databaseName);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          const transaction = database.transaction("entities", "readonly");
          return await new Promise<string>((resolve) => {
            const request = transaction.objectStore("entities").get(id);
            request.onsuccess = () => resolve(JSON.stringify(request.result?.content ?? ""));
          });
        }, noteId),
      )
      .toContain("papyr-asset://");

    await noteLink.click();
    const secondEditor = secondPage.getByRole("textbox", { name: "Markdown source" });
    await expect(secondPage.locator(".markdown-preview img")).toBeVisible({ timeout: 15_000 });
    await secondEditor.fill("# Second device\n\nSynced through the server");
    await secondPage.getByRole("link", { name: "← Back to Papyr" }).click();
    await secondPage.getByRole("button", { name: "Sync now" }).click();
    await expect(secondPage.getByText("Synced to server.", { exact: true })).toBeVisible({ timeout: 15_000 });
    await firstPage.getByRole("link", { name: "Cross-device note", exact: true }).click();
    await expect(firstPage.getByRole("textbox", { name: "Markdown source" })).toHaveValue(
      "# Second device\n\nSynced through the server",
      { timeout: 15_000 },
    );

    await secondPage.getByRole("link", { name: "Cross-device note", exact: true }).click();
    await secondPage.getByRole("textbox", { name: "Markdown source" }).fill("First queued edit");
    await secondPage.waitForTimeout(500);
    await secondPage.getByRole("textbox", { name: "Markdown source" }).fill("Second queued edit");
    await secondPage.waitForTimeout(500);
    await secondPage.getByRole("link", { name: "← Back to Papyr" }).click();
    await secondPage.getByRole("button", { name: "Sync now" }).click();
    await expect(secondPage.getByText("Synced to server.", { exact: true })).toBeVisible({ timeout: 15_000 });
    await secondPage.getByRole("link", { name: "Cross-device note", exact: true }).click();
    await expect(secondPage.getByRole("textbox", { name: "Markdown source" })).toHaveValue("Second queued edit");
    await secondPage.getByRole("link", { name: "← Back to Papyr" }).click();

    await firstContext.setOffline(true);
    await firstPage.getByRole("textbox", { name: "Markdown source" }).fill("# Offline device edit");
    await firstPage.getByRole("textbox", { name: "Markdown source" }).blur();
    await expect(firstPage.getByRole("status")).toHaveText("Saved locally · pending sync");
    await firstPage.getByRole("link", { name: "← Back to Papyr" }).click();
    await secondPage.getByRole("link", { name: "Cross-device note", exact: true }).click();
    await secondPage.getByRole("textbox", { name: "Markdown source" }).fill("# Online device edit");
    await secondPage.getByRole("link", { name: "← Back to Papyr" }).click();

    await firstContext.setOffline(false);
    await firstPage.goto("/");
    await expect(firstPage.getByText("Signed in as sync-owner")).toBeVisible({ timeout: 15_000 });
    await firstPage.getByRole("button", { name: "Sync now" }).click();
    await expect(firstPage.getByRole("heading", { name: "Conflicts" })).toBeVisible({ timeout: 15_000 });
    await expect(firstPage.getByText("Local and server versions both have changes.")).toBeVisible();
    await firstPage.locator(".conflict-dialog").getByRole("button", { name: "Close" }).click();

    await firstPage.getByRole("button", { name: "Settings" }).first().click();
    await firstPage.getByLabel("Username").fill("second-user");
    await firstPage.getByLabel("Password").fill("another password");
    await firstPage.getByRole("button", { name: "Create account" }).click();
    await expect(firstPage.getByText("Account created. Share its username and password securely.")).toBeVisible();
    await firstPage.getByRole("button", { name: "Sign out" }).click();
    await firstPage.getByRole("button", { name: "Settings" }).first().click();
    await firstPage.getByLabel("Username").fill("second-user");
    await firstPage.getByLabel("Password").fill("another password");
    await firstPage.getByRole("button", { name: "Sign in" }).click();
    await expect(firstPage.getByText("Signed in as second-user")).toBeVisible({ timeout: 15_000 });
    await firstPage.getByRole("button", { name: "Close" }).click();
    await expect(firstPage.getByRole("link", { name: "Cross-device note", exact: true })).toHaveCount(0);
    await firstPage.getByRole("button", { name: "Settings" }).first().click();
    await firstPage.getByRole("button", { name: "Sign out" }).click();
    await firstPage.getByRole("button", { name: "Settings" }).first().click();
    await firstPage.getByLabel("Username").fill("sync-owner");
    await firstPage.getByLabel("Password").fill("correct horse battery staple");
    await firstPage.getByRole("button", { name: "Sign in" }).click();
    await expect(firstPage.getByText("Signed in as sync-owner")).toBeVisible({ timeout: 15_000 });
    await firstPage.getByRole("button", { name: "Close" }).click();
    await expect(firstPage.getByRole("link", { name: "Cross-device note", exact: true })).toBeVisible();
    expect(
      (await firstContext.cookies()).some((cookie) => cookie.name === "papyr_session" && cookie.httpOnly),
    ).toBeTruthy();
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
