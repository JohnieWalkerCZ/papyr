import { expect, test } from "@playwright/test";

async function createNote(
  page: import("@playwright/test").Page,
  title: string,
  type: "markdown" | "typst" | "whiteboard" = "markdown",
) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .locator(".create-menu-popover")
    .getByRole("button", {
      name:
        type === "typst" ? "Create Typst note" : type === "whiteboard" ? "Create whiteboard" : "Create Markdown note",
    })
    .click();
  await expect(page).toHaveURL(/\/notes\//);
  await expect(page.getByLabel("Note title")).toBeVisible();
  await page.getByLabel("Note title").fill(title);
  await page.getByLabel("Note title").press("Tab");
  await expect(page.locator(".document-titlebar .save-status")).toContainText("Saved locally", { timeout: 5_000 });
}

async function createFolder(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator(".create-menu-popover").getByRole("button", { name: "Create folder" }).click();
  const name = page.getByRole("textbox", { name: "Folder name" }).last();
  await name.fill(title);
  await name.press("Enter");
}

async function localNoteContent(page: import("@playwright/test").Page, title: string) {
  return page.evaluate(async (noteTitle) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("papyr-anonymous");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise<string>((resolve, reject) => {
      const request = database.transaction("entities").objectStore("entities").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const note = request.result.find(
          (item: { title: string; kind: string }) => item.title === noteTitle && item.kind === "note",
        );
        resolve(String(note?.content ?? ""));
      };
    });
  }, title);
}

test("browser security headers restrict framing and resource loading", async ({ page }) => {
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("worker-src 'self' blob:");
  expect(policy).toContain("connect-src 'self' blob: ws: wss:");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
});

test("PWA manifest provides install icons and standalone display", async ({ page }) => {
  await page.goto("/");
  const manifest = await page.evaluate(async () => await (await fetch("/manifest.webmanifest")).json());
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(["192x192", "512x512"]);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBeTruthy();
});

test("local Markdown content survives reload and offline navigation without crypto.randomUUID", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }),
  );
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.waitForLoadState("networkidle");
  await createNote(page, "Offline note");
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.pressSequentially("# IndexedDB survived\n\nčeský text");
  await expect(editor).toContainText("český text");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".document-titlebar .save-status")).toContainText("Saved locally", { timeout: 5_000 });
  const url = page.url();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toContainText("IndexedDB survived");
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toContainText("český text");
  await context.setOffline(true);
  await page.goto(url);
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toContainText("IndexedDB survived");
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toContainText("český text");
  await context.setOffline(false);
});

test("switching between open notes saves edits only to the selected note", async ({ page }) => {
  await page.goto("/");
  await createNote(page, "Switch first");
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.fill("first note");
  await page.keyboard.press("Control+s");
  await expect.poll(() => localNoteContent(page, "Switch first")).toBe("first note");

  await page.goto("/");
  await createNote(page, "Switch second");
  const firstLink = page.getByRole("link", { name: "Switch first", exact: true });
  const firstUrl = new URL((await firstLink.getAttribute("href"))!, page.url()).href;
  await firstLink.click();
  await expect(page).toHaveURL(firstUrl);
  await expect(editor).toContainText("first note");
  const secondLink = page.getByRole("link", { name: "Switch second", exact: true });
  const secondUrl = new URL((await secondLink.getAttribute("href"))!, page.url()).href;
  await secondLink.click();
  await expect(page).toHaveURL(secondUrl);
  await page.getByRole("textbox", { name: "Markdown source" }).fill("second note edited");
  await expect.poll(() => localNoteContent(page, "Switch first")).toBe("first note");
  await expect.poll(() => localNoteContent(page, "Switch second")).toBe("second note edited");
});

test("a remote revision arriving during an edit preserves both versions as a conflict", async ({ page }) => {
  await page.goto("/");
  await createNote(page, "Revision guarded");
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.fill("local draft");
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("papyr-anonymous");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("entities", "readwrite");
    const store = transaction.objectStore("entities");
    const request = store.getAll();
    request.onsuccess = () => {
      const note = request.result.find((entity: { title: string }) => entity.title === "Revision guarded");
      store.put({ ...note, content: "remote version", revision: "7" });
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    window.dispatchEvent(
      new CustomEvent("papyr-entity-updated", {
        detail: { id: request.result.find((entity: { title: string }) => entity.title === "Revision guarded").id },
      }),
    );
  });
  await expect(page.locator(".document-titlebar .save-status")).toContainText("newer version", { timeout: 5_000 });
  await expect.poll(() => localNoteContent(page, "Revision guarded")).toBe("remote version");
  const conflictContent = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("papyr-anonymous");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const request = database.transaction("conflicts").objectStore("conflicts").getAll();
    return await new Promise<string>((resolve, reject) => {
      request.onsuccess = () =>
        resolve(
          request.result.find((conflict: { local: { title: string } }) => conflict.local.title === "Revision guarded")
            .local.content,
        );
      request.onerror = () => reject(request.error);
    });
  });
  expect(conflictContent).toBe("local draft");
});

test("a second tab cannot write the same note until the first tab releases its lock", async ({ page, context }) => {
  await page.goto("/");
  await createNote(page, "Locked note");
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toBeVisible();
  const noteUrl = page.url();
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toHaveAttribute("aria-readonly", "false");

  const secondTab = await context.newPage();
  await secondTab.goto("/");
  await secondTab.getByRole("link", { name: "Locked note, Library root", exact: true }).click();
  await expect(secondTab).toHaveURL(noteUrl);
  const secondEditor = secondTab.getByRole("textbox", { name: "Markdown source" });
  await expect(secondEditor).toHaveAttribute("aria-readonly", "true");
  await expect(secondTab.locator(".document-editor > p.save-status")).toContainText("another tab");

  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  // Normal navigation flushes and releases; a crashed tab instead waits for lease expiry.
  await expect(secondEditor).toHaveAttribute("aria-readonly", "false");
  await secondTab.close();
});

test("Markdown preview renders common blocks and keeps raw HTML inert", async ({ page }) => {
  await page.goto("/");
  await createNote(page, "Preview note");
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .fill(
      "## Details\n\n**bold** and *emphasis* with `code`\n\n- first\n- second\n\n> quote\n\n<script>unsafe()</script>",
    );
  const preview = page.locator(".markdown-preview");
  await expect(preview.getByRole("heading", { name: "Details" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("bold");
  await expect(preview.locator("em")).toHaveText("emphasis");
  await expect(preview.locator("code")).toHaveText("code");
  await expect(preview.locator("ul li")).toHaveCount(2);
  await expect(preview.locator("blockquote")).toContainText("quote");
  await expect(preview.locator("script")).toHaveCount(0);
  await expect(preview).toContainText("<script>unsafe()</script>");
});

test("new Markdown note and pending create survive offline reload", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await createNote(page, "Offline notes");
  const noteId = page.url().split("/").at(-1)!;
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("papyr-anonymous");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction("entities", "readonly");
        return await new Promise<string>((resolve) => {
          const request = transaction.objectStore("entities").get(id);
          request.onsuccess = () => resolve(String(request.result?.title ?? ""));
        });
      }, noteId),
    )
    .toBe("Offline notes");
  await page.reload();
  await expect(page).toHaveURL(/\/notes\//);
  await expect(page.getByLabel("Note title")).toHaveValue("Offline notes");
  const counts = await page.evaluate(
    () =>
      new Promise<{ entities: number; outbox: number }>((resolve, reject) => {
        const request = indexedDB.open("papyr-anonymous");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction(["entities", "outbox"]);
          const entities = transaction.objectStore("entities").count();
          const outbox = transaction.objectStore("outbox").count();
          transaction.oncomplete = () => resolve({ entities: entities.result, outbox: outbox.result });
        };
      }),
  );
  expect(counts).toEqual({ entities: 1, outbox: 2 });
  await context.setOffline(false);
});

test("Typst notes use their local editor and keep source across reload", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await createNote(page, "Integral notes", "typst");
  const source = page.getByRole("textbox", { name: "Typst source" });
  await source.pressSequentially("= Integral\n\n$ integral_0^1 x dif x = 1/2 $");
  await page.locator('input[type="file"][aria-label="Add image"]').setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.locator(".save-status")).toContainText("pending sync", { timeout: 5_000 });
  await expect(source).toContainText(/#image\("papyr-asset:\/\//, { timeout: 5_000 });
  await expect(page.locator(".save-status")).toContainText("Saved locally", { timeout: 5_000 });
  await page.getByRole("button", { name: "Compile PDF" }).click();
  await expect(page.locator(".typst-editor .type-editor-toolbar p[role=status]")).toContainText("Compiled PDF", {
    timeout: 120_000,
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Typst source" })).toContainText(/papyr-asset:\/\//);
  await expect(page.getByRole("button", { name: "Export source" })).toBeVisible();
});

test("Markdown image attachment is stored locally and resolves again after reload", async ({ page }) => {
  await page.goto("/");
  await createNote(page, "Image notes");
  await page.getByLabel("Add image").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toContainText(/papyr-asset:\/\//, {
    timeout: 5_000,
  });
  await expect(page.locator(".markdown-preview img")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".save-status")).toContainText("Saved locally", { timeout: 5_000 });
  await expect.poll(() => localNoteContent(page, "Image notes")).toContain("papyr-asset://");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toContainText(/papyr-asset:\/\//);
  await expect(page.locator(".markdown-preview img")).toHaveCount(1, { timeout: 15_000 });
  await expect
    .poll(() => page.locator(".markdown-preview img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
});

test("nested folders support note moves and local text search", async ({ page }) => {
  await page.goto("/");
  await createFolder(page, "School");
  await createFolder(page, "Math");
  await page.getByRole("tree", { name: "Folders and notes" }).getByRole("button", { name: "School" }).click();
  await createFolder(page, "Physics");
  await page.getByRole("tree", { name: "Folders and notes" }).getByRole("button", { name: "Math" }).click();
  await createNote(page, "Sequences");
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .pressSequentially("The Fibonacci sequence starts with 0, 1.");
  await expect(page.getByRole("status")).toContainText("Saved locally", { timeout: 5_000 });
  await page.getByRole("link", { name: "Papyr" }).click();
  const tree = page.getByRole("tree", { name: "Folders and notes" });
  await page.getByLabel("More actions: Sequences").click();
  await page.getByRole("button", { name: "Move to folder" }).click();
  await page
    .getByLabel("Destination folder UUID, or leave blank for the library root")
    .selectOption({ label: "Physics" });
  await page.getByRole("button", { name: "Move item" }).click();
  await tree.getByRole("button", { name: "Physics" }).click();
  await expect(page.locator(".item-list a").filter({ hasText: "Sequences" })).toBeVisible();
  await page.getByRole("button", { name: /Search title and note text/ }).click();
  await page.getByPlaceholder("Search title and note text").fill("Fibonacci");
  await expect(page.getByRole("option", { name: /Sequences, markdown, School \/ Physics/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await createNote(page, "Integrals in physics", "typst");
  const source = page.getByRole("textbox", { name: "Typst source" });
  await source.pressSequentially("= Integrals\n\n$ integral_0^1 x dif x = 1/2 $");
  await expect(page.getByRole("button", { name: "Compile PDF" })).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("Saved locally", { timeout: 5_000 });
  await expect.poll(() => localNoteContent(page, "Integrals in physics")).toContain("Integrals");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Typst source" })).toContainText("Integrals");
});

test("editor folder tree follows the explorer and Library returns to the root", async ({ page }) => {
  await page.goto("/");
  await createFolder(page, "Test folder");
  await page.getByRole("tree", { name: "Folders and notes" }).getByRole("button", { name: "Test folder" }).click();
  await createNote(page, "Folder note");

  const editorTree = page.getByRole("tree", { name: "Folders and notes" });
  await expect(editorTree.getByRole("treeitem")).toHaveAttribute("aria-selected", "true");
  await page.locator(".app-sidebar").getByRole("link", { name: "Library" }).click();

  await expect(page).toHaveURL(/\/?folder=root/);
  await expect(page.locator(".app-sidebar").getByRole("button", { name: "Library" })).toHaveClass(/is-selected/);
  await expect(page.locator(".app-sidebar").getByRole("button", { name: "Test folder" })).toBeVisible();
});

test("Typst compiles a PDF with math and Czech text without network after warm-up", async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.goto("/typst");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toContainText("Compiled PDF", { timeout: 120_000 });
  const compileButton = page.getByRole("button", { name: "Compile PDF" });
  await compileButton.click();
  await expect(compileButton).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Compiled PDF", { timeout: 120_000 });
  await context.setOffline(true);
  await compileButton.click();
  await expect(page.getByRole("status")).toContainText("Compiled PDF", { timeout: 120_000 });
  await context.setOffline(false);
});

test("Typst compiler errors show a location, message, and hint", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/typst");
  const source = page.getByRole("textbox", { name: "Typst source" });
  await source.press("Control+a");
  await source.pressSequentially("$x from NN => x in CC$");
  await page.keyboard.press("Control+s");
  const error = page.getByRole("alert", { name: "Compile failed" });
  await expect(error).toContainText("main.typ:1:4", { timeout: 120_000 });
  await expect(error).toContainText("unknown variable: from");
  await expect(error).toContainText("if you meant to display multiple letters");
});
