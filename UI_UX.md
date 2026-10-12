# UI_UX.md — information architecture and interaction flows

## Product feel

**Papyr should feel like a focused notebook, not an admin dashboard.** Clear structure, calm colors, crisp controls, spacious editor area, fast keyboard navigation, excellent pen use on tablets, no visual overload.

## Main desktop layout

```text
┌────────────────────────────────────────────────────────────────────┐
│ Papyr    [Search notes…]                      Sync ✓  Theme  User   │
├──────────────────┬─────────────────────────────────────────────────┤
│ + New note ▾     │ School / Math / Integrals                        │
│ + New folder     │ Integrals.typ          [Source|Split|Preview]   │
│                  ├─────────────────────────────────────────────────┤
│ ▾ School         │                                                  │
│   ▾ Math         │       active editor / Typst preview              │
│     Sequences.md │                                                  │
│     Integrals.typ│                                                  │
│     Diagrams.tldr│                                                  │
│ ▸ Projects       │                                                  │
│                  │                                                  │
│ Recent  Trash    ├─────────────────────────────────────────────────┤
│                  │ Saved locally · Syncing…               14:37     │
└──────────────────┴─────────────────────────────────────────────────┘
```

The visual tree represents **folders**; filenames/extensions are display hints. Note type is stored explicitly in metadata, not inferred from the title.

## Tablet and mobile

- Tablet landscape: collapsible narrow sidebar + full editor, stylus-friendly hit targets, whiteboard fullscreen.
- Tablet portrait/mobile: library navigation as drawer/stack and one primary content surface at a time.
- Whiteboard has priority to maximize canvas; floating toolbars must not obscure pen input.
- Do not show desktop split Typst preview on narrow screens: toggle editor/preview.
- Respect safe areas, virtual keyboard, touch-action, mobile navigation gestures, PWA standalone mode.

## Required screens / surfaces

1. **Initial setup / login:** explain self-hosted instance, owner setup, secure sign-in.
2. **Library:** searchable nested tree, new folder/note actions, recent notes, trash.
3. **Note editor:** breadcrumbs, title, type indicator, note actions, appropriate editor, sync status.
4. **Conflict resolver:** side-by-side or clearly labeled local/server versions with safe options.
5. **Settings:** account basics, theme, language, last sync, offline storage, manual sync, diagnostic export (non-secret).
6. **Empty states:** first note onboarding, empty folder, no search matches, no offline copy, unsupported compiler resources.
7. **Error states:** unable to save locally, quota exceeded, expired session, network unavailable, upload retry, sync conflict.

## Primary interactions

- `New note` chooser: Markdown / Typst / Whiteboard; default creates in selected folder.
- Context menu: rename, move, duplicate, delete; folder also new child folder, expand/collapse.
- Drag & drop to move with keyboard-accessible alternative; verify no parent cycles.
- Tree disclosure arrows and drag targets have clear active/hover/focus states.
- Search debounced, with source/type/folder context and helpful no-results text.
- Breadcrumb parents are clickable; unsaved local edits are committed before route changes.
- Delete goes to Trash (soft delete); provide restore and explicit permanent delete when later supported.
- Escape closes menus/modals without destructive action; confirm only destructive operations, not every save.

## Sync feedback language

Use these exact conceptual states, localized through translation keys:

| State | User-facing English | Intended meaning |
| --- | --- | --- |
| `savingLocal` | Saving on this device… | IDB transaction not finished |
| `savedLocalPending` | Saved on this device | May not be on server |
| `syncing` | Syncing… | Upload/download in progress |
| `synced` | All changes synced | Local outbox empty and latest server state applied |
| `offline` | Offline · saved on this device | Cannot currently reach server |
| `conflict` | Changes need review | Other-device edit detected |
| `syncError` | Couldn't sync · Retry | Data safe locally, remote not current |
| `quotaError` | Device storage is full | Saving locally failed; immediate recovery action |

Do not show **Synced** if there is any pending mutation, unresolved conflict, failed local commit, or missing required attachment upload.

## Navigation details

- Dedicated routes for folder and note by UUID (deep links survive rename/move).
- Restore editor viewport/scroll from local session state where appropriate.
- Confirm when opening a note already being actively edited in a second tab; single-writer or read-only prompt.
- Keyboard shortcuts should not override native editing behavior in source fields.
- All user-visible copy goes through localization keys (`cs`, `en`).

## MVP visual acceptance

At 360px, 768px, and 1440px widths: no horizontal overflow in navigation; basic actions remain visible; drawing canvas is usable; keyboard focus is clear; sync indicator is visible but not distracting; text and menus meet accessible contrast standards.
