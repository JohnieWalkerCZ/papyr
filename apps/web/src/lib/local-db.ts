import { createUuid } from "./uuid.js";
import Dexie, { type EntityTable } from "dexie";

export interface LocalDraft {
  id: "phase-zero-proof";
  content: string;
  updatedAt: number;
}

export interface LocalSnapshot {
  id: string;
  value: unknown;
  updatedAt: number;
}

export interface LocalFolder {
  id: string;
  kind: "folder";
  parentId: string | null;
  title: string;
  revision: string | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalNote {
  id: string;
  kind: "note";
  folderId: string | null;
  title: string;
  type: "markdown" | "typst" | "whiteboard";
  content: string | unknown;
  contentSchemaVersion: number | null;
  revision: string | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type LocalEntity = LocalFolder | LocalNote;

export interface LocalOperation {
  operationId: string;
  entityType: "folder" | "note";
  entityId: string;
  action: "create" | "update" | "move" | "rename" | "delete" | "restore" | "purge";
  baseRevision: string | null;
  payload:
    | LocalEntity
    | {
        title?: string;
        folderId?: string | null;
        parentId?: string | null;
        deletedAt?: number | null;
        content?: string | unknown;
      };
  createdAt: number;
  attempts: number;
}

export interface LocalSyncMeta {
  id: string;
  cursor: string | null;
  bootstrapToken: string | null;
  acceptedOperationIds: string[];
  lockOwner?: string;
  lockExpiresAt?: number;
  updatedAt: number;
}

export interface LocalConflict {
  id: string;
  local: LocalEntity;
  remote: LocalEntity;
  detectedAt: number;
  remotePurged?: boolean;
  purgePending?: boolean;
}

export interface LocalAsset {
  id: string;
  blob: Blob;
  sha256: string;
  mimeType: string;
  byteLength: number;
  state: "pending" | "uploaded";
  createdAt: number;
}

export function createLocalDb(name = "papyr-local") {
  const db = new Dexie(name) as Dexie & {
    drafts: EntityTable<LocalDraft, "id">;
    snapshots: EntityTable<LocalSnapshot, "id">;
    entities: EntityTable<LocalEntity, "id">;
    outbox: EntityTable<LocalOperation, "operationId">;
    syncMeta: EntityTable<LocalSyncMeta, "id">;
    conflicts: EntityTable<LocalConflict, "id">;
    assets: EntityTable<LocalAsset, "id">;
  };
  db.version(1).stores({ drafts: "id, updatedAt", snapshots: "id, updatedAt" });
  db.version(2).stores({
    drafts: "id, updatedAt",
    snapshots: "id, updatedAt",
    entities: "id, kind, folderId, parentId, updatedAt, deletedAt",
    outbox: "operationId, entityId, createdAt",
  });
  db.version(3).stores({
    drafts: "id, updatedAt",
    snapshots: "id, updatedAt",
    entities: "id, kind, folderId, parentId, updatedAt, deletedAt",
    outbox: "operationId, entityId, createdAt",
  });
  db.version(4).stores({
    drafts: "id, updatedAt",
    snapshots: "id, updatedAt",
    entities: "id, kind, folderId, parentId, updatedAt, deletedAt",
    outbox: "operationId, entityId, createdAt",
    syncMeta: "id",
    conflicts: "id, detectedAt",
  });
  db.version(5).stores({
    drafts: "id, updatedAt",
    snapshots: "id, updatedAt",
    entities: "id, kind, folderId, parentId, updatedAt, deletedAt",
    outbox: "operationId, entityId, createdAt",
    syncMeta: "id",
    conflicts: "id, detectedAt",
    assets: "id, state, createdAt",
  });
  return db;
}

export const localDb = createLocalDb();

export async function storeLocalAttachment(file: File, database = localDb): Promise<LocalAsset> {
  const supported = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (!supported.includes(file.type)) throw new Error("Choose a PNG, JPEG, GIF, or WebP image.");
  if (file.size <= 0 || file.size > 4_000_000) throw new Error("Images must be no larger than 4 MB.");
  const bytes = await file.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const asset: LocalAsset = {
    id: createUuid(),
    blob: new Blob([bytes], { type: file.type }),
    sha256,
    mimeType: file.type,
    byteLength: file.size,
    state: "pending",
    createdAt: Date.now(),
  };
  await database.assets.add(asset);
  return asset;
}

export async function createMarkdownNote(title: string, database = localDb): Promise<LocalNote> {
  return createNote(title, "markdown", database);
}

export async function createNote(
  title: string,
  type: LocalNote["type"] = "markdown",
  database = localDb,
  folderId: string | null = null,
): Promise<LocalNote> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("A note title is required.");
  if (folderId) {
    const parent = await database.entities.get(folderId);
    if (!parent || parent.kind !== "folder" || parent.deletedAt) throw new Error("Parent folder not found.");
  }

  const now = Date.now();
  const note: LocalNote = {
    id: createUuid(),
    kind: "note",
    folderId,
    title: normalizedTitle,
    type,
    content: type === "whiteboard" ? null : "",
    contentSchemaVersion: type === "whiteboard" ? 1 : null,
    revision: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await queue(note, "create", note, database, true);
  return note;
}

export async function resolveLocalConflict(
  conflict: LocalConflict,
  action: "remote" | "copy" | "overwrite",
  copySuffix = " (local copy)",
  database = localDb,
) {
  await database.transaction("rw", database.entities, database.outbox, database.conflicts, async () => {
    if (!(await database.conflicts.get(conflict.id))) throw new Error("This conflict has already been resolved.");
    const latestLocal = await database.entities.get(conflict.id);
    const localSnapshot = latestLocal?.kind === "note" ? latestLocal : conflict.local;
    const saveCopy = async (local: LocalNote, queue: boolean) => {
      const copy = {
        ...local,
        id: createUuid(),
        title: `${local.title}${copySuffix}`,
        deletedAt: null,
        revision: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await database.entities.add(copy);
      if (!queue) return;
      const operation: LocalOperation = {
        operationId: createUuid(),
        entityType: "note",
        entityId: copy.id,
        action: "create",
        baseRevision: null,
        payload: copy,
        createdAt: Math.max(Date.now(), ((await database.outbox.orderBy("createdAt").last())?.createdAt ?? 0) + 1),
        attempts: 0,
      };
      await database.outbox.add(operation);
    };

    if (action === "remote" || action === "copy") {
      if (action === "copy" && conflict.local.kind !== "note") {
        throw new Error("Folder conflicts cannot be copied safely; resolve the folder in the library.");
      }
      if (action === "remote" && localSnapshot.kind === "note") await saveCopy(localSnapshot, false);
      if (action === "copy") await saveCopy(localSnapshot as LocalNote, true);
      await database.outbox.where("entityId").equals(conflict.id).delete();
      if (conflict.remotePurged) await database.entities.delete(conflict.id);
      else await database.entities.put(conflict.remote);
    } else if (conflict.remotePurged) {
      const local = { ...localSnapshot, deletedAt: null, revision: null, updatedAt: Date.now() } as LocalEntity;
      const operation: LocalOperation = {
        operationId: createUuid(),
        entityType: local.kind,
        entityId: local.id,
        action: "create",
        baseRevision: null,
        payload: local,
        createdAt: Math.max(Date.now(), ((await database.outbox.orderBy("createdAt").last())?.createdAt ?? 0) + 1),
        attempts: 0,
      };
      await database.outbox.where("entityId").equals(local.id).delete();
      await database.outbox.add(operation);
      await database.entities.put(local);
    } else if (conflict.purgePending) {
      const local = localSnapshot;
      let createdAt = Math.max(Date.now(), ((await database.outbox.orderBy("createdAt").last())?.createdAt ?? 0) + 1);
      const operations: LocalOperation[] = [];
      if (conflict.remote.deletedAt === null)
        operations.push({
          operationId: createUuid(),
          entityType: local.kind,
          entityId: local.id,
          action: "delete",
          baseRevision: conflict.remote.revision,
          payload: { deletedAt: Date.now() },
          createdAt: createdAt++,
          attempts: 0,
        });
      operations.push({
        operationId: createUuid(),
        entityType: local.kind,
        entityId: local.id,
        action: "purge",
        baseRevision: conflict.remote.revision,
        payload: local,
        createdAt,
        attempts: 0,
      });
      await database.outbox.where("entityId").equals(local.id).delete();
      await database.outbox.bulkAdd(operations);
      await database.entities.delete(local.id);
    } else {
      const local = localSnapshot;
      const remote = conflict.remote;
      const operation: LocalOperation = {
        operationId: createUuid(),
        entityType: local.kind,
        entityId: local.id,
        action: local.kind === "note" ? "update" : "rename",
        baseRevision: remote.revision,
        payload: local.kind === "note" ? { title: local.title, content: local.content } : { title: local.title },
        createdAt: Math.max(Date.now(), ((await database.outbox.orderBy("createdAt").last())?.createdAt ?? 0) + 1),
        attempts: 0,
      };
      await database.outbox.where("entityId").equals(local.id).delete();
      await database.outbox.add(operation);
      await database.entities.put({ ...local, revision: remote.revision });
    }
    await database.conflicts.delete(conflict.id);
  });
}

export async function createFolder(
  title: string,
  parentId: string | null = null,
  database = localDb,
): Promise<LocalFolder> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("A folder title is required.");
  if (parentId && !(await database.entities.get(parentId))?.kind.includes("folder"))
    throw new Error("Parent folder not found.");
  const now = Date.now();
  const folder: LocalFolder = {
    id: createUuid(),
    kind: "folder",
    parentId,
    title: normalizedTitle,
    revision: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await queue(folder, "create", folder, database);
  return folder;
}

async function queue(
  entity: LocalEntity,
  action: LocalOperation["action"],
  payload: LocalOperation["payload"],
  database: typeof localDb,
  create = false,
) {
  await database.transaction("rw", database.entities, database.outbox, async () => {
    await queueInTransaction(entity, action, payload, database, create);
  });
}

async function queueInTransaction(
  entity: LocalEntity,
  action: LocalOperation["action"],
  payload: LocalOperation["payload"],
  database: typeof localDb,
  create = false,
) {
  const last = await database.outbox.orderBy("createdAt").last();
  const operation: LocalOperation = {
    operationId: createUuid(),
    entityType: entity.kind,
    entityId: entity.id,
    action,
    baseRevision: entity.revision,
    payload,
    createdAt: Math.max(Date.now(), (last?.createdAt ?? 0) + 1),
    attempts: 0,
  };
  if (create) await database.entities.add(entity);
  else await database.entities.put(entity);
  await database.outbox.add(operation);
}

export async function updateLocalNote(
  id: string,
  changes: Partial<Pick<LocalNote, "title" | "content">>,
  database = localDb,
  expectedRevision?: string | null,
) {
  if (changes.title !== undefined && !changes.title.trim()) throw new Error("A note title is required.");
  let conflict = false;
  const next = await database.transaction("rw", database.entities, database.outbox, database.conflicts, async () => {
    const note = (await database.entities.get(id)) as LocalNote | undefined;
    if (!note || note.kind !== "note" || note.deletedAt) throw new Error("Note not found.");
    if (expectedRevision !== undefined && note.revision !== expectedRevision) {
      const local = { ...note, ...changes, revision: expectedRevision, updatedAt: Date.now() };
      await database.conflicts.put({ id, local, remote: note, detectedAt: Date.now() });
      conflict = true;
      return local;
    }
    const updated = { ...note, ...changes, updatedAt: Date.now() };
    await queueInTransaction(updated, "update", changes, database);
    return updated;
  });
  if (conflict) {
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("papyr-sync-state", {
          detail: { state: "conflict", message: "A newer remote version needs review." },
        }),
      );
    throw new Error("A newer version arrived while you were editing. Your draft is in Conflicts.");
  }
  return next;
}

export async function renameLocalEntity(id: string, title: string, database = localDb) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("A title is required.");
  return database.transaction("rw", database.entities, database.outbox, async () => {
    const entity = await database.entities.get(id);
    if (!entity) throw new Error("Item not found.");
    const next = { ...entity, title: normalizedTitle, updatedAt: Date.now() } as LocalEntity;
    await queueInTransaction(next, "rename", { title: normalizedTitle }, database);
    return next;
  });
}

export async function moveLocalEntity(id: string, destinationId: string | null, database = localDb) {
  const entity = await database.entities.get(id);
  if (!entity) throw new Error("Item not found.");
  if (entity.kind === "folder") {
    if (destinationId && (await database.entities.get(destinationId))?.kind !== "folder")
      throw new Error("Destination folder not found.");
    let cursor = destinationId;
    while (cursor) {
      if (cursor === id) throw new Error("A folder cannot be moved into itself or its descendants.");
      const parent = await database.entities.get(cursor);
      cursor = parent?.kind === "folder" ? parent.parentId : null;
    }
  } else if (destinationId && (await database.entities.get(destinationId))?.kind !== "folder")
    throw new Error("Destination folder not found.");
  return database.transaction("rw", database.entities, database.outbox, async () => {
    const current = await database.entities.get(id);
    if (!current) throw new Error("Item not found.");
    const next =
      current.kind === "folder"
        ? { ...current, parentId: destinationId, updatedAt: Date.now() }
        : { ...current, folderId: destinationId, updatedAt: Date.now() };
    await queueInTransaction(
      next,
      "move",
      current.kind === "folder" ? { parentId: destinationId } : { folderId: destinationId },
      database,
    );
    return next;
  });
}

export async function setDeletedLocalEntity(id: string, deleted: boolean, database = localDb) {
  return database.transaction("rw", database.entities, database.outbox, async () => {
    const root = await database.entities.get(id);
    if (!root) throw new Error("Item not found.");
    if (Boolean(root.deletedAt) === deleted) return root;
    const all = await database.entities.toArray();
    const descendants = new Set<string>([id]);
    if (root.kind === "folder") {
      for (let changed = true; changed; ) {
        changed = false;
        for (const entity of all) {
          const parentId = entity.kind === "folder" ? entity.parentId : entity.folderId;
          if (parentId && descendants.has(parentId) && !descendants.has(entity.id)) {
            descendants.add(entity.id);
            changed = true;
          }
        }
      }
    }
    const affected = all.filter(
      (entity) =>
        descendants.has(entity.id) &&
        (entity.id === id || (deleted ? !entity.deletedAt : entity.deletedAt === root.deletedAt)),
    );
    const deletedAt = deleted ? Date.now() : null;
    let createdAt = Math.max(Date.now(), ((await database.outbox.orderBy("createdAt").last())?.createdAt ?? 0) + 1);
    for (const entity of affected) {
      const next = { ...entity, deletedAt, updatedAt: deletedAt ?? Date.now() } as LocalEntity;
      await database.entities.put(next);
      await database.outbox.add({
        operationId: createUuid(),
        entityType: entity.kind,
        entityId: entity.id,
        action: deleted ? "delete" : "restore",
        baseRevision: entity.revision,
        payload: { deletedAt },
        createdAt: createdAt++,
        attempts: 0,
      });
    }
    return { ...root, deletedAt, updatedAt: deletedAt ?? Date.now() } as LocalEntity;
  });
}

export async function listLocalNotes(database = localDb): Promise<LocalNote[]> {
  return ((await database.entities.where("kind").equals("note").sortBy("updatedAt")) as LocalNote[])
    .filter((note) => !note.deletedAt)
    .reverse();
}

export async function listLocalFolders(database = localDb): Promise<LocalFolder[]> {
  return ((await database.entities.where("kind").equals("folder").sortBy("createdAt")) as LocalFolder[]).filter(
    (folder) => !folder.deletedAt,
  );
}

export async function listLocalTrash(database = localDb): Promise<LocalEntity[]> {
  return database.entities.filter((entity) => entity.deletedAt !== null).toArray();
}

export async function clearLocalTrash(database = localDb) {
  return database.transaction("rw", database.entities, database.outbox, database.conflicts, async () => {
    const trash = (await database.entities.toArray()).filter((entity) => entity.deletedAt !== null);
    if (!trash.length) return 0;
    const ids = trash.map(({ id }) => id);
    if (
      trash.some((entity) => entity.revision === null) ||
      (await database.outbox.where("entityId").anyOf(ids).count()) > 0 ||
      (await database.conflicts.where("id").anyOf(ids).count()) > 0
    ) {
      throw new Error("TRASH_NOT_SYNCED");
    }

    const entities = new Map((await database.entities.toArray()).map((entity) => [entity.id, entity]));
    const depth = (entity: LocalEntity) => {
      let count = 0;
      let parentId = entity.kind === "folder" ? entity.parentId : entity.folderId;
      const seen = new Set([entity.id]);
      while (parentId && entities.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        count++;
        const parent = entities.get(parentId)!;
        parentId = parent.kind === "folder" ? parent.parentId : null;
      }
      return count;
    };
    let createdAt = Math.max(Date.now(), ((await database.outbox.orderBy("createdAt").last())?.createdAt ?? 0) + 1);
    for (const entity of [...trash].sort((left, right) => depth(right) - depth(left))) {
      await database.outbox.add({
        operationId: createUuid(),
        entityType: entity.kind,
        entityId: entity.id,
        action: "purge",
        baseRevision: entity.revision,
        payload: entity,
        createdAt: createdAt++,
        attempts: 0,
      });
    }
    await database.entities.bulkDelete(ids);
    return trash.length;
  });
}
