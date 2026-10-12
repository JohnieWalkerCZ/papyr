# ARCHITECTURE.md — end-to-end system design

## Conceptual diagram

```text
Desktop / Tablet / Mobile (installed or in browser)
┌─────────────────────────────────────────────────────────────┐
│ Next.js React PWA                                            │
│ Folder tree  Markdown editor  Typst editor  tldraw editor    │
│            │                         │                      │
│ IndexedDB: metadata, bodies, snapshots, outbox, asset cache │
│            │                                                 │
│ Local write transaction -> Sync engine -> REST over HTTPS    │
└────────────┬──────────────────────────────┬─────────────────┘
             │                              ▲
             │ /api/v1/...                  │ SignalR: "changed"
             ▼                              │
┌─────────────────────────────────────────────────────────────┐
│ Reverse proxy (same origin, HTTPS)                           │
│  / -> Next.js frontend   /api,/hubs -> ASP.NET Core API      │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ ASP.NET Core API                                             │
│ Auth/authorization  Mutation validation  Conflict detection │
│ EF Core transaction  Change log  Attachment service         │
└──────────────────┬───────────────────────────┬──────────────┘
                   ▼                           ▼
              PostgreSQL                 Durable asset volume
         accounts/folders/notes          hashes/uploads/blobs
         revisions/change log
```

## Responsibilities and boundaries

**Frontend:** Accessible shell, offline read/write, editor adapters, IndexedDB migrations, outbox, sync transport, cache management, conflict resolution UI. It never knows DB credentials.

**API:** AuthN/AuthZ, tree integrity, transaction + version check, idempotency, storage/asset validation, change feed, OpenAPI. One write path for mutations. It is the authority for committed remote state.

**PostgreSQL:** Owns accounts, folders, notes, revisions, operation receipts, ordered change feed, tombstones, and asset metadata. All user data is account-scoped.

**Asset storage:** Separate files/blobs, referenced by UUID/content hash; kept in a persistent Docker volume. All references validated and served with safe content types.

**SignalR:** Small invalidation event with account/cursor; never a parallel source of truth; client subsequently fetches REST changes. Apps that miss events recover through normal sync.

## Recommended monorepo layout

```text
papyr/
  AGENTS.md  README.md  PRODUCT.md  ...other specifications...
  apps/
    web/                  # Next.js / React / PWA
      app/                # routes, layouts, manifest
      src/components/     # shared shell and widgets
      src/features/       # library, markdown, typst, whiteboard, sync
      src/lib/db/         # IndexedDB schema, migrations, repo
      src/lib/api/        # typed REST client
      public/             # manifest icons and worker assets
    api/                  # ASP.NET Core API (solution/projects)
      Papyr.Api/
      Papyr.Application/
      Papyr.Domain/
      Papyr.Infrastructure/
      Papyr.Tests/
  infra/
    compose.yaml
    compose.dev.yaml
    proxy/                # TLS/reverse-proxy config templates
  scripts/                # development, migration, backup/restore
  docs/                   # supplementary operational runbooks, screenshots
```

Keep layers proportionate to complexity: avoid unnecessary interfaces or deep enterprise abstractions. If the repo already exists, adapt paths rather than force a blind rewrite.

## Typical edit transaction

1. User types/draws; editor generates a new document state.
2. Frontend commits updated content **and** pending operation to IndexedDB atomically (or through an equivalent versioned local commit protocol).
3. UI reports **Saved locally** only after that transaction completes.
4. Sync engine coalesces superseded unsent note-content updates and pushes operations when network/auth permit.
5. API validates user ownership, base revision, hierarchy, attachments, and operation idempotency in a DB transaction.
6. On acceptance API returns new revision and operation receipt; client acknowledges exact operation and advances local remote-baseline; local newer edits remain dirty.
7. On conflict client preserves the unsent draft and offers explicit resolution.

See `SYNC.md` for the exact rules and `API.md` for the wire contract.

## Offline boot

Service worker provides static shell/build assets and a safe navigation fallback for deep-linked note URLs; app initializes IndexedDB and renders cached library without waiting for API. Cached auth identity may be shown locally but writes remain queued and remote access is authenticated when online. Missing editor bundles and Typst fonts/worker must be cached before advertising offline support for that editor.

## Production assumptions

One initial owner, moderate personal dataset, same-origin HTTPS, no public registrations, no real-time collaborative editing. Design with account IDs and database constraints so more users can be added without rewriting all data tables.
