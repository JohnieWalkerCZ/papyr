# DESIGN_RULES.md — Papyr visual system

## Design direction

A **minimal, warm, precise digital notebook**. The design should resemble a well-made writing tool, not a generic SaaS template. Prioritize function and hierarchy. Avoid aggressively rounded cards, inconsistent element heights, strong gradients, noisy backgrounds, or decorative icons without meaning.

## Core principles

1. Editor content has visual priority; chrome stays restrained.
2. Consistent spacing, typography, border radius, icon weight, interactive states.
3. Light and dark modes are first-class, not a late inversion.
4. Status color conveys actual behavior (offline/error/conflict), not decoration.
5. Folders and note types are distinguishable by icon + text, **never only color**.
6. Interaction states are apparent: hover, focus-visible, active, loading, disabled, selected, drag target.
7. Reduce animation for users with `prefers-reduced-motion`.

## Proposed tokens (adjust once centrally, not ad hoc)

```css
:root {
  --font-ui: ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-editor: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --control-height: 2.5rem;
  --sidebar-width: 17rem;
  --border-width: 1px;
}
```

Use semantic color tokens rather than raw values: `--color-surface`, `--color-surface-raised`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent`, `--color-focus`, `--color-error`, `--color-warning`, `--color-success`. Define accessible light/dark palettes and contrast-test them. The initial accent can be muted ink-blue or warm indigo; identity colors are an open design choice, not a technical dependency.

## Typography and spacing

- UI text readable at `1rem`, labels `0.875rem`, editor content configurable and at least `1rem` by default.
- Dense tree and menus may be compact; editor line-height and paragraph spacing must remain comfortable.
- Use `rem` units for spacing, widths where practical, border radii, and text; avoid sprinkling unexplained px values.
- One icon set with matching stroke weights. Folder, Markdown, Typst, and whiteboard each have a stable icon.
- Use CSS variables/tokens + scoped component styles. Do not add multiple CSS frameworks.

## Component rules

- **Header:** compact, steady position, search and sync status clear.
- **Sidebar:** minimal tree indentation, ellipsis for long titles, selected state visible, generous drag-and-drop targets.
- **Editor shell:** avoid nested cards inside cards; one primary content area, subtle dividers.
- **Menus/dialogs:** readable hierarchy, clear button labels, destructive action visually distinguished.
- **Inputs:** rectangular-soft rather than pill-shaped; same height/padding across components.
- **Toolbars:** show only contextually useful editor controls; collapse sensibly on tablets.
- **Notifications:** small, actionable, nonblocking; critical local-save failure cannot disappear as an ephemeral toast alone.
- **Loading:** avoid full-page spinners when a cached local library is available; use skeletons sparingly.

## Accessibility baseline

- WCAG 2.2 AA targets for contrast, focus, keyboard, reduced motion, touch targets as applicable.
- Semantic buttons, dialogs, menus, tree roles only when correctly implemented.
- Tooltips are supplementary; icon-only buttons always have accessible labels.
- Screen reader announcements for save/sync/conflict changes are polite and throttled.
- Test both LTR UI locales and Czech text with diacritics.

## Screenshot review checklist

Consistent spacing and alignment; consistent interactive control height; titles don't collide with actions; no unnecessary pill corners; whiteboard keeps large usable canvas; no blank layout gaps; split previews resize correctly; error/conflict messages are actionable; both themes work at mobile/tablet/desktop breakpoints.
