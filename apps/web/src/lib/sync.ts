import { createUuid } from "./uuid.js";
import { ApiError, api, createApi, type ServerChange, type ServerEntity } from "@/lib/api-client";
import { HubConnectionBuilder, HubConnectionState, type HubConnection } from "@microsoft/signalr";
import { retryTransient } from "@/lib/sync-retry";
import { safeErrorDetails } from "@/lib/network-diagnostics";
import {
  localDb,
  activateLocalAccount,
  acquireLocalLease,
  ownsLocalLease,
  renewLocalLease,
  releaseLocalLease,
  type LocalWriteLease,
  repairRejectedUnsyncedOperation,
  retryRejectedWhiteboardSnapshot,
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
let sessionEpoch = 0;
let channel: BroadcastChannel | undefined;
let channelAccount = "";
let rerunRequested = false;
let activeSync: Promise<SyncState> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let listenersInstalled = false;
let hubConnection: HubConnection | undefined;
let hubAccount = "";
let hubRetryTimer: ReturnType<typeof setTimeout> | undefined;
let hubRetryAttempt = 0;

function announce(state: SyncState, message: string) {
  console.info("[Papyr sync] state changed", { state });
  window.dispatchEvent(new CustomEvent("papyr-sync-state", { detail: { state, message } }));
}

export function setSyncAuthenticated(value: boolean) {
  console.info("[Papyr sync] authentication changed", { authenticated: value });
  if (authenticated !== value) sessionEpoch++;
  authenticated = value;
  connectBrowserChannel();
  if (value) {
    channel?.postMessage({ type: "SYNC_REQUESTED" });
    startChangeHub();
  } else {
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
  connectBrowserChannel();
  channel?.postMessage({ type: "SYNC_REQUESTED" });
  scheduleLocalSync(delay);
}

function scheduleLocalSync(delay = 5000) {
  console.debug("[Papyr sync] scheduled", { delayMs: delay });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void syncLocalLibrary();
  }, delay);
}

export function initializeSyncTriggers() {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  startChangeHub();
  connectBrowserChannel();
  window.addEventListener("papyr-account-change", () => {
    sessionEpoch++;
    if (timer) clearTimeout(timer);
    connectBrowserChannel();
  });
  window.addEventListener("papyr-local-commit", (event) => {
    const detail = (event as CustomEvent<{ database: string; id: string }>).detail;
    if (detail.database !== localDb.name) return;
    connectBrowserChannel();
    notifyLibraryChanged(detail.id);
    scheduleSync();
  });
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
  if (hubAccount !== localDb.name) {
    const previous = hubConnection;
    hubConnection = undefined;
    hubAccount = localDb.name;
    void previous?.stop();
  }
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
  if (!authenticated && localDb.name.startsWith("papyr-account-")) {
    const cachedDatabase = localDb;
    const epoch = sessionEpoch;
    try {
      const session = await api.me();
      if (localDb !== cachedDatabase || sessionEpoch !== epoch) return "idle";
      await activateLocalAccount(session.id, session.isAdmin);
      setSyncAuthenticated(true);
    } catch (error) {
      if (localDb !== cachedDatabase || sessionEpoch !== epoch) return "idle";
      if (error instanceof ApiError && error.status === 401) await activateLocalAccount(null);
      else {
        announce("offline", "Server unavailable · local changes remain saved.");
        return "offline";
      }
    }
  }
  if (!authenticated) {
    announce("authRequired", "Sign in to sync. Local changes remain saved.");
    return "authRequired";
  }
  if (activeSync) {
    console.info("[Papyr sync] joining existing attempt");
    rerunRequested = true;
    return activeSync;
  }
  connectBrowserChannel();
  const database = localDb;
  const epoch = sessionEpoch;
  const attempt = withSyncLock(database, epoch)
    .catch((error) => {
      console.error("[Papyr sync] coordination failed", safeErrorDetails(error));
      announce("error", "Sync coordination failed. Local changes remain saved.");
      return "error" as const;
    })
    .finally(() => {
      console.info("[Papyr sync] attempt finished");
      if (activeSync === attempt) activeSync = undefined;
      if (authenticated && (rerunRequested || database !== localDb || epoch !== sessionEpoch)) scheduleLocalSync(100);
      rerunRequested = false;
    });
  activeSync = attempt;
  return attempt;
}

class LeaseLostError extends Error {}

async function runScopedSync(database: typeof localDb, epoch: number, lease: LocalWriteLease): Promise<SyncState> {
  const client = createApi(database.name.replace(/^papyr-account-/, ""));
  const deadline = Date.now() + 10_000;
  const assertCurrent = async () => {
    if (!authenticated || localDb !== database || epoch !== sessionEpoch || !(await ownsLocalLease(lease, database)))
      throw new LeaseLostError();
  };
  const requestRemote = <T>(work: () => Promise<T>) =>
    retryTransient(async () => {
      await assertCurrent();
      const result = await work();
      await assertCurrent();
      return result;
    });
  const transaction = async <T>(tables: string[], work: () => Promise<T>): Promise<T> =>
    database.transaction("rw", [...tables, "syncMeta"], async () => {
      await assertCurrent();
      return work();
    });
  const saveConflict = (conflict: LocalConflict) =>
    transaction(["conflicts"], async () => {
      await database.conflicts.put(conflict);
    });
  async function runSync(): Promise<SyncState> {
    announce("syncing", "Syncing local changes…");
    try {
      const session = await requestRemote(() => client.me());
      if (`papyr-account-${session.id}` !== database.name)
        throw new ApiError("Account changed. Sign in again.", 409, "ACCOUNT_CHANGED");
      console.info("[Papyr sync] outbox before sync", { pendingOperations: await database.outbox.count() });
      console.info("[Papyr sync] pulling remote changes");
      await pullChanges();
      if (Date.now() >= deadline) {
        scheduleLocalSync(100);
        return "waiting";
      }
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
      if (await database.outbox.count()) {
        scheduleLocalSync(100);
        announce("waiting", "Local changes are queued for the next sync pass.");
        return "waiting";
      }
      announce("synced", "Synced to server.");
      return "synced";
    } catch (error) {
      if (localDb !== database || epoch !== sessionEpoch) return "idle";
      console.error("[Papyr sync] attempt failed", safeErrorDetails(error));
      if (error instanceof LeaseLostError) {
        scheduleLocalSync(100);
        announce("waiting", "Waiting for another tab to finish syncing.");
        return "waiting";
      }
      if (error instanceof ApiError && (error.status === 401 || error.code === "ACCOUNT_CHANGED")) {
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
        let response = await requestRemote(() => client.bootstrap(meta.bootstrapToken));
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
          if (Date.now() >= deadline) return;
          response = await requestRemote(() => client.bootstrap(response.nextCursorToken));
        }
      }
      meta = await syncMeta();
      if (!meta.cursor) return;
      while (meta.cursor) {
        const page = await requestRemote(() => client.changes(meta.cursor!));
        await cacheRemoteAssets(page.changes.map((change) => change.entity));
        await transaction(["entities", "outbox", "conflicts", "syncMeta"], async () => {
          const currentMeta = (await database.syncMeta.get("state")) ?? blankMeta();
          for (const change of page.changes) await applyChange(change, currentMeta);
          await database.syncMeta.put({ ...currentMeta, cursor: page.nextCursor, updatedAt: Date.now() });
        });
        for (const change of page.changes) announceEntityUpdated(change.entityId);
        meta = await syncMeta();
        if (!page.hasMore) break;
        if (Date.now() >= deadline) return;
      }
    } catch (error) {
      if (rebased || !(error instanceof ApiError) || error.code !== "CURSOR_EXPIRED") throw error;
      const current = await syncMeta();
      await transaction(["syncMeta"], async () => {
        await database.syncMeta.put({ ...current, cursor: null, bootstrapToken: null, updatedAt: Date.now() });
      });
      await pullChanges(true);
    }
  }

  async function applyRemoteEntities(entities: ServerEntity[], saveMeta: (database: typeof localDb) => Promise<void>) {
    await transaction(["entities", "outbox", "conflicts", "syncMeta"], async () => {
      for (const remote of entities) await applyRemote(remote);
      await saveMeta(database);
    });
    for (const entity of entities) announceEntityUpdated(entity.id);
  }

  async function applyChange(change: ServerChange, meta: LocalSyncMeta) {
    const pending = await database.outbox.where("entityId").equals(change.entityId).toArray();
    const current = await database.entities.get(change.entityId);
    if (
      pending.some((operation) => operation.operationId === change.operationId) ||
      meta.acceptedOperationIds.includes(change.operationId)
    ) {
      if (current) {
        current.revision = change.revision;
        await database.entities.put(current);
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
        if (cascaded) await database.outbox.delete(cascaded.operationId);
        await rebaseNextOperation(change.entityId, change.revision);
      }
      return;
    }
    if (change.action === "purge") {
      const existingConflict = await database.conflicts.get(change.entityId);
      if (pending.length || existingConflict) {
        const pendingPurge = pending.find((operation) => operation.action === "purge");
        const local = existingConflict?.local ?? current ?? (pendingPurge?.payload as LocalEntity | undefined);
        if (local)
          await saveConflict({
            id: change.entityId,
            local,
            remote: fromServer(change.entity),
            detectedAt: Date.now(),
            remotePurged: true,
          });
      } else await database.entities.delete(change.entityId);
      return;
    }
    if (pending.length && current && current.revision !== change.revision) {
      await saveConflict({
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
    const pending = await database.outbox.where("entityId").equals(remote.id).count();
    const current = await database.entities.get(remote.id);
    if (pending > 0 && current) {
      await saveConflict({ id: remote.id, local: current, remote: local, detectedAt: Date.now() });
      return;
    }
    await database.entities.put(local);
  }

  async function pushOutbox(): Promise<SyncState> {
    await uploadReferencedAssets();
    const blocked = new Set((await database.conflicts.toArray()).map((conflict) => conflict.id));
    const operations = await database.outbox.orderBy("createdAt").toArray();
    for (const operation of operations) {
      if (Date.now() >= deadline) {
        scheduleLocalSync(100);
        return "waiting";
      }
      if (blocked.has(operation.entityId)) continue;
      const current = await database.outbox.get(operation.operationId);
      if (!current) continue;
      const { results } = await requestRemote(() => client.mutations([wireOperation(current)]));
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
        const remote = await requestRemote(() => client.entity(operation.entityType, operation.entityId));
        const current = await database.entities.get(operation.entityId);
        const local = current ?? (operation.action === "purge" ? (operation.payload as LocalEntity) : undefined);
        if (local)
          await saveConflict({
            id: operation.entityId,
            local,
            remote: fromServer(remote),
            detectedAt: Date.now(),
            purgePending: operation.action === "purge",
          });
        blocked.add(operation.entityId);
      } else if (result.status === "rejected" && operation.action === "purge" && result.error?.code === "NOT_DELETED") {
        const remote = await requestRemote(() => client.entity(operation.entityType, operation.entityId));
        await saveConflict({
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
        const remote = await requestRemote(() => client.entity(operation.entityType, operation.entityId));
        await saveConflict({
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
        (await transaction(["entities", "outbox"], async () =>
          repairRejectedUnsyncedOperation(operation.operationId, database),
        ))
      ) {
        console.warn("[Papyr sync] repairing missing create before unsynced delete", {
          entityId: operation.entityId,
          operationId: operation.operationId,
        });
        return pushOutbox();
      } else if (
        result.status === "rejected" &&
        result.error?.code === "INVALID_CONTENT" &&
        (await transaction(["entities", "outbox"], async () =>
          retryRejectedWhiteboardSnapshot(operation.operationId, database),
        ))
      ) {
        console.warn("[Papyr sync] retrying previously rejected whiteboard schema with a fresh operation ID", {
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
      if (await database.assets.get(id)) continue;
      const { blob, sha256: expectedHash } = await requestRemote(() => client.downloadAsset(id));
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
      await transaction(["assets"], async () => {
        await database.assets.put(asset);
      });
    }
  }

  async function uploadReferencedAssets() {
    const pending = await database.outbox.toArray();
    const entities = (await Promise.all(pending.map((operation) => database.entities.get(operation.entityId)))).filter(
      (entity): entity is LocalEntity => entity?.kind === "note",
    );
    for (const id of referencedAssetIds(entities)) {
      const asset = await database.assets.get(id);
      if (!asset || asset.state === "uploaded") continue;
      const receipt = await requestRemote(() => client.uploadAsset(asset));
      if (receipt.id !== asset.id || receipt.sha256 !== asset.sha256 || receipt.byteLength !== asset.byteLength)
        throw new Error("The attachment server returned a mismatched receipt.");
      await transaction(["assets"], async () => {
        await database.assets.put({ ...asset, state: "uploaded" });
      });
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
    await transaction(["entities", "outbox", "syncMeta"], async () => {
      const entity = await database.entities.get(entityId);
      if (entity) {
        entity.revision = revision;
        await database.entities.put(entity);
      }
      await database.outbox.delete(operationId);
      await rebaseNextOperation(entityId, revision);
      const meta = suppliedMeta ?? (await database.syncMeta.get("state")) ?? blankMeta();
      const acceptedOperationIds = [...meta.acceptedOperationIds.filter((id) => id !== operationId), operationId].slice(
        -1000,
      );
      await database.syncMeta.put({ ...meta, acceptedOperationIds, updatedAt: Date.now() });
    });
    announceEntityUpdated(entityId);
  }

  function announceEntityUpdated(id: string) {
    notifyLibraryChanged(id);
  }

  async function rebaseNextOperation(entityId: string, revision: string) {
    const pending = await database.outbox.where("entityId").equals(entityId).sortBy("createdAt");
    if (!pending.length) return;
    const next = pending[0];
    next.baseRevision = revision;
    await database.outbox.put(next);
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
    return (await database.syncMeta.get("state")) ?? blankMeta();
  }

  function blankMeta(): LocalSyncMeta {
    return { id: "state", cursor: null, bootstrapToken: null, acceptedOperationIds: [], updatedAt: Date.now() };
  }

  return runSync();
}

async function withSyncLock(database: typeof localDb, epoch: number): Promise<SyncState> {
  const work = async (): Promise<SyncState> => {
    if (localDb !== database || epoch !== sessionEpoch || !authenticated) return "idle";
    const lease = { id: "state", owner: createUuid() };
    console.info("[Papyr sync] acquiring IndexedDB lease");
    if (!(await acquireLocalLease(lease.id, lease.owner, database))) {
      const current = await database.syncMeta.get(lease.id);
      console.warn("[Papyr sync] deferred: another tab holds the IndexedDB lease", {
        remainingMs: Math.max(0, (current?.lockExpiresAt ?? 0) - Date.now()),
        retryDelayMs: 1000,
      });
      announce("waiting", "Waiting for another tab to finish syncing.");
      scheduleLocalSync(1000);
      return "waiting";
    }
    console.info("[Papyr sync] IndexedDB lease acquired");
    const heartbeat = setInterval(() => {
      void renewLocalLease(lease, database)
        .then((renewed) => console.debug("[Papyr sync] lease heartbeat finished", { renewed }))
        .catch((error) => console.error("[Papyr sync] lock heartbeat failed", safeErrorDetails(error)));
    }, 10_000);
    try {
      return await runScopedSync(database, epoch, lease);
    } finally {
      clearInterval(heartbeat);
      const released = await releaseLocalLease(lease, database);
      console.info("[Papyr sync] IndexedDB lease release finished", { released });
      if (localDb === database) channel?.postMessage({ type: "SYNC_RELEASED" });
    }
  };
  if (navigator.locks) {
    return navigator.locks.request(
      `papyr-sync:${database.name}`,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        // A suspended tab may retain a Web Lock; the fenced lease decides ownership.
        if (!lock) console.debug("[Papyr sync] browser lock busy; checking the durable lease");
        return work();
      },
    );
  }
  return work();
}

function connectBrowserChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  if (channelAccount === localDb.name) return;
  channel?.close();
  channelAccount = localDb.name;
  const database = localDb;
  channel = new BroadcastChannel(`papyr-sync:${database.name}`);
  channel.onmessage = (event) => {
    if (localDb !== database) return;
    if (event.data?.type === "LIBRARY_CHANGED" && typeof event.data.id === "string") {
      window.dispatchEvent(new CustomEvent("papyr-entity-updated", { detail: { id: event.data.id } }));
      window.dispatchEvent(new Event("papyr-library-changed"));
    }
    if (event.data?.type === "SYNC_REQUESTED" && authenticated) {
      if (activeSync) rerunRequested = true;
      else scheduleLocalSync();
    }
    if (event.data?.type === "SYNC_RELEASED" && timer && !activeSync) scheduleLocalSync(100);
  };
  if (authenticated) channel.postMessage({ type: "SYNC_REQUESTED" });
}

function notifyLibraryChanged(id: string) {
  window.dispatchEvent(new CustomEvent("papyr-entity-updated", { detail: { id } }));
  window.dispatchEvent(new Event("papyr-library-changed"));
  channel?.postMessage({ type: "LIBRARY_CHANGED", id });
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
