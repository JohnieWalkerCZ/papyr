# PRODUCT.md — Papyr product requirements

## 1. Vision

Papyr is a **simple, fast, self-hosted, offline-first note workspace** combining structured text, mathematical typesetting, and freehand visual thinking. One consistent folder tree and one synchronization model cover all note types.

## 2. Primary user and use cases

The initial target is a single owner who writes school/study notes, mathematical derivations, and sketches on desktop and tablet with stylus support. Multiple personal devices should see the same notes after sync. Design the ownership model for multiple accounts later, but do **not** build teams, public sharing, or real-time co-editing in MVP.

Core journeys:

1. Install Papyr as a PWA and sign in to a personal self-hosted instance.
2. Create nested folders and organize notes using rename, move, delete, and restore.
3. Create a Markdown note for prose and inline equations where supported.
4. Create a Typst note for formulas, structured documents, and PDF export.
5. Create a tldraw whiteboard, draw with pen/touch/mouse, and reopen the exact editable canvas.
6. Continue writing offline; see **Saved locally** and later **Synced** without losing edits.
7. Switch notes or background the application and trigger a nonblocking sync attempt.
8. Launch Papyr on a second device and retrieve the latest committed state.
9. Resolve any conflict without destroying either competing version.

## 3. MVP must-have capabilities

### Library

- Unlimited logical folder depth (subject to reasonable UI/server safety limits), root folder, nested folders.
- Create, rename, move, soft-delete, restore folders and notes; deletion of a folder affects descendants.
- Stable IDs and human-readable titles; duplicate names are allowed within one folder in v1.
- Sidebar tree, breadcrumbs, search by title and note text (locally indexed if feasible), recent notes.
- Note type assigned at creation and immutable in MVP; conversion is a future explicit operation.
- User settings: theme (light/dark/system), locale (Czech/English), basic editor preferences.

### Editors

| Type | Source of truth | Editing | Preview/export |
| --- | --- | --- | --- |
| Markdown | UTF-8 Markdown source | Syntax editor | Sanitized rendered preview; `.md` download |
| Typst | UTF-8 Typst source | Syntax editor | Local compile/preview and PDF export |
| Whiteboard | tldraw versioned document snapshot JSON | Stylus/touch/mouse infinite canvas | Editable reopening; PNG/SVG export if supported |

Text editors must provide undo/redo, keyboard navigation, and autosave to IndexedDB. The whiteboard must retain shapes, bindings, pages, and asset references; a flattened raster image is never sufficient.

### Sync and offline

- Local IndexedDB working copy for folder tree, note bodies/snapshots, mutation outbox, and asset blobs needed for current work.
- Local saves are independent of the network. The UI clearly distinguishes locally saved, syncing, synced, offline, and conflict/error states.
- Automatic sync on startup/foreground, after ~5 seconds idle, when switching/closing notes, and on reconnection; best-effort on background/close; manual Sync button.
- Version-aware optimistic concurrency with explicit conflict recovery; durable idempotent retry of queued mutations.
- Initial download paginated; previously synced notes remain accessible offline. Pinning all large attachments for offline use is **post-MVP**.
- No automatic deletion of pending local edits on sign-out, quota error, failed upload, or expired auth.

### Self-hosting

- Docker Compose deployment for Next.js frontend, ASP.NET Core API, PostgreSQL, and durable attachment storage.
- TLS via reverse proxy, secure authentication, and documented backups/restores.
- Small-instance resource use suitable for a personal server; no mandatory external SaaS.

## 4. MVP non-goals

- Real-time collaborative editing or a shared whiteboard room.
- Shared folders, public links, comments, permissions UI, invitations, billing.
- AI generation, embeddings, OCR, handwriting-to-text, speech-to-text, handwriting search.
- Native mobile apps, cloud push notifications, server-side third-party note storage.
- Full Notion-like databases, tables with formulas, wikis, task management.
- Bidirectional Markdown↔Typst↔whiteboard conversion.
- Guaranteed delivery during `beforeunload` or browser crash.
- Full offline caching of arbitrary huge remote attachments.

## 5. Quality bars (targets, not claims)

- No acknowledged local save lost on reload or network loss.
- Note switching never waits for server acknowledgment; show reliable local persistence state.
- Common navigation/editor actions feel immediate on normal desktop and mid-range tablet.
- PWA installs with correct icons and supports revisiting cached content offline, including direct reloading a dynamic note URL through a navigation fallback.
- All keyboard-reachable operations have visible focus, accessible names, and tooltips where needed.
- A conflict is understandable and recoverable via **keep remote**, **save local as copy**, or **explicit overwrite remote**.
- Backup and restore are actually demonstrated in tests before production deployment.

## 6. Acceptance walkthrough

Create `School/Math`, then `Sequences.md`, `Integrals.typ`, and `Diagrams.tldr`. Edit all three, turn off the network, create a fourth note, reload while offline, and confirm all locally acknowledged edits remain. Reconnect and verify the second device receives all four notes. Edit the same note divergently on two disconnected devices and confirm Papyr detects and preserves both versions. Export a Typst PDF. Restart Docker services and verify the library is still intact.

## 7. Future backlog (not authorized for MVP)

Version history UI, link graph/backlinks, tags, cross-note references, import/export whole library, optional encrypted at-rest data, advanced stylus optimization, full attachment pinning, sharing/collaboration, CRDT-based text merge, server full-text search, PDF annotation, templates, global keyboard command palette, external integrations.
