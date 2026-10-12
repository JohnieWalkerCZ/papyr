import { expect, test } from "@playwright/test";

async function createWhiteboard(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator(".create-menu-popover").getByRole("button", { name: "Create whiteboard" }).click();
  await expect(page.getByLabel("Note title")).toBeVisible();
  await page.getByLabel("Note title").fill(title);
  await page.getByLabel("Note title").press("Tab");
}

async function exportWhiteboard(page: import("@playwright/test").Page, name: string) {
  await page.locator(".whiteboard-export > summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  return download;
}

test("whiteboard editor can enter and exit fullscreen", async ({ page }) => {
  await page.goto("/whiteboard");
  await expect(page.getByRole("button", { name: "Enter fullscreen" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Fit canvas to screen" })).toBeVisible();
  await expect(page.locator(".whiteboard-toolbar")).toBeVisible();
  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test("pen stroke and image asset survive editable snapshot reload", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/whiteboard");
  const status = page.locator("p[role=status]");
  await expect(status).toContainText("Ready");

  await page.getByRole("button", { name: /Draw —/ }).click();
  const canvas = await page.locator("canvas").first().boundingBox();
  if (!canvas) throw new Error("tldraw canvas is not available");
  await page.mouse.move(canvas.x + 200, canvas.y + 150);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 300, canvas.y + 220, { steps: 8 });
  await page.mouse.up();

  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Media/ }).click();
  await (
    await fileChooser
  ).setFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.locator("img.tl-image")).toHaveCount(1);
  await expect(status).toHaveText("Saved locally", { timeout: 5_000 });

  const snapshot = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("papyr-local");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result.transaction("snapshots").objectStore("snapshots").get("phase-zero-whiteboard");
          get.onsuccess = () => resolve(JSON.stringify(get.result.value));
          get.onerror = () => reject(get.error);
        };
      }),
  );
  expect(snapshot).toContain('"type":"draw"');
  expect(snapshot).toContain('"type":"image"');
  const snapshotDownload = await exportWhiteboard(page, "Download editable snapshot");
  expect((await snapshotDownload).suggestedFilename()).toBe("whiteboard.tldr.json");
  const pngDownload = await exportWhiteboard(page, "Export PNG");
  expect((await pngDownload).suggestedFilename()).toBe("whiteboard.png");
  const svgDownload = await exportWhiteboard(page, "Export SVG");
  expect((await svgDownload).suggestedFilename()).toBe("whiteboard.svg");

  await page.reload();
  await expect(status).toContainText("Ready");
  await expect(page.locator("img.tl-image")).toHaveCount(1);
  await expect
    .poll(() => page.locator("img.tl-image").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
});

test("a whiteboard note persists Papyr asset references and saves offline", async ({ page, context }) => {
  const externalRequests: string[] = [];
  const localAssets: number[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "cdn.tldraw.com") externalRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/tldraw/")) localAssets.push(response.status());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator(".create-menu-popover").getByRole("button", { name: "Create folder" }).click();
  await page.getByRole("textbox", { name: "Folder name" }).last().fill("Boards");
  await page.getByRole("textbox", { name: "Folder name" }).last().press("Enter");
  await createWhiteboard(page, "Asset board");
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Boards");
  await expect(page.locator(".canvas canvas").first()).toBeVisible();
  await expect(page.locator(".whiteboard-toolbar")).toBeVisible();
  await expect.poll(() => localAssets.length).toBeGreaterThan(3);
  expect(externalRequests).toEqual([]);
  expect(localAssets.every((status) => status === 200)).toBe(true);
  expect((await page.locator(".whiteboard-editor .canvas").boundingBox())?.height).toBeGreaterThan(300);
  await page.locator('input[type="file"][aria-label="Add image"]').setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.locator("img.tl-image")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("papyr-local");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction(["assets", "entities"], "readonly");
        const assets = await new Promise<number>((resolve) => {
          const request = transaction.objectStore("assets").count();
          request.onsuccess = () => resolve(request.result);
        });
        const entity = await new Promise<{ content: unknown } | undefined>((resolve) => {
          const request = transaction.objectStore("entities").getAll();
          request.onsuccess = () =>
            resolve(request.result.find((item: { title: string }) => item.title === "Asset board"));
        });
        return { assets, content: JSON.stringify(entity?.content) };
      }),
    )
    .toMatchObject({ assets: 1 });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open("papyr-local");
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction("entities", "readonly");
        const entities = await new Promise<Array<{ title: string; content: unknown }>>((resolve) => {
          const read = transaction.objectStore("entities").getAll();
          read.onsuccess = () => resolve(read.result);
        });
        return JSON.stringify(entities.find((item) => item.title === "Asset board")?.content);
      }),
    )
    .toContain("https://papyr.invalid/papyr-assets/");
  await expect(page.locator(".whiteboard-status")).toContainText(/saved/i, { timeout: 5_000 });
  const url = page.url();
  await page.reload();
  await expect(page.locator(".canvas canvas").first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("img.tl-image")).toHaveCount(1);
  await context.setOffline(false);
  await page.goto(url);
});

test("a malformed saved whiteboard stays preserved and shows a recoverable load error", async ({ page }) => {
  await page.goto("/");
  await createWhiteboard(page, "Malformed canvas");
  const id = page.url().split("/").at(-1)!;
  await page.evaluate(async (noteId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("papyr-local");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction("entities", "readwrite");
    const store = transaction.objectStore("entities");
    const request = store.get(noteId);
    request.onsuccess = () => store.put({ ...request.result, content: { malformed: true } });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }, id);
  await page.reload();
  await expect(page.locator(".whiteboard-load-error")).toContainText("Couldn’t load the saved snapshot");
  expect(
    await page.evaluate(async (noteId) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("papyr-local");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const request = database.transaction("entities", "readonly").objectStore("entities").get(noteId);
      return await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result.content);
        request.onerror = () => reject(request.error);
      });
    }, id),
  ).toEqual({ malformed: true });
});

test("a second tab cannot edit the same whiteboard until its writer lock is released", async ({ page, context }) => {
  await page.goto("/");
  await createWhiteboard(page, "Locked board");
  await expect(page.locator(".canvas canvas").first()).toBeVisible();

  const secondTab = await context.newPage();
  await secondTab.goto("/");
  await secondTab.getByRole("link", { name: "Locked board", exact: true }).click();
  await expect(secondTab.locator(".document-editor > p.save-status")).toContainText("another tab");
  await expect(secondTab.locator(".canvas")).toHaveAttribute("inert", "");
  await expect(secondTab.getByRole("button", { name: "Add image" })).toBeDisabled();
  await expect(secondTab.locator('input[type="file"][aria-label="Add image"]')).toBeDisabled();

  await page.goto("/");
  await secondTab.getByRole("button", { name: "Try editing" }).click();
  await expect(secondTab.locator(".canvas")).not.toHaveAttribute("inert", "");
  await expect(secondTab.getByRole("button", { name: "Add image" })).toBeEnabled();
  await secondTab.close();
});
