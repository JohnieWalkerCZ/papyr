# CODING_STANDARDS.md — implementation quality

## General

- Aim for small, readable modules and explicit interfaces at real architecture boundaries.
- Prefer precise names and simple flows over clever abstractions; eliminate unused code.
- Do not introduce new dependencies if native/platform code or existing packages cover the need.
- Treat error paths, timeouts, migrations, offline cases, and concurrent writes as first-class behavior.
- Keep API wire contracts and migrations reviewed together.
- Update focused tests as part of implementation, not after a milestone.

## Frontend (TypeScript/React)

- `strict: true`; avoid `any`, unchecked casts, swallowed Promise rejections, and non-null assertions unless justified.
- Functional React components, stable hooks, typed events/data models. Avoid creating a giant global editor store.
- Keep logic out of presentation components: modules for IndexedDB, sync engine, API client, editor adapters, and domain actions.
- Persist critical data through a typed repository layer; do not scatter raw IndexedDB transactions throughout the UI.
- Validate untrusted API/IndexedDB content at appropriate boundaries, version the schema.
- Use accessible native controls; ensure keyboard and pointer behavior remain coherent on touch devices.
- Localize displayed strings via translation keys (`cs`, `en`).
- HTML/JSX attributes should remain on a single line where practical. Do not needlessly split parameter/argument lists across lines.
- Styling: semantic CSS variables, component-scoped styles, `rem` units; no accidental style overrides or competing frameworks.

## Backend (.NET/C#)

- Nullable reference types, analyzers, async/await, cancellation tokens, nonblocking I/O.
- Separate transport DTOs, business validation, domain models, and EF Core persistence where it improves clarity; avoid elaborate boilerplate layers without value.
- Every mutation is authenticated, authorized, validated, idempotent, revision-checked and transactional.
- Use DB constraints for unique operation ID, FK ownership as feasible, ordered change-log sequence; never depend only on frontend validation.
- Add EF Core migrations as tracked files; do not edit production database manually.
- Prefer meaningful typed errors with stable codes over exception text exposed to users.
- Never log plaintext note content or credentials.

## Formatting and tests

- Root `.editorconfig`, standardized format/lint/typecheck scripts, test commands in `README` when bootstrapped.
- Frontend: unit tests for sync reducer/outbox and editor adapters; E2E for offline and conflict flows.
- Backend: unit tests for tree and mutation logic; real Postgres integration tests for concurrency and auth.
- Add regression test for every data-loss/conflict bug.
- Favor deterministic clocks/UUID providers in tests and isolated browser profiles to simulate devices.

## Git hygiene and reports

- Small commits grouped by feature/phase. No `node_modules`, binaries, generated PDF exports, local databases, secret files, or private note samples in Git.
- Commit package lockfiles and schema migrations.
- When changing an invariant or API shape, update `API.md`, `SYNC.md`, `DATA_MODEL.md`, and `DECISIONS.md` as relevant.
- Report tested command results accurately; state blockers if a test environment is unavailable.
