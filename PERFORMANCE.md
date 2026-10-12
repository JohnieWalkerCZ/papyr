# PERFORMANCE.md — offline reliability and performance budgets

The numbers below are **engineering targets for a prototype**, not measured performance promises. Profile on a mid-range Android tablet and a common desktop browser; amend targets after evidence.

## Goals

- Cached app shell opens and shows local library without waiting for API.
- Input latency remains responsive while edits are serialized/saved.
- Text editing does not trigger a network request per keystroke.
- A whiteboard with typical school diagrams remains smooth on stylus input.
- Server cold start, network unavailability, and large libraries show progressive UI rather than blocking the editor.

## Initial targets

| Metric | Initial target |
| --- | --- |
| Cached library first interactive on a mid-range tablet | ~2 seconds when storage is warm |
| Folder expand / note switch to cached note | perceptually immediate; <200ms target for simple content |
| Local-save acknowledgment | ordinarily <500ms after debounce, not blocking keystrokes |
| Sync after idle | start after ~5 seconds without edits |
| Search by title in a moderate local library | <200ms p95 target |
| Typst compile | debounced, cancellable, performed off main thread |
| Whiteboard snapshot save | bounded/throttled, measurable under sustained pen input |

## Data and lifecycle practices

- Virtualize large folder lists/search results if the real library size warrants it.
- Keep editor bundles lazy and avoid rendering all note types at startup.
- Cache compiled/preview results separately from authoritative source; never use preview as canonical data.
- Throttle tldraw serialization and mutation coalescing without risking uncommitted changes on route switch.
- Do not preload all large image blobs on every bootstrap; lazy-fetch assets and preserve chosen offline cache rules.
- Keep server responses paginated; note bodies may be included in initial bootstrap in chunks for offline use.
- Support backpressure and cancellation for render/compile tasks; prefer workers for CPU-intensive work.
- Do not aggressively purge downloaded content or dirty notes without explicit user action.
- When browser storage is limited, protect pending outbox/drafts before clean remote caches.

## Telemetry without tracking

Use development-only performance markers/console metrics without copying note content. Production analytics/telemetry are opt-in future decisions. Add a settings diagnostics panel exposing sync queue size, last successful sync time, and local storage estimate when browser supports it.

## Profiling fixtures

Small library: 30 notes, three types. Medium: 1,000 notes, 200 nested folders. Large synthetic: 10,000 notes, 1,000 folders, mixed types and attachments (stress scenario, not MVP scale promise). Whiteboard fixtures: 100, 1,000, 5,000 shapes, with and without images. Ensure reproducible scripts generate only synthetic content.
