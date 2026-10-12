# EDITORS.md — Markdown, Typst, and tldraw

## Shared editor contract

Every editor implements an adapter interface representing **load → edit → persist locally → sync → restore → export**. The library shell owns note identity, title, type, folder, save state, and navigation; an editor owns content editing and rendering only.

Conceptual adapter contract:

```ts
interface NoteEditorAdapter<TContent> {
  load(content: TContent, schemaVersion?: string): Promise<void>;
  getContent(): TContent;
  onContentChanged(callback: (content: TContent) => void): () => void;
  focus(): void;
  destroy(): void;
}
```

Actual types may refine lifecycle, asset references, serialization, and large-drawing performance. Never couple editors directly to REST mutations; editor events go to the common local persistence/sync service.

### Shared behavior

- Debounced IndexedDB commit; local save state is visible and does not block typing.
- Undo/redo remains editor-local and never corrupts already committed local data.
- Title edit, rename, move, delete, restore are shell actions using same outbox.
- Keyboard commands: `Ctrl/Cmd+S` forces local flush and attempts sync, `Ctrl/Cmd+Z` undo in editor; preserve platform conventions.
- No silent source transformations or loss of unsupported content.
- Accessibility, focus retention, dirty note switch handling, loading/empty/error states.
- Lazy-load editor bundles to reduce initial app startup cost; pre-cache required offline modules.

## Markdown (`type=markdown`)

- Source of truth: **UTF-8 Markdown string** (not parsed DOM, not generated HTML).
- Source editor with syntax highlighting, indentation, line numbers toggle, search, undo/redo.
- Preview modes: source, split, preview; maintain scrolling and selection sensibly.
- Support common Markdown syntax: headings, lists, tables, links, fenced code, blockquotes, checklists, images, inline code, and common math delimiters **if a maintained renderer is adopted**.
- Sanitize rendered HTML and links; no uncontrolled script, `javascript:` URLs, arbitrary embed frames, or unsafe plugin execution.
- Relative/pasted images become Papyr attachment IDs; resolve locally offline and through authenticated API online.
- Export original `.md`, not HTML generated from it. For optional PDF export record a later feature decision.

## Typst (`type=typst`)

- Source of truth: **Typst source string**, retaining original syntax and whitespace.
- CodeMirror-based editor with useful language support if available, line/column errors, and keyboard accessibility.
- Preview: compile in browser worker/WASM **after prototype validates the candidate**, so typing cannot block the main UI thread. Debounce compile separately from local save; compilation failures must not prevent saving source.
- Export an actual PDF generated locally where supported. Provide downloadable `.typ` source regardless of preview availability.
- Compile engine assets (WASM, fonts needed for common math, workers) must be bundled/cached for offline use. Show an explicit diagnostic when additional fonts/packages/assets are unavailable offline; do not silently call an external Typst service.
- User assets referenced by Typst must be resolved through a controlled virtual file/access layer, not arbitrary filesystem reads or network requests.
- Version/compiler issues: keep compiler runtime pinned and maintain a smoke document covering fractions, symbols, tables, Unicode/Czech diacritics, images, pagination, PDF output.
- If offline browser compilation proves infeasible, block the release criterion and file an ADR for an explicitly documented protected **self-hosted** fallback; do not quietly degrade offline preview.

## Whiteboard (`type=whiteboard`)

- Use **tldraw SDK** with pen, touch, mouse, shape/arrow/text tools, zoom/pan, infinite canvas and pressure behavior where supported.
- Canonical content: versioned **tldraw document snapshot**, including pages/shapes/bindings/asset metadata as required by the SDK. Do **not** save only PNG, SVG, or screenshot.
- Session/camera/selection data is device-specific: store locally, do not sync as part of note canonical revision by default.
- Integrate tldraw through controlled store/snapshot APIs with Papyr's local save/outbox. Avoid using a standalone SDK `persistenceKey` as an independent authority that may diverge from Papyr's persisted note.
- Use store events and throttled snapshot serialization to prevent each stylus sample from creating a large IDB write. Verify loss behavior when closing during an active stroke.
- Import/image attachments must use Papyr's asset pipeline. Blob URLs should not become canonical permanent content; use stable attachment references and safe asset URL resolvers.
- On SDK upgrade, test schema migrations against saved historical snapshots.
- If available, export PNG/SVG and underlying JSON (for backup/diagnostics); canonical save remains editable snapshot.
- Add an unobtrusive drawing fullscreen mode for tablets; do not force sidebar/tree over the canvas.
- Production release requires a valid applicable **tldraw license key** and adherence to current license terms. Local development may work without it but is not proof of legal or technical production readiness.

## Editor acceptance matrix

| Test | MD | Typst | Whiteboard |
| --- | :---: | :---: | :---: |
| Create/load exact source/document | ✓ | ✓ | ✓ |
| Reload offline after local commit | ✓ | ✓ | ✓ |
| Undo/redo without corrupt save | ✓ | ✓ | ✓ |
| Other-device sync preserves content | ✓ | ✓ | ✓ |
| Two-device conflict preserves both | ✓ | ✓ | ✓ |
| Notes with images/attachments | ✓ | ✓ | ✓ |
| Export native source | `.md` | `.typ` | snapshot JSON |
| Rendered export | preview | PDF | PNG/SVG (subject to SDK support) |

## Sources to consult before implementing

- https://tldraw.dev/sdk-features/persistence
- https://tldraw.dev/sdk-features/license-key
- https://typst.app/docs
- https://typst.app/docs/reference/pdf/
