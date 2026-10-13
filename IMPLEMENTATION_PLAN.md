# IMPLEMENTATION_PLAN.md — phased Codex delivery plan

Follow these phases in order. Build one vertical slice at a time and complete its acceptance tests before declaring it done. The checklist tracks work; Codex must **not** automatically mark items complete without evidence.

## Phase 0 — repository and proof-of-concepts

- [x] Create monorepo, baseline Next.js/TypeScript PWA, .NET API, PostgreSQL, EF Core project, Docker dev Compose.
- [x] Add formatter, lint, typecheck, xUnit, Playwright scaffold, CI pipeline.
- [x] Prove IndexedDB survives refresh and that the service-worker shell loads offline (browser hard reload; native OS install not separately exercised).
- [x] Prove browser Typst compile of math/Czech text/PDF works with bundled worker+fonts **offline**.
- [x] Prove tldraw pen interaction, document snapshot round-trip, and image asset loading.
- [x] Review tldraw license implications and block production release pending valid key.
- [x] Record dependency pins/architecture changes in ADR.

**Exit:** `docker compose up`, frontend+API health, prototype tests, and a short written feasibility report. No fake UX screens with disconnected mock persistence.

## Phase 1 — local-first library and Markdown

- [x] Define IndexedDB schema/migration and typed repositories (v2 additive stores; atomic local Markdown-note create + outbox).
- [x] Create folder tree, note list, breadcrumbs, new/rename/move/soft-delete/restore, and confirmed permanent Trash purge.
- [ ] Add Markdown source editor, sanitized preview, native source export. (Source/export plus headings, emphasis, inline code, links, lists, quotes, fenced code, and local images work; tables and nested block syntax remain unsupported.)
- [x] Implement immediate/delayed local save and reliable local status semantics.
- [ ] Add keyboard navigation and responsive shell.
- [x] Support offline create/edit/reload without backend.
- [x] Add local mutation outbox from the start, even if transport is stubbed.

**Exit:** Create/edit/rename/move Markdown offline, hard-reload, verify exact source and durable outbox.

## Phase 2 — auth, database, sync and multi-device

- [x] Owner initialization, secure session auth, authorization tests, CSRF.
- [x] Server entities, attachment metadata, operation receipts, change log, cursor integrity. (Entities/receipts/change log/attachment metadata and safe contiguous-prefix retention with explicit 410 expired cursors are implemented; PostgreSQL integration coverage passes.)
- [x] Implement API bootstrap/changes/mutations with optimistic concurrency and idempotency.
- [ ] Implement frontend pull/apply/outbox/retry/backoff and content generation ACK logic. (Pull/apply/outbox, ACK, bounded transient retries, and one safe bootstrap-cursor rebase are implemented; pending-edit expiration E2E coverage is still missing.)
- [x] Add conflict UI with keep remote, local copy, explicit overwrite.
- [x] Add multi-tab coordinator and notification-only SignalR. (Web Locks/IndexedDB sync coordination, same-note single-writer locks with a read-only retry flow, and owner-scoped SignalR invalidation are implemented and browser-tested.)
- [x] Integrate sync status, startup, idle, note switch, background, reconnect triggers. (Startup/session, idle, foreground, reconnect, note-switch, background/pagehide best-effort, and manual triggers are present.)
- [ ] Test concurrent writes, lost ACK, expired cursor rebase, remote tombstones. (PostgreSQL integration covers duplicate receipts, stale-write conflict, and expired cursors; pending-edit cursor rebase and remote tombstone browser coverage remain.)

**Exit:** Two independent browser contexts sync a note; divergent edits show recoverable conflict; no last-write-wins. (The disposable-database browser E2E now passes this journey, including authenticated SignalR invalidation.)

## Phase 3 — Typst

- [ ] Build Typst source editor with syntax support and compile diagnostics. (Compiler diagnostics and saved source are surfaced; syntax highlighting is not implemented.)
- [ ] Integrate validated WASM/worker, local preview/PDF export, correct fonts. (Implemented and browser-tested offline.)
- [ ] Handle offline bundled dependencies and explicit missing-asset/error conditions. (Bundled runtime and missing Papyr image errors are handled; arbitrary package resolution remains unavailable.)
- [ ] Support Typst image references with Papyr asset store. (Implemented and compiled in browser E2E.)
- [ ] Add export `.typ`, `.pdf` and end-to-end round-trip/sync tests. (Source/PDF download controls exist; cross-device editor sync acceptance is not complete.)

**Exit:** Create mathematical Typst note offline, compile/preview/export PDF, reload and sync to other device.

## Phase 4 — tldraw whiteboard and attachments

- [ ] Integrate tldraw in client-only component with pen/touch/mouse and fullscreen mobile/tablet layout.
- [ ] Persist versioned document snapshots through IndexedDB + same outbox as text.
- [ ] Separate tldraw per-device `session` from server `document` state. (Document snapshots sync through the note outbox; per-device session snapshots stay in IndexedDB.)
- [ ] Implement local attachment blobs, authenticated upload/download, stable asset refs, retry, lifecycle. (Local blobs, hash-checked upload/download, stable references, retry, local reopen, and Markdown image sync between browser profiles are browser-tested; whiteboard asset sync and orphan collection/deletion remain.)
- [ ] Validate opening whiteboards offline and after backend/SDK upgrades.
- [ ] Add source snapshot export and raster/vector export where SDK permits. (Editable JSON document snapshot, PNG, and SVG download controls are implemented.)
- [ ] Validate actual production license before deployment to public HTTPS host.

**Exit:** Drawing with shape/arrow/image survives offline reload, server sync, and device switch while editable.

## Phase 5 — polish, security and deploy

- [ ] Design system consistency, dark/light themes, Czech/English localization. (Czech/English and persisted light/dark/system preference controls are implemented; full design consistency review remains.)
- [ ] Keyboard/touch/stylus flows, accessible dialogs and error states.
- [ ] Performance tuning, large folder tree, debounce/snapshot profiling, cache updates.
- [ ] Security checks: auth/session/CSRF/XSS/upload/path traversal/resource limits.
- [ ] Production Compose, TLS proxy examples, environment and health checks.
- [ ] Backup/restore scripts and clean-host restore drill. (Paired backup/restore scripts with hash checks and explicit restore confirmation are implemented; clean-host drill is outstanding.)
- [ ] End-to-end acceptance suite from `PRODUCT.md` and `TESTING.md`.
- [ ] Record missing features/post-MVP backlog without pretending they are shipped.

**Exit:** All MVP product scenarios pass and self-hosted recovery has been tested.

## Version 1.1+ backlog (do not include in MVP without request)

Full-text search enhancement, tags, backlinks, native import/export library, version history, attachment pinning, shared notes, collaborative CRDT, advanced PDF annotation, handwriting recognition and templates.

## Per-phase completion report

```text
Phase: N
Implemented:
Important files/migrations:
Tests: commands and exact pass/fail/skip counts
Screenshots/manual checks:
Known limitations:
Security/data-loss risks:
Ready for next phase: YES / NO
```
