# Movable comment box and pinned comments

## Problem

Two related readability gaps in the comment feature:

1. The comment popup (`CommentBubble`) always renders at a fixed offset below its pin. When it overlaps dense page content, the reader can't get it out of the way.
2. A comment pinned in empty space (no text under it) can't be repositioned once placed — the reader is stuck with the original click point.

## Scope

- The comment box (`CommentBubble`) becomes draggable by its own empty padding area. The reposition is **temporary**: closing the box (deselecting) and reopening it (reselecting) shows it back at the default anchored position.
- A comment **pinned in empty space** (`anchor.kind === "rect"`, created by clicking off any text) becomes draggable by its pin. The new position **persists** (undoable, autosaved), same as moving a memo/pen/region mark today.
- A comment **anchored on highlighted text** (`anchor.kind === "text"`) stays immovable — its pin position is derived from the text run, and moving it independently would desync from the highlighted text (mirrors why text marks are already excluded from `useEditGesture`'s move/resize).
- No change to the annotation data model, no new API surface, no new files.

## Architecture

Two independent changes:

1. **Box drag** — pure UI-local state inside `CommentBubble`. Never touches the Zustand store. "Temporary, resets on reopen" comes for free from the existing lifecycle: `AnnotationLayer` only mounts `CommentBubble` while its annotation is selected (`{a.id === selectedId && <CommentBubble .../>}`), so a fresh `useState({x: 0, y: 0})` on every mount already gives the reset-on-reopen behavior with no extra code.
2. **Pin drag** — reuses the existing move-handle gesture (`useEditGesture`), the same mechanism that already drags memo/pen/region marks and commits via `setAnnotationGeometry` (undo-tracked, autosaved). The pin `<button>` is conditionally tagged as that handle; no new gesture hook.

## Component-level design

### `CommentBubble.tsx` — box drag

- New local state: `dragOffset: {x: number, y: number}`, initialized to `{0, 0}`.
- `onPointerDown` on the bubble container: starts a drag only when `e.target === boxRef.current` — i.e. the container's own padding, not the `<textarea>` or the swatch/convert/delete buttons (those keep their normal interaction, untouched). Captures the pointer to the container so move/up events land on it directly (no document-level listeners needed).
- `onPointerMove` / `onPointerUp` (bound on the same container) update and settle `dragOffset` from the pointer delta.
- Rendered as an additional `transform: translate(${x}px, ${y}px)` on the bubble's inline style, layered on top of the existing `left`/`top` positioning (untouched). Neither of the bubble's two existing `useLayoutEffect`s (auto-grow height, clamp-to-viewport) touches `transform`, so there's no conflict — they keep controlling the *base* anchored position, this only adds a visual offset on top.
- Unclamped by design: a manual drag can push the box off-screen at the edges. Not requested, and re-selecting resets it, so no clamp logic is added (YAGNI).
- CSS: `.comment-bubble { cursor: grab }`, `.comment-bubble:active { cursor: grabbing }`; `.comment-bubble__text` and `.comment-bubble__actions` get their cursor reset back to normal so the drag affordance doesn't bleed onto controls.

### `AnnotationLayer.tsx` — `renderComment`

- Switch the anchor lookup from `a.anchor` to `effAnchor(a)` (the existing drag-preview-aware accessor every other mark already uses), so the pin — and the bubble hanging off it — live-track an in-progress drag instead of jumping only on release.
- When the live anchor's `.kind === "rect"` (pinned in empty space): add `data-edit-handle="move"` and `data-edit-id={a.id}` to the pin `<button>`, plus an `annotation-comment-pin--movable` class for a grab cursor.
- When `.kind === "text"` (comment anchored on highlighted text): no attributes, no class — pin behaves exactly as today, immovable.

### `useEditGesture.ts` — slop fix (benefits all handles, not just the pin)

- Today, `d.moved` flips `true` on *any* nonzero pointer delta during a handle drag, committing a geometry write via `setAnnotationGeometry` on release regardless of how small the movement was. This is latent-harmless today because the existing move/resize grips are drag-only controls, reachable only after the mark is already selected — there's no competing "click" interpretation.
- The pin is dual-purpose: a plain click must still `select()` the comment, while a real drag must move it. Without a slop threshold, ordinary hand tremor during a click would commit a near-zero geometry mutation (a spurious undo-step and autosave write) on every simple pin click.
- Fix: gate `moved` (and the live preview / eventual commit) behind a small **client-pixel** distance threshold from the pointerdown origin, mirroring the existing `COMMENT_CLICK_SLOP = 5` convention already used for pin-*creation* click-vs-drag in `AnnotationInteraction.tsx`. Below the threshold: no preview, no commit — the native `click` still fires, calling `select()`. Past the threshold: a real drag, computed from the *original* down-point (not the slop-crossing point) so the mark doesn't jump when the drag "starts."

## Data flow (pin drag)

`pointerdown` on a rect-kind pin → `useEditGesture`'s existing document-level `onDown` matches `[data-edit-handle]` → same `DragState` as any move grip → `onMove` past slop → `setDragPreview` → `AnnotationLayer`'s `effAnchor` picks it up for both the pin and the (if open) `CommentBubble` position, giving live visual feedback → `onUp` → `setAnnotationGeometry` (persisted, undoable) → existing `useAutosave` hook picks up the store change unchanged.

## Edge cases

- A `kind=rect` comment never has a `group_id` (`buildCommentPin` always builds single-page, `group_id: null`), so there's no cross-page sibling to keep in sync during a pin drag.
- If a drag ends with the pointer still over the pin (a small drag that "picks up and puts back down" near its origin), the native `click` may still fire and call `select()` on an already-target comment — harmless, and arguably correct (a drag naturally leaves the thing you dragged selected).
- The bubble's own local `dragOffset` (from box-dragging) and the pin's persisted anchor move independently and compose visually — dragging the pin while the bubble is manually offset just moves the anchor point the offset is relative to. No special-casing needed.
- `AnnotationLayer`'s existing `isEditable` (which excludes `type === "comment"` from the edit-*frame*, i.e. the 4 resize corner handles) is untouched — comments still never get resize handles, only the new move-via-pin affordance.

## Testing

- `useEditGesture.test.ts`: a case asserting sub-slop pointer movement does not commit a geometry change (regression coverage for the new slop).
- `AnnotationLayer` test coverage: the pin gets `data-edit-handle="move"` only when the comment's live anchor is `kind: "rect"`; a `kind: "text"` comment's pin never gets it.
- `CommentBubble` test coverage: a pointerdown+move+up on the container's padding offsets it (transform reflects the delta); the same sequence starting on the textarea or an action button does not start a drag.
- Live smoke in a real browser (fresh dev servers, per this repo's convention for pointer/drag features): drag feel for both the box and the pin, undo (Ctrl+Z) after a pin move, and that the pin's new position survives a reload (autosave round-trip). Box-drag reset-on-reopen verified by deselect/reselect in the live app.
