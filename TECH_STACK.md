# TECH_STACK.md — specified technologies

## Selected baseline

| Layer | Technology | Why |
| --- | --- | --- |
| Client | Next.js (App Router), React, TypeScript strict | Installable browser UI, typed component model |
| PWA | Web manifest + service worker with deliberate caching | Offline shell and reload behavior |
| Local data | IndexedDB, via a typed abstraction such as Dexie | Durable notes, tree, outbox, attachments |
| Text editors | CodeMirror 6 or an equivalent typed source editor | Markdown and Typst source editing |
| Markdown preview | Maintained Markdown renderer + sanitized HTML pipeline | Safe preview, no arbitrary HTML execution |
| Typst | Browser/WASM compiler in worker, subject to prototype | Offline-capable compile/preview/PDF export |
| Whiteboard | tldraw SDK (licensed for production) | Pen/touch/mouse canvas and document snapshots |
| API | ASP.NET Core Web API, C# nullable enabled | Self-hosted typed business/backend layer |
| Data | PostgreSQL + EF Core migrations | Transactions, relational integrity, revisions |
| Remote change hints | SignalR | Trigger `GET /changes`, not source of document state |
| Containerization | Docker + Docker Compose | Reproducible deploy and data volumes |
| Tests | xUnit or equivalent backend; Vitest/Jest + Playwright frontend | Unit/integration/E2E coverage |

## Important constraints

- Use compatible **supported stable versions**, pin exact versions in lockfiles and container image digests/tags, and document actual tested versions in deployment notes. Do not assume a hypothetical latest version is correct.
- Next.js server features should serve/authenticate the app, not form a second independent persistence API. Browser calls the ASP.NET Core API through a same-origin reverse proxy `/api/*` where possible.
- tldraw is **not an unrestricted permissive SDK**. Production requires a suitable license key and adherence to its current terms; budget/availability is a release gate. See https://tldraw.dev/community/license.
- tldraw snapshots have separate `document` and `session` scopes. Sync the document; keep per-device viewport/selection session local. See https://tldraw.dev/sdk-features/persistence.
- Do not mix `persistenceKey` black-box browser persistence with a second unsynchronized canonical store; integrate tldraw with Papyr's IndexedDB + outbox strategy.
- The precise Typst web compiler package must be validated for fonts, bundling, performance, offline mode, version compatibility, and handling images/packages before it becomes a dependency. A known browser/WASM option can be evaluated, but is **not** pre-approved by this document.
- Never send private note content to public external renderers or conversion APIs.

## Recommended repository toolchain

- `pnpm` for JavaScript packages, committed lockfile.
- `dotnet` CLI and checked-in solution/project files.
- Postgres in Docker for integration tests.
- OpenAPI endpoint and checked-in generated or validated TS API types.
- ESLint + formatter; .editorconfig and .NET analyzers.
- CI checks: typecheck, lint, unit tests, integration tests, E2E smoke, production build, migrations verification.

## Explicitly avoid

- Cloud-only database, hosted AI, online-only fonts for core editing, external authentication requirement, storing note bodies exclusively in server-side rendering cache, or embedding user notes in logs.
- Introducing Redux, multiple styling frameworks, or a microservice architecture without a concrete MVP need.
- Assuming service workers can reliably flush a final save on browser exit.
