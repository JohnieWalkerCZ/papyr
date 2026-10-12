import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import Dexie from "dexie";
import {
  createLocalDb,
  createFolder,
  createMarkdownNote,
  createNote,
  listLocalNotes,
  moveLocalEntity,
  resolveLocalConflict,
  renameLocalEntity,
  setDeletedLocalEntity,
  storeLocalAttachment,
  updateLocalNote,
} from "../src/lib/local-db.ts";

test("schema upgrade preserves Phase 0 data and adds library stores", async () => {
  const name = `papyr-migration-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(1).stores({ drafts: "id, updatedAt", snapshots: "id, updatedAt" });
  await legacy.open();
  await legacy.table("drafts").put({ id: "phase-zero-proof", content: "keep me", updatedAt: 1 });
  legacy.close();

  const db = createLocalDb(name);
  await db.open();
  assert.equal((await db.drafts.get("phase-zero-proof"))?.content, "keep me");
  assert.deepEqual(await db.entities.toArray(), []);
  assert.deepEqual(await db.outbox.toArray(), []);
  db.close();
  await Dexie.delete(name);
});

test("note and create operation commit together and can be listed", async () => {
  const name = `papyr-create-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  const note = await createMarkdownNote("  Sequences  ", db);

  assert.equal(note.title, "Sequences");
  assert.deepEqual(await listLocalNotes(db), [note]);
  const [operation] = await db.outbox.toArray();
  assert.equal(operation.entityType, "note");
  assert.equal(operation.entityId, note.id);
  assert.equal(operation.action, "create");
  assert.equal(operation.baseRevision, null);
  assert.deepEqual(operation.payload, note);
  assert.ok(operation.createdAt >= note.createdAt);
  assert.equal(operation.attempts, 0);
  db.close();
  await Dexie.delete(name);
});

test("typed notes keep their type and selected parent in the atomic create payload", async () => {
  const name = `papyr-typed-create-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  const parent = await createFolder("Math", null, db);
  const typst = await createNote("Integrals", "typst", db, parent.id);
  const whiteboard = await createNote("Diagram", "whiteboard", db, parent.id);
  const operations = await db.outbox.orderBy("createdAt").toArray();
  assert.deepEqual(
    operations.map(({ action }) => action),
    ["create", "create", "create"],
  );
  assert.equal(operations[1].payload.type, "typst");
  assert.equal(operations[1].payload.folderId, parent.id);
  assert.equal(operations[2].payload.type, "whiteboard");
  assert.equal(operations[2].payload.contentSchemaVersion, 1);
  assert.equal(operations[2].payload.content, null);
  assert.equal(typst.type, "typst");
  assert.equal(whiteboard.folderId, parent.id);
  db.close();
  await Dexie.delete(name);
});

test("failed outbox write rolls back the note", async () => {
  const name = `papyr-atomic-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  db.outbox.hook("creating", () => {
    throw new Error("simulated outbox failure");
  });

  await assert.rejects(createMarkdownNote("Do not orphan", db), /simulated outbox failure/);
  assert.deepEqual(await db.entities.toArray(), []);
  assert.deepEqual(await db.outbox.toArray(), []);
  db.close();
  await Dexie.delete(name);
});

test("empty titles are rejected before writing", async () => {
  const name = `papyr-title-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  await assert.rejects(createMarkdownNote("  ", db), /title is required/);
  assert.deepEqual(await db.entities.toArray(), []);
  db.close();
  await Dexie.delete(name);
});

test("image attachment bytes and upload metadata persist in IndexedDB", async () => {
  const name = `papyr-asset-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  const file = new File([new Uint8Array([1, 2, 3])], "pixel.png", { type: "image/png" });
  const asset = await storeLocalAttachment(file, db);
  const saved = await db.assets.get(asset.id);
  assert.equal(saved.state, "pending");
  assert.equal(saved.mimeType, "image/png");
  assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
  await assert.rejects(
    storeLocalAttachment(new File(["no"], "page.html", { type: "text/html" }), db),
    /PNG, JPEG, GIF, or WebP/,
  );
  db.close();
  await Dexie.delete(name);
});

test("offline folder and note changes persist with ordered outbox operations", async () => {
  const name = `papyr-library-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  const parent = await createFolder("School", null, db);
  const child = await createFolder("Math", parent.id, db);
  const note = await createMarkdownNote("Sequences", db);
  await moveLocalEntity(note.id, child.id, db);
  await updateLocalNote(note.id, { content: "# Sequences\nλ" }, db);
  await renameLocalEntity(note.id, "Series", db);
  await setDeletedLocalEntity(note.id, true, db);
  const saved = await db.entities.get(note.id);
  assert.equal(saved.title, "Series");
  assert.equal(saved.content, "# Sequences\nλ");
  assert.ok(saved.deletedAt);
  assert.deepEqual(
    (await db.outbox.orderBy("createdAt").toArray()).map(({ action }) => action),
    ["create", "create", "create", "move", "update", "rename", "delete"],
  );
  db.close();
  await Dexie.delete(name);
});

test("simultaneous note title and content changes merge in IndexedDB", async () => {
  const db = createLocalDb(`papyr-parallel-save-${crypto.randomUUID()}`);
  const note = await createMarkdownNote("Before", db);
  await Promise.all([
    updateLocalNote(note.id, { content: "new content" }, db),
    updateLocalNote(note.id, { title: "New title" }, db),
  ]);
  const saved = await db.entities.get(note.id);
  assert.equal(saved.title, "New title");
  assert.equal(saved.content, "new content");
  db.close();
  await Dexie.delete(db.name);
});

test("a stale editor save becomes a conflict without replacing remote content", async () => {
  const db = createLocalDb(`papyr-stale-save-${crypto.randomUUID()}`);
  const note = await createMarkdownNote("Draft", db);
  await db.outbox.clear();
  await db.entities.put({ ...note, content: "remote version", revision: "2" });
  await assert.rejects(updateLocalNote(note.id, { content: "local draft" }, db, null), /newer version arrived/);
  assert.equal((await db.entities.get(note.id)).content, "remote version");
  const conflict = await db.conflicts.get(note.id);
  assert.equal(conflict.local.content, "local draft");
  assert.equal(conflict.remote.content, "remote version");
  db.close();
  await Dexie.delete(db.name);
});

test("folder moves reject descendant cycles without changing the folder", async () => {
  const name = `papyr-cycle-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  const parent = await createFolder("Parent", null, db);
  const child = await createFolder("Child", parent.id, db);
  await assert.rejects(moveLocalEntity(parent.id, child.id, db), /descendants/);
  assert.equal((await db.entities.get(parent.id)).parentId, null);
  db.close();
  await Dexie.delete(name);
});

test("folder trash and restore cascade only through its own tombstone", async () => {
  const name = `papyr-trash-${crypto.randomUUID()}`;
  const db = createLocalDb(name);
  const parent = await createFolder("Parent", null, db);
  const child = await createFolder("Child", parent.id, db);
  const note = await createMarkdownNote("Nested", db);
  await moveLocalEntity(note.id, child.id, db);
  await setDeletedLocalEntity(parent.id, true, db);
  const [deletedParent, deletedChild, deletedNote] = await Promise.all([
    db.entities.get(parent.id),
    db.entities.get(child.id),
    db.entities.get(note.id),
  ]);
  assert.equal(deletedParent.deletedAt, deletedChild.deletedAt);
  assert.equal(deletedChild.deletedAt, deletedNote.deletedAt);
  await setDeletedLocalEntity(parent.id, false, db);
  assert.equal((await db.entities.get(child.id)).deletedAt, null);
  assert.equal((await db.entities.get(note.id)).deletedAt, null);
  assert.equal((await db.outbox.orderBy("createdAt").toArray()).filter(({ action }) => action === "delete").length, 3);
  assert.equal((await db.outbox.orderBy("createdAt").toArray()).filter(({ action }) => action === "restore").length, 3);
  db.close();
  await Dexie.delete(name);
});

test("keeping the server preserves the local note as a separate recovery copy", async () => {
  const db = createLocalDb(`papyr-conflict-${crypto.randomUUID()}`);
  const local = await createMarkdownNote("Draft", db);
  local.content = "local work";
  local.updatedAt = 10;
  await db.entities.put(local);
  await db.conflicts.put({
    id: local.id,
    local,
    remote: { ...local, title: "Server draft", content: "server work", revision: "7", updatedAt: 20 },
    detectedAt: 30,
  });
  const conflict = await db.conflicts.get(local.id);
  await resolveLocalConflict(conflict, "remote", " (copy)", db);

  const copy = (await db.entities.toArray()).find(({ id }) => id !== local.id);
  assert.equal(copy.title, "Draft (copy)");
  assert.equal(copy.content, "local work");
  assert.notEqual(copy.id, local.id);
  assert.equal((await db.entities.get(local.id)).content, "server work");
  assert.equal(await db.conflicts.count(), 0);
  assert.equal(await db.outbox.where("entityId").equals(copy.id).count(), 0);
  await assert.rejects(resolveLocalConflict(conflict, "remote", " (copy)", db), /already been resolved/);
  db.close();
  await Dexie.delete(db.name);
});

test("keeping both creates a queued independent note with the original content and type", async () => {
  const db = createLocalDb(`papyr-conflict-copy-${crypto.randomUUID()}`);
  const local = await createNote("Derivation", "typst", db);
  local.content = "#let answer = 42";
  local.updatedAt = 10;
  await db.entities.put(local);
  await db.conflicts.put({
    id: local.id,
    local,
    remote: { ...local, content: "#let answer = 0", revision: "7", updatedAt: 20 },
    detectedAt: 30,
  });
  const previousOperation = await db.outbox.orderBy("createdAt").last();
  await resolveLocalConflict(await db.conflicts.get(local.id), "copy", " (copy)", db);
  const copy = (await db.entities.toArray()).find(({ id }) => id !== local.id);
  assert.equal(copy.type, "typst");
  assert.equal(copy.content, "#let answer = 42");
  assert.notEqual(copy.id, local.id);
  const operation = await db.outbox.where("entityId").equals(copy.id).first();
  assert.equal(operation.action, "create");
  assert.ok(operation.createdAt > previousOperation.createdAt);
  assert.deepEqual(operation.payload, copy);
  assert.equal((await db.entities.get(local.id)).content, "#let answer = 0");
  db.close();
  await Dexie.delete(db.name);
});

test("conflict resolution preserves edits made after the conflict was detected", async () => {
  const db = createLocalDb(`papyr-newest-conflict-${crypto.randomUUID()}`);
  const note = await createNote("Draft", "markdown", db);
  await db.entities.put({ ...note, content: "local at detection" });
  const conflict = {
    id: note.id,
    local: { ...note, content: "local at detection" },
    remote: { ...note, content: "remote", revision: "2" },
    detectedAt: Date.now(),
  };
  await db.conflicts.put(conflict);
  await updateLocalNote(note.id, { content: "newer local edit" }, db);
  await resolveLocalConflict(conflict, "copy", " (copy)", db);
  const copy = (await db.entities.toArray()).find((entity) => entity.id !== note.id);
  assert.equal(copy.content, "newer local edit");
  db.close();
  await Dexie.delete(db.name);
});

test("failed conflict preservation leaves the original entity, outbox, and conflict intact", async () => {
  const db = createLocalDb(`papyr-conflict-rollback-${crypto.randomUUID()}`);
  const local = await createMarkdownNote("Draft", db);
  local.content = "recoverable";
  await db.entities.put(local);
  await db.conflicts.put({
    id: local.id,
    local,
    remote: { ...local, content: "server", revision: "2" },
    detectedAt: 30,
  });
  db.entities.hook("creating", () => {
    throw new Error("quota full");
  });
  await assert.rejects(resolveLocalConflict(await db.conflicts.get(local.id), "remote", " (copy)", db), /quota full/);
  assert.equal((await db.entities.get(local.id)).content, "recoverable");
  assert.equal(await db.conflicts.count(), 1);
  assert.equal(await db.outbox.where("entityId").equals(local.id).count(), 1);
  db.close();
  await Dexie.delete(db.name);
});
