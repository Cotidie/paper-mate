# Library table: hover Open button replaces click-to-open

## Problem

Story 6.6 made the Title/Authors cells click-to-edit. That collided with the pre-existing 6.3 row gesture (click arms/selects a row, a second click on the already-armed row opens it): 6.6 worked around it by leaving open reachable only via a second click on a *non*-editable cell (Added/File type), an acknowledged rough edge. The user wants a cleaner fix, referencing an Anara screenshot: hovering a row reveals an explicit **Open** button inline in the Title cell.

Story 6.7 (planned, backlog, not yet started) currently specs "double-click a row (or focus it and press Enter) opens it" as its own open-gesture AC. The user confirmed (via brainstorming) that the hover-Open-button design should **replace** that planned double-click gesture outright, not sit alongside it.

## Scope

- Row click keeps arming/highlighting a row (`aria-selected`), purely visual, no consumer yet beyond the existing CSS treatment. It **no longer opens** on a second click; opening decouples from row-click entirely.
- A new **Open** button renders inside the Title cell only (not Authors), revealed on row hover or on the button's own keyboard focus. Clicking it (or focusing it and pressing Enter/Space) navigates to `/reader/:docId`, exactly like `onOpenRow` does today.
- Applies to every real row regardless of `status` (an `extracting` row stays openable today per existing 6.5 behavior, unaffected). Never rendered for `pendingRows` (no `doc_id`, already a separate render path with no interaction at all).
- Title/Authors click-to-edit (Story 6.6) is unchanged: clicking the cell's text still edits; the button is a distinct sibling element that intercepts its own click before it reaches the cell's edit-click handler.
- No backend change. No new `/api` surface.
- Companion doc update: `epics.md` Story 6.7's AC #1 text changes from "double-click (or focus + Enter)" to the hover-button plus keyboard-focus gesture, since this change delivers that AC ahead of 6.7's own formal planning. Tracked as a standalone fix now, not run through `bmad-create-story`/`bmad-dev-story` for 6.7.

## Architecture

Single component touched for behavior (`CollectionTable.tsx`), one CSS-only reveal mechanism (`CollectionTable.css`), plus a companion planning-doc edit (`epics.md`). No new component needed: the Open button is small enough to live inline in the existing Title-cell render branch, not a new file.

1. **`handleRowClick` simplifies**: drops the `selectedId === docId` open-branch; the click handler purely toggles `selectedId` (arm/select, no side effect beyond the CSS highlight).
2. **Open button**: a real `<button>` rendered as a sibling to the title text in the Title cell's *static* (non-editing) render branch, inside `EditableCell`'s `!isEditing` return, title field only. Reveal is CSS-only: hidden by default, shown via `tr:hover` or the button's own `:focus-visible`, no JS hover-state tracking (matches this file's existing `tr:hover` pattern for row highlighting).
3. **Click isolation**: the button's own `onClick` calls `stopPropagation()` before invoking `onOpenRow(docId)`, same pattern `InlineEditor`'s `<input>` already uses. Stopping propagation at the button prevents the event from ever reaching the Title `<td>`'s edit-click handler or the `<tr>`'s arm/select handler, regardless of DOM nesting order.

## Component-level design

### `CollectionTable.tsx`

- `handleRowClick(docId)` becomes: `setSelectedId((prev) => (prev === docId ? null : docId))`, arm/select toggle only. `onOpenRow` is no longer called from here.
- The Title cell's static-content branch (inside `EditableCell`, rendered when `!isEditing`) gains a sibling `<button>` after the title text/placeholder:
  ```tsx
  <span className="collection-table__title-text">{displayTitle ?? <span className="collection-table__untitled">Untitled</span>}</span>
  <button
    type="button"
    className="collection-table__open-button"
    onClick={(e) => {
      e.stopPropagation();
      onOpenRow(docId);
    }}
  >
    Open
  </button>
  ```
  Wrapping the title text in its own `<span>` is necessary so the ellipsis truncation (`text-overflow: ellipsis; white-space: nowrap`) applies to the text alone, not the whole flex row (button included). The cell becomes a flex container (`display: flex; align-items: center; gap: var(--space-xxs)`); text span `min-width: 0; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto`; button `flex: 0 0 auto`. No `aria-label` needed: the button's own visible text ("Open") already supplies its accessible name.
- `EditableCell`'s existing `onClick`/`onKeyDown` (enter-edit) stay on the `<td>` itself, unchanged. The button is simply a new child that stops the event before it bubbles that far.
- Button only renders for the Title field (`field === "title"`), and only in the non-editing branch: never alongside `InlineEditor`, never in the Authors cell, never for `pendingRows` rows (that render path is untouched, still no interactive children).
- No new prop: `onOpenRow` keeps its existing signature and owner (`LibraryPage`).

### `CollectionTable.css`

- `.collection-table__open-button`: hidden by default (`opacity: 0; pointer-events: none;`, not `display: none`, so it stays in the accessibility/focus tree, and a `transition: opacity` reads as a fade), token-only styling matching the row's existing ink/hairline language (`background: var(--color-surface-card); color: var(--color-ink); border: var(--hairline-width) solid var(--color-hairline-strong); border-radius: var(--radius-sm); padding: var(--space-xxs) var(--space-xs); font: ...`, mirroring `.collection-table__edit-input`'s token set from Story 6.6).
- Reveal: `.collection-table tbody tr:hover .collection-table__open-button, .collection-table__open-button:focus-visible { opacity: 1; pointer-events: auto; }`. Hover-anywhere-in-row reveals it (matches the reference screenshot's behavior, not just hovering the Title cell); keyboard focus reveals it independent of hover (standard accessible disclosure pattern, since a `:hover`-only reveal would make it unreachable by keyboard).
- `.collection-table__title` (the cell) gains `display: flex; align-items: center; gap: var(--space-xxs);`; the new `.collection-table__title-text` inner span carries the truncation rules moved off the `<td>` itself.

### `epics.md`

- Story 6.7 AC #1 text updated: "**Given** a table row, **when** I hover it and click the Open button it reveals (or Tab to the button and press Enter/Space), **then** the app navigates to `/reader/:docId` for that paper", replacing the double-click wording. Rest of Story 6.7 (hydrate PDF plus annotations, `last_opened` update) is unaffected; those ACs still belong to whenever 6.7 itself is formally planned/built. This fix only changes the *gesture*, not the reader-hydration behavior, which isn't touched here.

## Edge cases

- **Row never hovered (touch/keyboard-only user who never focuses the button):** the button is unreachable by click but still Tab-reachable (native `<button>`, real DOM position), no dead end, just a slightly longer Tab path than clicking would be. Acceptable; matches the "keyboard focus also reveals" rule above.
- **Button focused while its row's Title cell is *also* being edited:** can't happen. The button only renders in the non-editing branch (`!isEditing`), so entering edit mode unmounts it (`InlineEditor` replaces the whole cell content, per 6.6's existing `EditableCell` branch).
- **`extracting` row:** stays openable (button renders and works) even though its Title/Authors cells are not editable, matching existing 6.5 behavior (an extracting row was already selectable/openable pre-6.6).
- **Very long/truncated titles:** button never gets pushed off-cell or overlapped. Flex layout reserves its `flex: 0 0 auto` width unconditionally; text truncates in the remaining space.
- **Rapid hover-in/hover-out (mouse passing over the row without stopping):** pure CSS opacity transition, no JS state to get stuck, nothing to clean up on unmount/rapid re-render.

## Testing

- `CollectionTable.test.tsx`:
  - An Open button exists per real row (Title cell), not per pending row.
  - Clicking the Open button calls `onOpenRow(docId)`. Does **not** enter edit mode (no `InlineEditor` mounts) and does not toggle `aria-selected`.
  - Clicking elsewhere in the Title cell (the text, not the button) still enters edit, unchanged from 6.6.
  - Clicking a non-title cell (e.g. Added) still only arms/selects (`aria-selected` toggles); a **second** click no longer calls `onOpenRow` (this replaces the existing 6.3 "opens on a second click" test, which needs updating to reflect the new decoupled behavior).
  - An `extracting` row still renders a working Open button (regression: matches existing 6.5 "extracting row stays openable" case, now via the button instead of second-click).
  - Keyboard: focusing the button and pressing Enter (or Space) calls `onOpenRow`.
- Live smoke (own fresh dev servers per this repo's CLAUDE.md convention): hovering a row reveals the Open button with a visible fade-in; clicking it opens the reader; Tab reaches the button and Enter opens it; clicking the Title text (not the button) still enters edit; an `extracting` row's Open button still works.
