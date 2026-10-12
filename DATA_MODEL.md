# DATA_MODEL.md — local and server entities

## 1. Canonical entities

All IDs are UUIDs (client generated where offline creation is required). Timestamps use UTC ISO-8601 on the wire. Public APIs use camelCase; DB may use snake_case. Every account-owned row contains `ownerId`.

### Account

`id`, `emailOrUsername`, `passwordHash`/auth provider metadata, `createdAt`, `status`. First-install setup is gated, with no public registration. Never store plaintext passwords.

### Folder

| Field | Purpose |
| --- | --- |
| `id: UUID` | Stable identity generated locally on create |
| `ownerId: UUID` | Authorization boundary |
| `parentId: UUID \| null` | Folder tree (`null` is library root) |
| `title: string` | Display name, not path |
| `sortOrder: string \| number` | Deterministic UI ordering, design frozen before implementation |
| `revision: long` | Entity optimistic concurrency |
| `deletedAt: datetime \| null` | Tombstone / trash |
| `createdAt`, `updatedAt` | Auditing and UI |

Validate no parent cycles, no parent owned by another account, no move into descendants, no pathological depth. Root is virtual, not a mutable folder row.

### Note

`id`, `ownerId`, `folderId|null`, `title`, `type: markdown|typst|whiteboard`, `content` (string for Markdown/Typst; structured JSON for whiteboard), `contentSchemaVersion` (needed for whiteboard), `revision: long`, `deletedAt|null`, `createdAt`, `updatedAt`, `sortOrder`.

A note type cannot change through normal update operations. Preserve source text exactly enough for reliable round-trip (including Unicode, newlines, whitespace and code blocks). For whiteboard, `content` represents a tldraw **document** snapshot with schema data—not its transient editor session/viewport state.

### Attachment

`id`, `ownerId`, `sha256`, `mimeType`, `byteLength`, `storageKey`, `createdAt`, `deletionCandidateAt`. The note/shape references attachment IDs, not absolute filesystem paths or arbitrary unauthenticated URLs. Keep an attachment-ref table (noteId, assetId) or equivalent validated reference list for safe garbage collection.

### Operation receipt

`ownerId`, `operationId: UUID`, `entityType`, `entityId`, `resultStatus`, `resultRevision`, `responsePayload`, `createdAt`. Unique `(ownerId, operationId)` makes network retries safe.

### Account change sequence

A per-account `syncState` row with `latestSequence` plus `changeLog(ownerId, sequence, entityType, entityId, operationType, payloadOrSnapshot, committedAt)`. Allocate sequence inside a transaction with a locked per-account syncState row to **serialize commit order**. Do not derive a cursor from timestamps or allocate unordered sequence values that might commit out of order.

## 2. Relationship rules

- Folder: many children and notes, single parent, owner scoped.
- Note: single folder or root, immutable type, independent revision.
- A folder soft-delete recursively tombstones all descendants **in one server transaction** and emits ordered change records for affected entities (or an explicitly documented cascade event that clients can deterministically apply).
- Restore behavior in MVP: restore deleted item to its original parent if that parent exists; otherwise restore to root. Document how descendant restoration behaves and test it.
- Name collisions are allowed; stable IDs disambiguate entities. No assumption that `(parent,title)` is unique.
- Server is responsible for authorization regardless of client tree display.

## 3. IndexedDB schema (conceptual)

| Store | Contents |
| --- | --- |
| `entities` | folders + notes including remote baseline revision and local dirty state |
| `outbox` | ordered mutations, client operationId, baseRevision, payload, attempt metadata |
| `assets` | blob bytes and local/remote upload state |
| `syncMeta` | account/instance key, last applied server cursor, schema version |
| `conflicts` | base/local/remote versions and chosen resolution status |
| `editorSessions` | per-device tldraw camera/selection, tab-specific UI state |

Papyr currently opens IndexedDB version 5. Earlier proof `drafts` and `snapshots` stores remain; versions 2–4 add entities, outbox, sync metadata, and conflicts; version 5 adds binary `assets` keyed by stable UUID with blob, SHA-256, MIME type, byte length, and pending/uploaded state. These are additive migrations. The client writes edited entity content and its operation in one transaction; it stores a selected blob before adding a stable reference to the note. Do not store authoritative local drafts in React state or localStorage only.

## 4. Payload rules

- Persist user-authored source/snapshots without destructive normalization.
- Keep `baseRevision` with every optimistic mutation.
- JSON whiteboard storage must preserve tldraw migrations and schema version metadata.
- Attachment uploads are independently retriable; do not publish note references to missing server assets.
- Enforce configurable size, depth, and filename constraints server-side; return meaningful errors without destroying local state.
- Do not rely on JavaScript `number` for arbitrary 64-bit DB sequences; expose cursor as opaque string, and revisions as safe strings if they may exceed JS safe integer range.

## 5. Migration/data integrity

Every schema migration must include up/down or documented recovery strategy, account-scoped indexes, uniqueness for operation receipts and change sequence, FK constraints where practical, cascade rules, and a backup-first production rollout. See `DEPLOYMENT.md`.
