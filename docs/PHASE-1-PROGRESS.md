# Phase 1 progress

**Date:** 2026-10-11  
**Slice:** local library tree, Markdown editing, and durable mutation queue.

## Implemented

- Dexie database version 4 retains the Phase 0 `drafts` and `snapshots` stores and adds indexed `entities`, `outbox`, sync metadata, and conflict stores.
- Nested folder and Markdown note creation, source editing, safe text-only preview, `.md` download, rename, move, soft-delete, trash, and restore.
- Folder picker for moves, folder breadcrumbs, local search across note titles and Markdown source, and a five-note recent list.
- Folder trash/restore updates descendants atomically in IndexedDB.
- Mutations receive a monotonic local outbox order. The UI reports a local save only after the IndexedDB transaction completes.
- The library adapts labels for Czech and English. Typst and whiteboard notes now open in their corresponding editor paths; tldraw remains blocked in production without an applicable license key.

## Verification

- Fake IndexedDB tests: 7 passed, 0 failed. Coverage includes migration/data retention, atomic create, rollback on outbox failure, title validation, ordered mutations, descendant-cycle rejection, and folder trash/restore.
- Production Playwright: 12 passed, 0 failed; development Playwright: 2 passed, 0 failed. Coverage includes offline create/edit/reload, Typst note source reload/export, moving/searching notes, editor accessibility, localized labels, and persistence failure behavior.
- TypeScript typecheck, ESLint, and Next.js production build passed.
- Node emits a `MODULE_TYPELESS_PACKAGE_JSON` warning while stripping TypeScript for tests; no functional impact observed.

## Contract and migration

- Local mutations follow the `API.md` action vocabulary and keep entity writes with their outbox records in an IndexedDB transaction.
- IndexedDB migration is additive; Phase 0 proof stores are retained. No server API or PostgreSQL migration is included.
- Authenticated sync submits operations and removes them only after definitive server receipts. It reconciles own accepted revisions and stores divergent remote changes as conflicts. API and limitations are tracked in [API.md](../API.md).

## Remaining Phase 1 work

Keyboard tree navigation and update-operation coalescing remain incomplete. The Markdown preview renders headings and plain text only, treating all source as text so HTML cannot execute. Full editor round-trip, quota recovery, conflict races, cursor expiry, multi-tab writer behavior, SignalR, attachment handling, and production recovery are not yet verified; the MVP plan remains in progress.
