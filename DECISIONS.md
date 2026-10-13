# DECISIONS.md — architecture decision log

## Recorded decisions (proposed baseline, 2026-10-10)

| ID | Decision | Reason | Consequence |
| --- | --- | --- | --- |
| ADR-001 | Papyr is local-first with IndexedDB | Editing must work offline and feel immediate | Browser has authoritative un-synced changes until acknowledged |
| ADR-002 | Self-hosted ASP.NET Core API + PostgreSQL + EF Core | Strictly typed backend and durable transactions | Avoid direct frontend DB access |
| ADR-003 | Next.js App Router + React + TypeScript PWA | One installable cross-platform client | Careful client-only initialization of IndexedDB/editors |
| ADR-004 | Docker Compose deployment | Straightforward personal-server operation | Separate persistent DB and asset volumes |
| ADR-005 | Every entity has a stable ID and revision | Moves/renames must be safe | All writes use optimistic concurrency |
| ADR-006 | Single-user-first, account-scoped data model | Keep MVP manageable without blocking future accounts | Registration/sharing out of scope |
| ADR-007 | SignalR is notification-only | Remote changes can be discovered promptly | REST/outbox protocol remains source of truth |
| ADR-008 | tldraw stores document snapshots + separate asset blobs | Preserve editability and permit backup | SDK schema migration and asset lifecycle matter |
| ADR-009 | Manual conflict resolution, no last-write-wins | Never silently lose user work | Conflict UI and copy resolution required |
| ADR-010 | One local outbox for all mutations | Offline folder edits and document edits must behave identically | Replay order and idempotency key required |
| ADR-011 | Local Typst compilation preferred; protected self-hosted fallback only if needed | Offline preview and privacy | Validate WASM/worker/font compatibility in prototype |
| ADR-012 | Duplicate note/folder titles allowed | Avoid offline naming collisions | Stable IDs, not filenames, are canonical |
| ADR-013 | App UI supports `cs` and `en` | Study-oriented audience | No hard-coded visible strings |
| ADR-014 | Browser tabs coordinate writes to the same note | Prevent accidental tab-to-tab clobbering | BroadcastChannel + Web Locks / fallback mechanism |

These are design defaults. The original product constraints (three formats, Docker server, folders, PWA, deferred but reliable sync) are mandatory. If a default is unsuitable, record a new ADR before implementing a different design.

## Explicit unknowns / decision gates

- **tldraw license:** The SDK has license requirements for production, including hobby/noncommercial and commercial keys; determine applicable license **before any real-domain production release**. Development locally is not equivalent to production permission. Official: https://tldraw.dev/community/license and https://tldraw.dev/sdk-features/license-key
- **Typst runtime:** Validate a browser/WASM compilation provider, font bundles, image imports, package resolution, and offline PDF rendering with a small proof of concept. Do not promise package availability offline without caching it. Official compiler reference: https://typst.app/docs
- **Authentication enrollment:** MVP defaults to first-user setup via a one-time admin bootstrap secret/environment configuration; no public registration. Choose and document final session implementation before Phase 2.
- **Attachment volume limits:** Choose practical configured file size/quota after actual tablet/browser and server testing; ensure behavior on quota failures is non-destructive.
- **Data retention:** Set a conservative configurable tombstone/change-log retention (proposed >=90 days) plus a documented full-resync recovery path.
- **Hosting/domain:** Actual HTTPS endpoint and backup destination depend on the user's deployment and are not prefilled.

### ADR-015 — Phase 0 browser editor feasibility candidates
- Date: 2026-10-11
- Status: proposed
- Context: Phase 0 requires a browser Typst/PDF proof and a tldraw snapshot/asset proof without approving a production editor license or introducing hosted services.
- Decision: Evaluate `typst-wasm` 1.0.0 with the separately versioned `@typst-wasm/fonts` 1.0.0 using same-origin worker/WASM/font assets. Keep tldraw 5.5.2 as a development-only proof; persist its document snapshot through Papyr IndexedDB and use its own local persistence only for SDK asset feasibility. Do not treat that split proof store as the production data contract.
- Alternatives considered: hosted Typst compile service (rejected: sends private source to an external service); tldraw `persistenceKey` as Papyr's canonical note store (rejected: it cannot coordinate the future common IndexedDB/outbox protocol).
- Consequences and migrations: The Typst package and worker path remain candidates until offline browser tests and browser compatibility are demonstrated. Phase 4 must replace tldraw's independent asset persistence with an adapter tied to Papyr's asset store. Production builds refuse to show tldraw without a configured key; actual license suitability remains an operator decision.
- Validation/tests: Official Typst WASM integration guide and tldraw persistence/license documentation reviewed; browser proof results are recorded in `docs/PHASE-0-FEASIBILITY.md`.

### ADR-016 — Local entity and outbox transaction boundary
- Date: 2026-10-11
- Status: accepted
- Context: Phase 1 needs stable local library records and a durable operation queue while preserving existing Phase 0 IndexedDB proof data.
- Decision: Add the `entities` and `outbox` stores in Dexie schema version 2, retaining version 1 `drafts` and `snapshots`. Create a local Markdown note and its `create` operation atomically with a client UUID and `baseRevision: null`.
- Alternatives considered: Replace proof stores in place (rejected because migration could discard locally authored data); save entity and queue operation separately (rejected because interruption could leave an unsynced entity or orphan operation).
- Consequences and migrations: Additive IndexedDB migration only; no PostgreSQL/API migration. A future server acknowledgment must be definitive before an outbox item is removed. Further mutations must preserve ordering and the current record if an operation is pending.
- Validation/tests: Fake IndexedDB tests cover v1 data retention, successful atomic create, rollback on outbox failure, and empty-title validation. Playwright verifies offline creation and reload.

### ADR-017 — Ordered offline library mutations
- Date: 2026-10-11
- Status: accepted
- Context: Phase 1 needs folders and notes to remain recoverable offline while preserving deterministic replay order and subtree trash behavior.
- Decision: Persist each local entity mutation and its outbox operation in one IndexedDB transaction. Give operations a strictly increasing local `createdAt` ordering value. Folder trash/restore writes all affected descendants and their operations atomically; restore applies only to descendants sharing the folder deletion timestamp.
- Alternatives considered: Replace prior operations (rejected because no server acknowledgment exists yet); delete descendants (rejected because recovery must be possible).
- Consequences and migrations: IndexedDB version 3 preserves all prior stores and records. The sync client must honor operation order, reconcile revisions after each acknowledgment, and preserve all operations on failed replay.
- Validation/tests: Fake IndexedDB tests cover ordered replay records, folder-cycle rejection, descendant trash/restore, and atomic operation writes.

### ADR-018 — First-owner authentication and session storage
- Date: 2026-10-11
- Status: accepted
- Context: Phase 2 requires gated first-owner setup, revocable sessions, CSRF protection, and no public registration.
- Decision: Hash passwords with ASP.NET Core Identity's `PasswordHasher<TUser>`. Store only a SHA-256 hash of a cryptographically random 256-bit opaque session token in PostgreSQL; issue the raw value only in an HttpOnly, SameSite=Lax cookie with a 14-day absolute expiry. Use ASP.NET Core antiforgery request/cookie tokens on state-changing requests, and rate-limit setup/login. A unique instance key permits exactly one owner. Setup requires a configured one-time token of at least 32 characters and becomes unavailable after the owner row exists.
- Alternatives considered: Stateless cookies (rejected because server-side logout/revocation is needed); home-grown password hashing or CSRF tokens (rejected in favor of framework implementations).
- Consequences and migrations: The initial EF migration adds owner and session tables. Operators must set `PAPYR_INITIAL_SETUP_TOKEN`, then remove it after setup; use HTTPS and set `PAPYR_COOKIE_SECURE=true` outside local HTTP development.
- Validation/tests: PostgreSQL-backed API integration tests cover setup, login, CSRF rejection, logout revocation, mutation idempotency, stale revision conflict, and paginated bootstrap/change feed. The chosen password hasher and antiforgery APIs follow [ASP.NET Core Identity documentation](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-configuration) and [antiforgery documentation](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery).

### ADR-019 — Stable local-first attachment blobs
- Date: 2026-10-11
- Status: accepted
- Context: Typst documents and tldraw drawings need private image assets that remain usable offline and can be synchronized without arbitrary URLs or filenames.
- Decision: Store image bytes and SHA-256 in IndexedDB under a client UUID. Use `papyr-asset://<uuid>` in text; tldraw requires a valid URL, so whiteboard snapshots use the reserved `https://papyr.invalid/papyr-assets/<uuid>` form, resolved locally through its asset store. Sync uploads referenced blobs before mutations and downloads remote references before applying server pages. The API accepts one bounded PNG/JPEG/GIF/WebP upload, verifies signature and checksum, stores an opaque GUID path on the durable asset volume, and validates note references in the same transaction as the note mutation.
- Alternatives considered: Inline base64 in note content (rejected because it inflates every snapshot/change event); trusting browser object URLs or user filenames (rejected because neither is stable or safe); external object storage (rejected because it adds a hosted service).
- Consequences and migrations: IndexedDB v5 adds an `assets` store. PostgreSQL migration `202610110002_Attachments` adds metadata and reference tables. The `papyr-assets` volume and database must be backed up together. Migration rollback removes attachment metadata/references but leaves physical files; restore the matching backup pair before rollback. Orphan collection is intentionally deferred, so unused blobs consume storage.
- Validation/tests: PostgreSQL integration coverage exercises verified upload, idempotent retry, authenticated retrieval, hash/type rejection, note-reference validation, and preservation of note data on rejected mutation. Browser tests cover offline attachment storage and editor reopening.

### ADR-020 — Confirmed permanent trash purge
- Date: 2026-10-13
- Status: accepted
- Context: Users need to permanently clear synced tombstones while preserving the local-first outbox and other-device change feed.
- Decision: Empty Trash is an explicitly confirmed bulk action available only when its trashed entities have no pending operations or unresolved conflicts. Queue revision-checked `purge` operations atomically with local removal, process descendants before parent folders, physically remove server rows only after validating they are tombstoned and empty, and emit a `purge` change snapshot for every removed row. Keep attachment blobs after reference rows cascade away.
- Alternatives considered: Local-only deletion (rejected because bootstrap would restore items); immediate server calls (rejected because offline use and lost acknowledgments would be unsafe); recursive server cascade purge (rejected because each stable entity needs its own feed event and revision check).
- Consequences and migrations: No schema migration. The public mutation contract adds `purge`. Other profiles delete clean purged entities; profiles with local pending work retain a conflict until the user resolves it.
- Validation/tests: Automated tests and cross-device browser coverage should include successful trash purge, acknowledged retries, conflict preservation on a second profile, and folder descendant ordering.

## Deliberate future ADR candidates

Sharing & roles, per-note CRDT, folder permissions, encryption at rest/end-to-end, server-side Typst compilation, background sync service worker strategy, public account provisioning, library export/import.

## ADR entry format

```markdown
### ADR-NNN — Short title
- Date:
- Status: proposed | accepted | superseded
- Context:
- Decision:
- Alternatives considered:
- Consequences and migrations:
- Validation/tests:
```
