import { createUuid } from "./uuid.js";
import { ApiError, api, type ServerChange, type ServerEntity } from "@/lib/api-client";
import { HubConnectionBuilder, HubConnectionState, type HubConnection } from "@microsoft/signalr";
import { retryTransient } from "@/lib/sync-retry";
import { safeErrorDetails } from "@/lib/network-diagnostics";
import {
  localDb,
  releaseLocalSyncLock,
  repairRejectedUnsyncedOperation,
  resolveLocalConflict,
  type LocalConflict,
  type LocalEntity,
  type LocalFolder,
  type LocalNote,
  type LocalOperation,
  type LocalSyncMeta,
  type LocalAsset,
} from "@/lib/local-db";

export type SyncState = "idle" | "waiting" | "syncing" | "synced" | "offline" | "authRequired" | "conflict" | "error";

let authenticated = false;
let activeSync: Promise<SyncState> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let listenersInstalled = false;
let hubConnection: HubConnection | undefined;
let hubRetryTimer: ReturnType<typeof setTimeout> | undefined;
let hubRetryAttempt = 0;

function announce(state: SyncState, message: string) {
  console.info("[Papyr sync] state changed", { state });
  window.dispatchEvent(new CustomEvent("papyr-sync-state", { detail: { state, message } }));
}

export function setSyncAuthenticated(value: boolean) {
  console.info("[Papyr sync] authentication changed", { authenticated: value });
  authenticated = value;
  if (value) startChangeHub();
  else {
    if (hubRetryTimer) clearTimeout(hubRetryTimer);
    hubRetryTimer = undefined;
    void hubConnection?.stop();
  }
}

export function scheduleSync(delay = 5000) {
  if (!authenticated || typeof window === "undefined") {
    console.info("[Papyr sync] scheduling skipped", { authenticated, browser: typeof window !== "undefined" });
    return;
  }
  console.debug("[Papyr sync] scheduled", { delayMs: delay });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncLocalLibrary(), delay);
}

export function initializeSyncTriggers() {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  startChangeHub();
  window.addEventListener("online", () => void syncLocalLibrary());
  window.addEventListener("focus", () => void syncLocalLibrary());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncLocalLibrary();
    else scheduleSync(0);
  });
  window.addEventListener("pagehide", () => scheduleSync(0));
}

function startChangeHub() {
  if (!authenticated || typeof window === "undefined") return;
  if (!hubConnection) {
    hubConnection = new HubConnectionBuilder().withUrl("/hubs/changes").withAutomaticReconnect().build();
    hubConnection.on("invalidate", () => void syncLocalLibrary());
    hubConnection.onreconnected(() => void syncLocalLibrary());
    hubConnection.onclose(handleHubClose);
  }
  if (hubConnection.state !== HubConnectionState.Disconnected || hubRetryTimer) return;
  void hubConnection
    .start()
    .then(() => {
      hubRetryAttempt = 0;
    })
    .catch(handleHubClose);
}

function handleHubClose(error?: Error) {
  console.warn("[Papyr sync] change notification connection closed", safeErrorDetails(error));
  if (error && /(?:401|403|unauthorized|forbidden)/i.test(error.message)) {
    void syncLocalLibrary();
    return;
  }
  scheduleHubRetry();
}

function scheduleHubRetry() {
  if (!authenticated || hubRetryTimer) return;
  const delay = Math.min(60_000, 2_000 * 2 ** Math.min(hubRetryAttempt++, 5)) + Math.random() * 1_000;
  hubRetryTimer = setTimeout(() => {
    hubRetryTimer = undefined;
    startChangeHub();
  }, delay);
}

export async function syncLocalLibrary(): Promise<SyncState> {
  console.info("[Papyr sync] attempt requested", {
    authenticated,
    online: navigator.onLine,
    alreadyRunning: Boolean(activeSync),
  });
  if (!navigator.onLine) {
    announce("offline", "Offline · local edits remain saved here.");
    return "offline";
  }
  if (!authenticated) {
    announce("authRequired", "Sign in to sync. Local changes remain saved.");
    return "authRequired";
  }
  if (activeSync) {
    console.info("[Papyr sync] joining existing attempt");
    return activeSync;
  }
  activeSync = withSyncLock(runSync)
    .catch((error) => {
      console.error("[Papyr sync] coordination failed", safeErrorDetails(error));
      announce("error", "Sync coordination failed. Local changes remain saved.");
      return "error" as const;
    })
    .finally(() => {
      console.info("[Papyr sync] attempt finished");
      activeSync = undefined;
    });
  return activeSync;
}

async function runSync(): Promise<SyncState> {
  announce("syncing", "Syncing local changes…");
  try {
    await retryTransient(() => api.me());
    console.info("[Papyr sync] outbox before sync", { pendingOperations: await localDb.outbox.count() });
    console.info("[Papyr sync] pulling remote changes");
    await pullChanges();
    console.info("[Papyr sync] uploading pending operations");
    const state = await pushOutbox();
    if (state === "conflict") {
      announce(state, "Some changes need conflict resolution.");
      return state;
    }
    if (state === "error") {
      announce(state, "Sync failed. Local changes are still queued.");
      return state;
    }
    announce("synced", "Synced to server.");
    return "synced";
  } catch (error) {
    console.error("[Papyr sync] attempt failed", safeErrorDetails(error));
    if (error instanceof ApiError && error.status === 401) {
      setSyncAuthenticated(false);
      announce("authRequired", "Sign in to sync. Local changes remain saved.");
      return "authRequired";
    }
    if (!navigator.onLine || error instanceof TypeError) {
      announce("offline", "Server unavailable · local changes remain saved.");
      return "offline";
    }
    announce("error", "Sync failed. Local changes are still queued.");
    return "error";
  }
}

async function pullChanges(rebased = false) {
  try {
    let meta = await syncMeta();
    if (!meta.cursor) {
      let response = await retryTransient(() => api.bootstrap(meta.bootstrapToken));
      while (true) {
        const lastPage = !response.nextCursorToken;
        await cacheRemoteAssets([...response.folders, ...response.notes]);
        await applyRemoteEntities([...response.folders, ...response.notes], async (database) => {
          const current = (await database.syncMeta.get("state")) ?? blankMeta();
          await database.syncMeta.put({
            ...current,
            bootstrapToken: response.nextCursorToken ?? null,
            cursor: lastPage ? (response.cursor ?? null) : null,
            updatedAt: Date.now(),
          });
        });
        if (lastPage) break;
        response = await retryTransient(() => api.bootstrap(response.nextCursorToken));
      }
    }
    meta = await syncMeta();
    if (!meta.cursor) return;
    while (meta.cursor) {
      const page = await retryTransient(() => api.changes(meta.cursor!));
      await cacheRemoteAssets(page.changes.map((change) => change.entity));
      await localDb.transaction(
        "rw",
        localDb.entities,
        localDb.outbox,
        localDb.conflicts,
        localDb.syncMeta,
        async () => {
          const currentMeta = (await localDb.syncMeta.get("state")) ?? blankMeta();
          for (const change of page.changes) await applyChange(change, currentMeta);
          await localDb.syncMeta.put({ ...currentMeta, cursor: page.nextCursor, updatedAt: Date.now() });
        },
      );
      for (const change of page.changes) announceEntityUpdated(change.entityId);
      meta = await syncMeta();
      if (!page.hasMore) break;
    }
  } catch (error) {
    if (rebased || !(error instanceof ApiError) || error.code !== "CURSOR_EXPIRED") throw error;
    const current = await syncMeta();
    await localDb.syncMeta.put({ ...current, cursor: null, bootstrapToken: null, updatedAt: Date.now() });
    await pullChanges(true);
  }
}

async function applyRemoteEntities(entities: ServerEntity[], saveMeta: (database: typeof localDb) => Promise<void>) {
  await localDb.transaction("rw", localDb.entities, localDb.outbox, localDb.conflicts, localDb.syncMeta, async () => {
    for (const remote of entities) await applyRemote(remote);
    await saveMeta(localDb);
  });
  for (const entity of entities) announceEntityUpdated(entity.id);
}

async function applyChange(change: ServerChange, meta: LocalSyncMeta) {
  const pending = await localDb.outbox.where("entityId").equals(change.entityId).toArray();
  const current = await localDb.entities.get(change.entityId);
  if (
    pending.some((operation) => operation.operationId === change.operationId) ||
    meta.acceptedOperationIds.includes(change.operationId)
  ) {
    if (current) {
      current.revision = change.revision;
      await localDb.entities.put(current);
    }
    if (pending.some((operation) => operation.operationId === change.operationId))
      await acknowledge(change.operationId, change.entityId, change.revision, meta);
    else {
      const cascaded = pending.find(
        (operation) =>
          operation.action === change.action &&
          (change.action === "delete" || change.action === "restore") &&
          current &&
          (change.action === "delete" ? current.deletedAt !== null : current.deletedAt === null),
      );
      if (cascaded) await localDb.outbox.delete(cascaded.operationId);
      await rebaseNextOperation(change.entityId, change.revision);
    }
    return;
  }
  if (change.action === "purge") {
    const existingConflict = await localDb.conflicts.get(change.entityId);
    if (pending.length || existingConflict) {
      const pendingPurge = pending.find((operation) => operation.action === "purge");
      const local = existingConflict?.local ?? current ?? (pendingPurge?.payload as LocalEntity | undefined);
      if (local)
        await localDb.conflicts.put({
          id: change.entityId,
          local,
          remote: fromServer(change.entity),
          detectedAt: Date.now(),
          remotePurged: true,
        });
    } else await localDb.entities.delete(change.entityId);
    return;
  }
  if (pending.length && current && current.revision !== change.revision) {
    await localDb.conflicts.put({
      id: change.entityId,
      local: current,
      remote: fromServer(change.entity),
      detectedAt: Date.now(),
    });
    return;
  }
  await applyRemote(change.entity);
}

async function applyRemote(remote: ServerEntity) {
  const local = fromServer(remote);
  const pending = await localDb.outbox.where("entityId").equals(remote.id).count();
  const current = await localDb.entities.get(remote.id);
  if (pending > 0 && current) {
    await localDb.conflicts.put({ id: remote.id, local: current, remote: local, detectedAt: Date.now() });
    return;
  }
  await localDb.entities.put(local);
}

async function pushOutbox(): Promise<SyncState> {
  await uploadReferencedAssets();
  const blocked = new Set((await localDb.conflicts.toArray()).map((conflict) => conflict.id));
  const operations = await localDb.outbox.orderBy("createdAt").toArray();
  for (const operation of operations) {
    if (blocked.has(operation.entityId)) continue;
    const current = await localDb.outbox.get(operation.operationId);
    if (!current) continue;
    const { results } = await retryTransient(() => api.mutations([wireOperation(current)]));
    const result = results[0];
    console.info("[Papyr sync] mutation receipt", {
      operationId: operation.operationId,
      entityId: operation.entityId,
      action: operation.action,
      baseRevision: current.baseRevision,
      status: result.status,
      revision: result.revision,
      code: result.error?.code,
    });
    if (result.status === "accepted" || result.status === "duplicate") {
      if (result.revision) await acknowledge(operation.operationId, operation.entityId, result.revision);
    } else if (result.status === "conflict") {
      const remote = await retryTransient(() => api.entity(operation.entityType, operation.entityId));
      const current = await localDb.entities.get(operation.entityId);
      const local = current ?? (operation.action === "purge" ? (operation.payload as LocalEntity) : undefined);
      if (local)
        await localDb.conflicts.put({
          id: operation.entityId,
          local,
          remote: fromServer(remote),
          detectedAt: Date.now(),
          purgePending: operation.action === "purge",
        });
      blocked.add(operation.entityId);
    } else if (result.status === "rejected" && operation.action === "purge" && result.error?.code === "NOT_DELETED") {
      const remote = await retryTransient(() => api.entity(operation.entityType, operation.entityId));
      await localDb.conflicts.put({
        id: operation.entityId,
        local: operation.payload as LocalEntity,
        remote: fromServer(remote),
        detectedAt: Date.now(),
        purgePending: true,
      });
      blocked.add(operation.entityId);
    } else if (
      result.status === "rejected" &&
      operation.action === "purge" &&
      result.error?.code === "FOLDER_NOT_EMPTY"
    ) {
      const remote = await retryTransient(() => api.entity(operation.entityType, operation.entityId));
      await localDb.conflicts.put({
        id: operation.entityId,
        local: operation.payload as LocalEntity,
        remote: fromServer(remote),
        detectedAt: Date.now(),
        purgePending: true,
      });
      blocked.add(operation.entityId);
    } else if (
      result.status === "rejected" &&
      result.error?.code === "NOT_FOUND" &&
      (await repairRejectedUnsyncedOperation(operation.operationId))
    ) {
      console.warn("[Papyr sync] repairing missing create before unsynced delete", {
        entityId: operation.entityId,
        operationId: operation.operationId,
      });
      return pushOutbox();
    } else {
      console.error("[Papyr sync] mutation blocked; operation remains queued", {
        operationId: operation.operationId,
        entityId: operation.entityId,
        status: result.status,
        code: result.error?.code,
      });
      return "error";
    }
  }
  return blocked.size ? "conflict" : "synced";
}

const assetReferencePattern = /(?:papyr-asset:\/\/|https:\/\/papyr\.invalid\/papyr-assets\/)([0-9a-f-]{36})/gi;

function referencedAssetIds(entities: Array<{ kind: string; content?: unknown }>) {
  const ids = new Set<string>();
  for (const entity of entities) {
    if (entity.kind !== "note" || entity.content == null) continue;
    const content = typeof entity.content === "string" ? entity.content : JSON.stringify(entity.content);
    for (const match of content.matchAll(assetReferencePattern)) ids.add(match[1]);
  }
  return ids;
}

async function cacheRemoteAssets(entities: ServerEntity[]) {
  for (const id of referencedAssetIds(entities)) {
    if (await localDb.assets.get(id)) continue;
    const { blob, sha256: expectedHash } = await retryTransient(() => api.downloadAsset(id));
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (sha256 !== expectedHash) throw new Error("Downloaded attachment failed its integrity check.");
    const asset: LocalAsset = {
      id,
      blob,
      sha256,
      mimeType: blob.type,
      byteLength: blob.size,
      state: "uploaded",
      createdAt: Date.now(),
    };
    await localDb.assets.put(asset);
  }
}

async function uploadReferencedAssets() {
  const pending = await localDb.outbox.toArray();
  const entities = (await Promise.all(pending.map((operation) => localDb.entities.get(operation.entityId)))).filter(
    (entity): entity is LocalEntity => entity?.kind === "note",
  );
  for (const id of referencedAssetIds(entities)) {
    const asset = await localDb.assets.get(id);
    if (!asset || asset.state === "uploaded") continue;
    const receipt = await retryTransient(() => api.uploadAsset(asset));
    if (receipt.id !== asset.id || receipt.sha256 !== asset.sha256 || receipt.byteLength !== asset.byteLength)
      throw new Error("The attachment server returned a mismatched receipt.");
    await localDb.assets.put({ ...asset, state: "uploaded" });
  }
}

function wireOperation(operation: LocalOperation) {
  return {
    operationId: operation.operationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    action: operation.action,
    baseRevision: operation.baseRevision,
    payload: operation.payload,
  };
}

async function acknowledge(operationId: string, entityId: string, revision: string, suppliedMeta?: LocalSyncMeta) {
  await localDb.transaction("rw", localDb.entities, localDb.outbox, localDb.syncMeta, async () => {
    const entity = await localDb.entities.get(entityId);
    if (entity) {
      entity.revision = revision;
      await localDb.entities.put(entity);
    }
    await localDb.outbox.delete(operationId);
    await rebaseNextOperation(entityId, revision);
    const meta = suppliedMeta ?? (await localDb.syncMeta.get("state")) ?? blankMeta();
    const acceptedOperationIds = [...meta.acceptedOperationIds.filter((id) => id !== operationId), operationId].slice(
      -1000,
    );
    await localDb.syncMeta.put({ ...meta, acceptedOperationIds, updatedAt: Date.now() });
  });
  announceEntityUpdated(entityId);
}

function announceEntityUpdated(id: string) {
  window.dispatchEvent(new CustomEvent("papyr-entity-updated", { detail: { id } }));
}

async function rebaseNextOperation(entityId: string, revision: string) {
  const pending = await localDb.outbox.where("entityId").equals(entityId).sortBy("createdAt");
  if (!pending.length) return;
  const next = pending[0];
  next.baseRevision = revision;
  await localDb.outbox.put(next);
}

function fromServer(entity: ServerEntity): LocalEntity {
  const common = {
    id: entity.id,
    title: entity.title,
    revision: entity.revision,
    deletedAt: entity.deletedAt ? Date.parse(entity.deletedAt) : null,
    createdAt: Date.parse(entity.createdAt),
    updatedAt: Date.parse(entity.updatedAt),
  };
  if (entity.kind === "folder")
    return { ...common, kind: "folder", parentId: entity.parentId ?? null } satisfies LocalFolder;
  return {
    ...common,
    kind: "note",
    folderId: entity.folderId ?? null,
    type: entity.type ?? "markdown",
    content: entity.content ?? (entity.type === "whiteboard" ? null : ""),
    contentSchemaVersion: entity.contentSchemaVersion ?? null,
  } satisfies LocalNote;
}

async function syncMeta(): Promise<LocalSyncMeta> {
  return (await localDb.syncMeta.get("state")) ?? blankMeta();
}

function blankMeta(): LocalSyncMeta {
  return { id: "state", cursor: null, bootstrapToken: null, acceptedOperationIds: [], updatedAt: Date.now() };
}

async function withSyncLock(work: () => Promise<SyncState>): Promise<SyncState> {
  if (navigator.locks) {
    console.info("[Papyr sync] waiting for browser lock");
    return navigator.locks.request("papyr-sync", { mode: "exclusive" }, async () => {
      console.info("[Papyr sync] browser lock acquired");
      try {
        return await work();
      } finally {
        console.info("[Papyr sync] browser lock released");
      }
    });
  }
  console.info("[Papyr sync] acquiring IndexedDB lock");
  const database = localDb;
  let retryDelay = 5000;
  const lockId = createUuid();
  const acquired = await database.transaction("rw", database.syncMeta, async () => {
    const state = (await database.syncMeta.get("state")) ?? blankMeta();
    if (state.lockExpiresAt && state.lockExpiresAt > Date.now()) {
      retryDelay = Math.min(5000, Math.max(100, state.lockExpiresAt - Date.now() + 50));
      console.warn("[Papyr sync] deferred: another tab holds the IndexedDB lock", {
        expiresAt: new Date(state.lockExpiresAt).toISOString(),
        retryDelayMs: retryDelay,
      });
      return false;
    }
    await database.syncMeta.put({ ...state, lockOwner: lockId, lockExpiresAt: Date.now() + 300_000 });
    return true;
  });
  if (!acquired) {
    announce("waiting", "Waiting for another tab to finish syncing.");
    scheduleSync(retryDelay);
    return "waiting";
  }
  console.info("[Papyr sync] IndexedDB lock acquired");
  const heartbeat = setInterval(() => {
    void database
      .transaction("rw", database.syncMeta, async () => {
        const current = await database.syncMeta.get("state");
        if (current?.lockOwner === lockId) {
          await database.syncMeta.put({ ...current, lockExpiresAt: Date.now() + 300_000 });
        }
      })
      .catch((error) => console.error("[Papyr sync] lock heartbeat failed", safeErrorDetails(error)));
  }, 30_000);
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    if (await releaseLocalSyncLock(lockId, database)) {
      console.info("[Papyr sync] IndexedDB lock released");
    }
  }
}

export async function localConflicts() {
  return localDb.conflicts.toArray();
}

export async function resolveConflict(
  conflict: LocalConflict,
  action: "remote" | "copy" | "overwrite",
  copySuffix?: string,
) {
  await resolveLocalConflict(conflict, action, copySuffix);
  scheduleSync(0);
}
