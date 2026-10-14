# TESTING.md — test strategy and release gates

## Layers and tools

- **Backend unit:** xUnit (or an established project equivalent) for domain validation and mutation behavior.
- **Backend integration:** actual PostgreSQL (testcontainer or Docker service), EF Core migrations, concurrent transactions, auth and asset APIs.
- **Frontend unit:** React component tests, serialization/migration logic, IndexedDB adapter with appropriate fake database for quick cases.
- **Browser E2E:** Playwright on Chromium; add Firefox/WebKit smoke where feasible; real IndexedDB, two isolated browser contexts, network toggling, reload and PWA service worker scenarios.
- **Accessibility:** automated axe-style checks plus keyboard/screen-reader manual tests.
- **Deployment:** Docker Compose health, migration and backup/restore smoke.

## Key test IDs

| ID | Scenario | Must verify |
| --- | --- | --- |
| LIB-01 | Create 3 note types in nested folders | Stable UUIDs, correct source formats |
| LIB-02 | Rename/move folder | Paths update in UI; note IDs unchanged |
| LIB-03 | Illegal move into descendant | API rejects and local content remains |
| LIB-04 | Soft-delete/restore subtree | All descendant tombstones reconcile |
| LOC-01 | Edit then hard reload after local save | Content stays unchanged |
| LOC-02 | IndexedDB quota failure | No false “Saved locally”; recovery offered |
| OFF-01 | Open cached note offline, including deep-link reload | Original content editable, shell functional |
| OFF-02 | Create/rename/move/delete offline | Operations preserved and replayed |
| SYNC-01 | Reconnect and push queued ops | Server and second context agree |
| SYNC-02 | Response lost after commit | Same operationId does not duplicate write |
| SYNC-03 | Edit during in-flight op | Old ACK never clears newer content |
| SYNC-04 | Concurrent edits in two devices | Conflict, both drafts retrievable |
| SYNC-05 | Remote delete vs local edit | No lost local content |
| SYNC-06 | Expired cursor with pending outbox | Rebase without deleting unsynced edits |
| SYNC-07 | Two-tab same-note editing | Lock/takeover behavior is safe |
| ASSET-01 | Offline image then upload | Reopen online/offline with correct asset |
| ASSET-02 | Interrupted/retried asset upload | No broken references, idempotent retries |
| MD-01 | Source → render → reload → export | Raw Markdown fidelity, sanitized preview |
| TYP-01 | Offline simple math preview/PDF | Local compile and correct export |
| TYP-02 | Compiler error in invalid source | Source still saved, inline diagnostics |
| TL-01 | Draw pen stroke + shape + image | Full editable snapshot round-trip |
| TL-02 | Historical tldraw snapshot migration | Snapshot loads or recoverable error |
| AUTH-01 | Cross-account ID enumeration | Other owner's data inaccessible |
| AUTH-02 | Expired session during sync | Pending outbox unchanged |
| SEC-01 | XSS Markdown / hostile upload | Unsafe execution blocked |
| DEP-01 | Restart all containers | Persisted notes/assets survive |
| DEP-02 | Backup then restore to clean host | Full library, revisions, assets restored |

## Concurrency-specific backend tests

- Two `baseRevision=7` mutations racing: exactly one accepted, one conflict; not two silent overwrites.
- Concurrent transactions allocate change cursors in committed order; no page skips previously uncommitted events.
- Replay accepted operation ID returns original receipt, not a new revision/event.
- Recursive folder delete + independent child move have deterministic result and no orphaned foreign ownership.
- Snapshot pagination remains consistent even when mutations occur while client bootstraps.

## Mandatory verification on each phase

1. Run formatter/linter and TypeScript typecheck and `.NET` build/analyzers.
2. Run backend/unit/component tests for changed modules.
3. Run DB integration tests for API or persistence changes.
4. Run E2E journeys affected by user-facing changes.
5. Capture a manual screenshot review on desktop, tablet, and mobile when layout changes.
6. State actual pass/fail/skip counts and any unavailable environment; do not say "passed" without execution.

## MVP release gate

No high-severity auth/data-loss bugs, no blocked acceptance scenarios above, verified latest-schema DB migration, full PWA offline smoke, working tldraw production license, successful backup restore, understandable conflict recovery, and both desktop/tablet usable.

## Browser coordination regressions

After building the web app, run:

```sh
pnpm --filter @papyr/web exec playwright test e2e/multi-client.spec.ts e2e/sync-lock-retry.spec.ts --workers=1
```

These cover Markdown/Typst offline handoff, automatic recovery after closing a writer, a late mutation acknowledgment after lease replacement, and lease recovery both without Web Locks and with an unavailable browser lock. Unit tests additionally cover successor ownership, atomic recovery-copy rollback, and preserving a draft after the original note was purged.

`e2e/multi-device-real.spec.ts` requires `PAPYR_TEST_API_ORIGIN` and `PAPYR_TEST_SETUP_TOKEN` for a **fresh disposable API/database and attachment directory**. It performs initial setup (which resets that test instance), forwards browser API requests to that origin, and checks real two-device synchronization, cached account-note reload while offline, and preservation of both conflict versions. SignalR transport is not asserted by this focused test; its existing separate cross-device suite covers notification delivery. Never point this test at a retained deployment.
