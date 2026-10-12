# SYNC.md — local-first synchronization contract

**Priority:** protecting local work is more important than appearing instantly synced. No last-write-wins, no silent remote replacement, no request that assumes exit handlers always fire.

## 1. Persistence and state machine

Each note may be in one or more states: `editing`, `savingLocal`, `savedLocalPending`, `syncing`, `synced`, `offline`, `conflict`, `syncError`, `quotaError`. Network offline is orthogonal to local-save status. UI must never equate **Saved locally** with **Synced to server**.

When an editor changes, write its latest content and corresponding pending mutation to IndexedDB. Coalesce frequent keystrokes/pen strokes into versioned local commits (e.g., debounce ~150–300 ms); show saving state until persistence is complete. A local save is acknowledged only after storage success. When IndexedDB fails or quota is exhausted, visibly block false success and offer safe export/recovery of unsaved in-memory content.

## 2. Sync triggers

- Launch/foreground after local DB is ready and session is valid.
- Approximately **five seconds after last edit** (debounced; configurable).
- When leaving/switching/closing a note, after ensuring its latest state was saved locally.
- On `online` event or successful network health recheck; network status alone does not guarantee reachability.
- On a SignalR invalidation event while connected, followed by REST pull.
- Manual **Sync now**.
- On `visibilitychange` to hidden/pagehide: best-effort send **only already locally persisted** lightweight work; do not depend on this for correctness.

Do not keep retrying in a tight loop. Use exponential backoff with jitter; stop/requires user action on auth errors. Avoid battery-draining periodic work in the background.

## 3. Outbox semantics

- Every mutation has a client-created UUID `operationId` and `baseRevision` of the server entity snapshot on which it is based.
- Retries **must reuse** the same operation ID; server returns same receipt for duplicates.
- For a note with multiple unsent edits, coalesce to the latest locally saved snapshot **before submission**. Never reuse an operation ID for a different payload once sent or possibly sent.
- New edits made while an update is in flight get a new local generation/new queued operation; an older acknowledgment must not clear them. When that earlier **own** operation is accepted, update the baseline revision of dependent, not-yet-submitted local generations to the accepted revision; this is not permission to auto-merge unrelated remote edits.
- Respect dependencies: create parent folder → create child note → upload attachment → publish note reference. If an op is blocked by conflict, independent ops may continue.
- Acknowledge/delete an outbox entry only after a definitive receipt from server; `timeout` means **unknown**, so retry same ID.
- Offline deletion uses tombstones and durable outbox entries.

## 4. Client algorithm

```text
On local edit:
  persist latest entity snapshot and outbox entry in one IDB transaction
  mark savedLocalPending after commit
  schedule nonblocking sync

On sync:
  acquire per-account sync coordination lock (tab-safe)
  ensure authenticated; if not, keep outbox
  fetch remote changes since last successfully applied cursor
  for each remote change, apply to clean entities
  if a dirty entity receives a change from an acknowledged own operation,
    advance its remote baseline without overwriting newer local content
  otherwise preserve the dirty local entity and create/update explicit conflict
  atomically persist applied changes and new cursor in IndexedDB
  upload required assets, then submit ready outbox mutations with stable IDs
  for each receipt:
    accepted/duplicate -> update server baseline; remove exact confirmed operation
    rebase any newer local generation onto that own acknowledged revision
    conflict -> keep payload, block only affected entity; offer resolution
    validation/auth/retry error -> preserve data and display appropriate status
  loop only while there is progress; back off on transport errors
```

Pull-before-push minimizes avoidable conflicts but does **not** eliminate races. The API must atomically compare baseRevision before write. Remote feed entries caused by previously acknowledged own mutations must be recognized by `operationId`; do not mislabel those as a conflict when newer local edits remain pending.

## 5. Remote cursor protocol

- The server provides a per-account **opaque** cursor indicating an ordered committed prefix of its change log.
- `GET /changes?cursor=X` returns committed events after X plus `nextCursor` and `hasMore`.
- Each page is applied atomically with its cursor. Never advance a local cursor before its page contents are persisted.
- At bootstrap, download a consistent snapshot and cursor (a transactionally consistent snapshot or snapshot token; never infer cursor by fetching unrelated lists at different instants). Continue with subsequent `/changes` pages.
- When cursor expired, return a specific `410 CURSOR_EXPIRED`; client runs a **safe rebase**: retain local dirty entities/outbox, fetch a new consistent server snapshot, and detect collisions. Never wipe the local database just to resync.
- Tombstones and change log remain long enough for normal offline periods; proposed >=90 days and configurable.

## 6. Conflict resolution

A conflict means a queued mutation's `baseRevision` does not match the server current revision (or target parent was deleted/moved incompatibly). Do not overwrite or discard either version.

Options in MVP:

1. **Keep server:** Confirm the choice, atomically save the local note under a new UUID as a local recovery copy, then apply the server snapshot and remove the old pending operations. A failed local transaction leaves the original entity and conflict intact.
2. **Save local as copy / keep both:** Create a new note with a new UUID and queued create operation, preserving the local content/type and asset references; retain the server original intact.
3. **Overwrite server:** Explicit destructive confirmation; resend local content with newly fetched server revision and a **new** operationId.

Folder conflicts: show the destination/name problem; allow retry at root or choose a different parent. Deleting a folder with pending descendants must not silently discard their edits; offer restore/move-as-copy.

## 7. Tabs and device concurrency

- Use BroadcastChannel and Web Locks where supported to coordinate per-account sync; provide a safe fallback if Web Locks are unavailable.
- Editing the **same note in two tabs of one browser profile** should have a single active writer or prominent read-only/lock takeover flow. Separate browser profiles/devices use normal server optimistic concurrency.
- SignalR is a hint; do not use its event stream as authoritative change history.

## 8. Attachments and tldraw

Store local blobs with durable IDs. Upload asset before submitting note snapshot referring to that server asset. Retry interrupted uploads and validate content hash/length. tldraw document snapshots (without per-device session state) use the same revisions/outbox model as notes; snapshots must be restorable using SDK versioned migrations.

## 9. Critical sync tests

1. Edit offline → reload offline → content still exists.
2. Server accepts mutation but response is lost → retry ID → exactly one result.
3. Client types while earlier mutation is in flight → older response does not clear newer draft.
4. Two devices diverge → conflict shown; local and server versions remain recoverable.
5. Delete parent folder offline, then create/move child elsewhere → deterministic dependency ordering.
6. Remote tombstone meets unsynced local changes → safe conflict, not silent loss.
7. Expired cursor with pending edits → safe bootstrap/rebase.
8. Asset upload interrupted → no broken server reference.
9. Two tabs switch foreground → no duplicated destructive work.
10. Auth expires and reconnects → outbox preserved until reauthentication.
