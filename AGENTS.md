# AGENTS.md — Papyr Codex instructions

You are the engineering agent implementing **Papyr**. Read `README.md`, `PRODUCT.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `SYNC.md`, and the active phase in `IMPLEMENTATION_PLAN.md` before modifying code. Use the remaining documents for their corresponding areas.

## Instruction precedence

1. User's latest explicit instruction.
2. This `AGENTS.md`.
3. Approved decisions in `DECISIONS.md`.
4. Product acceptance criteria in `PRODUCT.md` / `IMPLEMENTATION_PLAN.md`.
5. Remaining design and technical documents.

If two sources conflict, document the conflict in `DECISIONS.md`, prefer the safer/no-data-loss interpretation, and do not quietly invent a new product requirement.

## Working method

1. Inspect the actual repository before proposing a change; do not assume files or frameworks exist.
2. Identify the current implementation phase and its acceptance criteria.
3. Produce a compact plan of impacted files, data migrations, edge cases, and tests.
4. Implement in small, reviewable vertical slices (UI + local persistence + API + tests when relevant).
5. Run the relevant automated tests and formatting/lint/typecheck/build steps available in the repo.
6. Report files changed, user-visible behavior, tests executed with results, assumptions, unresolved risks, and next recommended phase. Never claim tests passed unless run.
7. Update the documentation and decision record **in the same change** if contracts or requirements change.

## Rules that must not be broken

- **No data loss:** Persist edits to IndexedDB before showing “Saved locally”; never clear outbox items before server acknowledgment; never replace pending local edits with a remote payload.
- **No fake offline:** Do not merely cache the HTML shell; implement real local reads/writes, pending mutations, reconnect handling, and tests.
- **No unreliable close-only sync:** Closing a tab is not the primary sync trigger.
- **No automatic last-write-wins:** Honor base revisions and surface conflicts to the user.
- **No unsupported collaboration promises:** SignalR announces changes only in MVP; concurrent collaborative cursors and CRDT merging are out of scope.
- **No leaking secrets:** Do not commit production credentials, session secrets, license purchase details, real user notes, or deployment keys.
- **No silent external services:** All note contents, images, rendering, analytics, authentication, and compiler inputs remain local/self-hosted unless explicitly approved.
- **No reliance on mutable filenames:** Stable IDs are the source of truth for folders, notes, attachments, and operations.
- **No surprise destructive actions:** Explicit confirmation for permanent delete, overwrite conflict resolution, bulk moves, and storage purge.
- **No speculative package upgrades:** Pin tested dependencies and consult official docs/licenses first.
- **No early framework substitution:** Preserve the specified Next.js + ASP.NET Core + PostgreSQL architecture unless the user approves a change.

## Preferred implementation conventions

- Strict TypeScript and C# nullable reference types with analyzers.
- Use small, purpose-driven components/services; avoid giant editor and sync manager files.
- Keep markup attributes on one line and do not unnecessarily wrap function parameter/argument lists across lines.
- Use `rem` for spacing/typography in CSS and centralized design tokens.
- No direct database access from the Next.js frontend; API contract is the boundary.
- API data structures are versioned and typed; public wire contract is documented in `API.md`.
- One mutation protocol for create/update/move/rename/delete; no hidden alternate write endpoints.
- Prefer accessibility (semantic HTML, keyboard support, contrast, focus visibility, reduced motion) over visual gimmicks.
- Do not mark a phase done while failing tests or known critical issues remain.

## Test requirements

For any feature touching persistence or sync, include unit tests, server integration tests, and at least one browser E2E scenario. For any editor feature, test round-trip: create → edit → reload → sync → load on another device profile. For migrations, include migration and rollback/restore considerations. See `TESTING.md`.

## Pause / escalation conditions

Request a product decision before shipping if it concerns actual tldraw production license, secret management on a real host, enabling public registration, monetization, production destructive migrations, or broadening data access. A self-contained local development implementation may proceed with documented safe defaults.

## Done report template

- **Implemented:** concise behavior summary.
- **Changed files:** list.
- **Verification:** actual commands/results and any manual checks.
- **Risks / TODO:** outstanding items.
- **Next:** suggested implementation phase.
