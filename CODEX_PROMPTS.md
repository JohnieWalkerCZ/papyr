# CODEX_PROMPTS.md — starting and continuing Codex

## Initial setup prompt (copy into Codex)

```text
You are implementing Papyr, a self-hosted local-first PWA notes app.
First read AGENTS.md, README.md, PRODUCT.md, DECISIONS.md, ARCHITECTURE.md, TECH_STACK.md, DATA_MODEL.md, SYNC.md, API.md, EDITORS.md, UI_UX.md, DESIGN_RULES.md, SECURITY.md, TESTING.md, DEPLOYMENT.md, IMPLEMENTATION_PLAN.md, PERFORMANCE.md, and CODING_STANDARDS.md.

Start with Phase 0 only. Inspect the existing repository before making changes. Build a real, minimal working foundation, not a static mockup. Preserve the specified Next.js/React/TypeScript frontend, ASP.NET Core backend, PostgreSQL/EF Core, Docker Compose, and local-first IndexedDB architecture. Use official docs to evaluate a browser Typst compiler and tldraw integration. Do not assume tldraw is production-licensed.

Follow AGENTS.md: plan first, implement a bounded vertical slice, add tests, run them, update docs/ADRs when needed, and report exact verification. Do not advance to Phase 1 until Phase 0 exit criteria are demonstrated. Keep the UI initially simple and accessible. No fake synchronization, no irreversible operations, no external cloud dependencies.
```

## Continue with the next phase

```text
Read AGENTS.md and the current IMPLEMENTATION_PLAN.md. Inspect git status, current code, existing tests and the most recent phase completion report. Identify the earliest incomplete phase and implement its next small vertical slice. Preserve all persistence/sync invariants. Before editing, give a concise plan and name affected contracts/migrations. After editing, run relevant checks, update docs/ADR and report tests with exact results. Do not claim an entire phase is done unless its exit criteria pass.
```

## UI audit and improvement prompt

```text
Audit Papyr on desktop (~1440px), tablet (~768–1024px), and mobile (~360–390px), including light/dark themes, Czech labels, Markdown editor, Typst preview, whiteboard, folder tree, dialogs and sync/error states. Compare with UI_UX.md and DESIGN_RULES.md. Identify visual hierarchy, readability, alignment, inconsistent radius/spacing, keyboard access, touch/stylus targets, overflow and confusing sync feedback. Fix issues in small batches without changing the product architecture. Provide before/after screenshots if the environment permits and run relevant E2E and accessibility checks.
```

## Sync correctness / adversarial QA prompt

```text
Audit the implemented sync pipeline against SYNC.md, API.md and DATA_MODEL.md. Build and run deterministic tests for offline editing + reload, lost ACK, concurrent revisions, in-flight local edits, folder cascades, expired cursors, two tabs, interrupted attachments, auth expiry and restore after server rollback. Prefer fixing data-loss and integrity bugs before performance/UI optimizations. Never resolve conflict by hidden last-write-wins. Report repro steps, root cause, fix, tests and any remaining risks.
```

## Release readiness prompt

```text
Read DEPLOYMENT.md, SECURITY.md, TESTING.md and DECISIONS.md. Verify production Docker images, migrations, TLS/sessions, CSRF, auth isolation, upload security, PWA offline behavior, three note types, migration compatibility, backups and restore drill. Verify actual tldraw production-license readiness for the intended host, without inventing a key or claiming the license was obtained. Run the complete feasible test suite, state exact results and block release on unsolved data loss, auth or restore failures.
```
