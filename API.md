# API.md — HTTP and realtime contract (v1)

This is the current v1 wire contract. Base URL: same-origin `/api/v1`. HTTPS is required outside local development. JSON uses camelCase, ISO-8601 UTC dates, UUID IDs, and string cursors. Auth uses a server-validated HttpOnly session cookie and antiforgery token on state-changing requests.

## Authentication

- `GET /api/v1/auth/setup-status` — reports whether initial setup has completed; on database errors returns `503` with a safe diagnostic code and request diagnostic ID, while full exceptions remain in API logs. The Next.js route preserves API JSON responses and returns safe `503` transport diagnostics (`API_CONNECTION_REFUSED`, `API_DNS_FAILED`, `API_TIMEOUT`, `API_PROXY_FAILED`) when it cannot reach the API, or `API_HTTP_ERROR` for a non-JSON API error. Settings displays these diagnostics without exposing internal addresses or exception contents.
- `POST /api/v1/setup` — one-time initial administrator bootstrap, authorized with setup token and `confirmReset: true`; transactionally clears server records and clears files under configured attachment storage before creating the administrator.
- `POST /api/v1/auth/accounts` — administrator-only account provisioning; creates a non-admin account without signing it in.
- `POST /api/v1/auth/login` — establish authenticated session.
- `POST /api/v1/auth/logout` — revoke session (local dirty data retained until user explicitly handles it).
- `GET /api/v1/auth/me` — account identity, capabilities, session status.
- `GET /api/v1/auth/csrf` — optional CSRF token retrieval, depending on chosen CSRF architecture.

There is no public sign-up. First setup requires a configured 32-character-or-longer `PAPYR_INITIAL_SETUP_TOKEN` and explicit reset confirmation. It is disabled after the first account exists. Each account can access only its own notes and attachments; the initial account is the sole administrator. Existing single-owner installations migrate that account as administrator. Setup and login are rate-limited. Session cookies expire after 14 days; logout revokes the current session and disconnects its active SignalR connections.

If startup database migrations fail, the API serves diagnostics only: `/health/live` returns `200` with `status: "diagnostic"`, and all other requests, including readiness, setup-status, authentication, and mutations, return `503` with the safe database diagnostic and a startup diagnostic ID. No application endpoint runs in this mode. Correct the configuration and restart the API to retry migrations; migration errors are not bypassed.

## Reading and change feed

Stack recovery is an operator startup action, not a public enrollment endpoint: `PAPYR_RESET_DB_PASSWORD=true` repairs the database role password and then creates or recovers the administrator from `PAPYR_ADMIN_USERNAME` / `PAPYR_ADMIN_PASSWORD`. Existing administrator ID, notes, and attachments are preserved; old administrator sessions are revoked. An invalid credential configuration or username belonging to another account yields `ADMIN_RECOVERY_FAILED` in diagnostic mode and does not change account records. Disable the flag after recovery; credentials are never returned by the API.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/bootstrap?cursorToken=...` | Consistent paginated initial snapshot of folders, notes and metadata, with final cursor |
| `GET /api/v1/changes?cursor=opaque&limit=200` | Ordered changes and tombstones since cursor |
| `GET /api/v1/notes/{id}` | Fetch server copy of one note for reconciliation |
| `GET /api/v1/folders/{id}` | Fetch one folder if needed for conflict UI |
| `GET /api/v1/assets/{id}` | Authorized attachment download |
| `GET /health/live` | Liveness |
| `GET /health/ready` | Readiness (nonpublic or restricted operational use) |

**Bootstrap consistency:** the API materializes an owner-scoped snapshot and change sequence in a repeatable-read transaction and returns hashed, expiring continuation tokens. Active snapshots are reused for the same sequence; at most five active snapshots are retained per owner, and bootstrap is limited to 12 requests per five minutes. Snapshot pages expire after 30 minutes. Change-feed cursors use `seq:<integer>`. The API retains a contiguous recent change window (90 days by default, configurable with `PAPYR_CHANGE_RETENTION_DAYS`); a cursor older than the retained range receives `410 CURSOR_EXPIRED`. The client must preserve its outbox while rebasing; see `SYNC.md`.

## Mutations — single authoritative write path

`POST /api/v1/mutations`

```json
{
  "operations": [
    {
      "operationId": "d43932a0-8707-4cb1-90dd-14e2b2ee1ff1",
      "entityType": "note",
      "entityId": "e38771ac-a483-4e15-8e09-3f2e3902abed",
      "action": "update",
      "baseRevision": "7",
      "payload": { "title": "Sequence notes", "content": "# Sequences\n" }
    }
  ]
}
```

Actions: `create`, `update`, `move`, `rename`, `delete`, `restore`, `purge`. Entity types: `folder`, `note`. A create operation uses `baseRevision: null`. `update` can change permitted fields in one atomic entity revision. `move` uses a destination parent ID. `delete` means soft-delete; `purge` permanently removes an already trashed entity with a revision check. Purge child notes and folders before their parent folder.

Operation processing: **each operation is its own DB transaction** (ordered processing with owner-scoped tree validation); a batch may partially succeed. Submit 1–100 operations per batch. Return one receipt per operation. Duplicate `(ownerId,operationId)` requests replay the saved receipt and do not create another change event. Note content is limited to 4,000,000 UTF-8 bytes; the API request body is limited to 5,000,000 bytes and folder depth to 64.

Success (HTTP 200 for the batch, with per-item status):

```json
{
  "results": [
    {
      "operationId": "d43932a0-8707-4cb1-90dd-14e2b2ee1ff1",
      "status": "accepted",
      "entityId": "e38771ac-a483-4e15-8e09-3f2e3902abed",
      "revision": "8",
      "serverCursor": "seq:51"
    }
  ]
}
```

A conflict item:

```json
{
  "operationId": "d43932a0-8707-4cb1-90dd-14e2b2ee1ff1",
  "status": "conflict",
  "entityId": "e38771ac-a483-4e15-8e09-3f2e3902abed",
  "currentRevision": "9",
  "error": { "code": "REVISION_CONFLICT", "message": "Remote note changed" }
}
```

Fetch conflicting server entity via GET if the response does not include a full copy. `status` values: `accepted`, `duplicate`, `conflict`, `rejected`, `retryable`. For validation failure return machine-readable error code; never pretend it was committed. Duplicates carry original receipt revision/cursor.

## Attachments

Assets are private, owner-scoped image blobs. `POST /api/v1/assets` accepts one `multipart/form-data` field named `file`, plus `X-Asset-Id` (stable UUID), `X-Content-SHA256` (hex SHA-256), and the normal CSRF token. The per-file upload limit is 4,000,000 bytes; the total per-owner quota defaults to 1 GiB and is configurable with `PAPYR_MAX_ASSET_STORAGE_BYTES`. Accepted media are PNG, JPEG, GIF, and WebP, and the API verifies file signatures instead of trusting the supplied media type or filename. Retrying the same ID and bytes returns `duplicate`; different bytes for an existing ID return `409`.

Whiteboard content must be a tldraw store snapshot with object-valued `store` and `schema`, a schema version, store version, record-version map, and at most 10,000 well-formed records. Invalid payload fields are rejected as mutation receipts; malformed JSON field types do not produce server errors.

`GET /api/v1/assets/{id}` streams an authenticated image with `nosniff`, a private immutable cache policy, and `X-Content-SHA256`. The API stores opaque GUID filenames under `PAPYR_ASSET_STORAGE_PATH`; Compose mounts this as the durable `papyr-assets` volume. Markdown and Typst use `papyr-asset://<uuid>`; tldraw snapshots use `https://papyr.invalid/papyr-assets/<uuid>` because its schema requires valid URLs. Both forms are local references, never external fetch targets. Note mutations validate that every reference already belongs to the owner and update the reference index in the same database transaction. The client stores blobs in IndexedDB, uploads referenced blobs before note mutations, and downloads referenced blobs before applying remote snapshots.

Trashed entities can be permanently removed through `purge`. This deletes attachment-reference rows for purged notes; attachment blobs remain stored. Unreferenced assets are retained, which uses storage but avoids removing a blob that a pending or old snapshot may still need.

## Change response example

```json
{
  "changes": [
    {
      "sequence": "51",
      "operationId": "d43932a0-8707-4cb1-90dd-14e2b2ee1ff1",
      "entityType": "note",
      "entityId": "e38771ac-a483-4e15-8e09-3f2e3902abed",
      "action": "update",
      "revision": "8",
      "entity": { "id": "e38771ac-a483-4e15-8e09-3f2e3902abed", "type": "markdown", "title": "Sequence notes", "content": "# Sequences\n" }
    }
  ],
  "nextCursor": "seq:51",
  "hasMore": false
}
```

`entity` must include the full typed object fields needed to persist the local record; the example is intentionally abbreviated. Change events should include the originating `operationId` when a client mutation caused them, allowing the client to recognize **its own accepted operation** and advance the baseline without clobbering newer local edits. Delete events carry adequate tombstone identifiers and revision to apply deterministically.

## Errors and limits

Use HTTP `401` session invalid, `403` forbidden, `409` for single-resource conflicts (per-op result remains `conflict` in mutation batch), `410` `CURSOR_EXPIRED`, `413` payload too large, `422` invalid tree/payload, `429` rate limit, `503` unavailable. All errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`. Never expose secrets/SQL traces. Document max operations per batch, size limits, and server-side timeouts in OpenAPI.

## Realtime hint

Authenticated SignalR hub `/hubs/changes` emits the owner-scoped `invalidate` event with no payload after a mutation commits. Connections are closed on session expiry or logout. The event only requests that the client call `GET /api/v1/changes`; it is not an authoritative change record. Missed or disconnected events are harmless because clients also sync on startup, foreground, online, idle, and manual triggers. Immediate logout disconnect applies within the API process; use shared connection tracking before running multiple API replicas.

## Contract validation

Generate or validate TypeScript types from backend OpenAPI; keep unit/contract tests for request/response schemas. No client path should post a mutation outside the defined idempotent endpoint.

## Browser account guard

Sync clients send optional `X-Papyr-Account: <authenticated-account-uuid>` on bootstrap, changes, mutations, entity fetches, and attachment requests. After authentication, the API compares it with the session's account ID. A mismatch (including an expired session) returns `409` with `error.code: "ACCOUNT_CHANGED"` before endpoint execution. The client stops syncing and rechecks authentication; pending local data remains intact. This header only constrains the authenticated identity and cannot grant access. Requests without it retain existing behavior for compatibility. CSRF and normal authorization still apply.
