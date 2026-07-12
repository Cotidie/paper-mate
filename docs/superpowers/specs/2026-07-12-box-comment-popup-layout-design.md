# Box comment popup: beside the highlight, not over it

## Problem

A **box comment** (Story 8.4: drawing a rectangle under the Comment tool's Box mode) creates a real filled region plus a pin at its top-left. Today, both `CommentBubble` (selected/full editor) and `CommentPreview` (hover glance) position themselves off that same top-left point plus a small fixed downward offset (`PIN_OFFSET_TRANSFORM`, sized for a round pin icon) — a treatment built for a *point* pin, not a *box* with real width/height. For any box comment taller than that fixed offset, the popup renders overlapping the highlighted region instead of beside it (user fix request, reference screenshots: Google Sheets' comment card sits beside the selected cell; the current in-app popup sits on top of the highlight).

The user also wants the popup's own chrome (color swatches + delete) moved out of the box into a vertical strip beside it, mirroring the layout `MemoBox`'s selection quick-box already uses on its left side — leaving the comment's own box as just a compact textarea.

## Scope

- Applies **only** to box comments: `type=comment`, `anchor.kind=rect` with **real area** (`rect.x1 > rect.x0 && rect.y1 > rect.y0`). A click-placed pin comment (`buildCommentPin`'s degenerate point rect, `x0===x1, y0===y1` exactly — `COMMENT_CLICK_SLOP`-gated in `useCreateQuickBox.ts`) and a text-drag comment (`anchor.kind=text`) are **unaffected**, pixel-for-pixel — they keep today's below-the-pin popup with the full internal color/convert/delete chrome.
- Applies to **both** the selected editor (`CommentBubble`) and the hover preview (`CommentPreview`) for a box comment.
- The corner-handle resize (Story 8.6, persisted `style.bubble_width`/`bubble_height`) is kept, just repositioned.
- No annotation-model or API-contract change; no new persisted fields (the layout is derived purely from the existing anchor rect + a live-kind check).

## Architecture

Reuses the mechanism `MemoBox`'s own left-side action strip already established, rather than building a second one:

1. **`marks.ts` — `quickBoxSpec(anno)`**: already takes the full `Annotation`, not just its type, but today ignores anchor shape for comment (`usesBubble: true` unconditionally). It gains a live-kind check: `usesBubble` is `true` for a text-kind or degenerate-point comment (self-contained `CommentBubble`, unchanged), `false` for a real-area box comment (routes through the shared selection quick-box instead). This makes the file's existing doc comment — "the quick-box spec keys on `type` only... no live-kind read is needed" — no longer accurate for comment; the comment is updated to note comment as the one exception, and why.
2. **`gestures/useSelection.ts`**: `isMemoSelected` (today used for (a) shifting the quick-box left by its own measured width, and (b) *not* stealing focus into the quick-box because the mark owns its own text-entry surface) generalizes to also cover a selected box comment — same shift-left math (already generic on `anchor.kind === "rect"`), same "don't steal focus" reasoning (the box comment's own textarea autofocuses, same as `CommentBubble` does today).
3. **`AnnotationInteraction.tsx`**: the `.quick-box--vertical` class condition (today `selectedAnno.type === "memo"`) extends to also match a selected box comment. `CommentBubble`/`CommentPreview` continue to be mounted for comments as today, but for a box comment they render in "compact" mode (see below) and position to the box's **right** edge instead of the pin-offset transform below it.
4. **`CommentBubble.tsx` / `CommentPreview.tsx`**: each gains a `compact` boolean prop (`true` for a box comment). When `compact`:
   - Skip the internal `ColorSwatchRow` / convert-to-highlight / delete (never rendered for `kind=rect` with area anyway per D1, but now recolor/delete are ALSO gone, since the shared quick-box owns them) — renders only the textarea (+ resize handle for `CommentBubble`).
   - Render at `pos.left`/`pos.top` directly, with **no** `PIN_OFFSET_TRANSFORM` — the shift to the box's right edge is computed once by the caller (`AnnotationInteraction.tsx`, see below), not inside these components. Non-`compact` render is untouched (`pos.left`/`pos.top` + `PIN_OFFSET_TRANSFORM`, as today).
   - The existing viewport-clamp effects (already present in both components) are untouched — they clamp whatever position is set, same as today; no side-flipping logic is added (not requested, mirrors `MemoBox`'s own clamp-only behavior).
5. **`position.ts`**: gains the shared gap constant (moved from its current private home in `useSelection.ts`, see below) so both the quick-box's left-shift and the compact comment's right-shift read one definition.
6. **`Annotations.css`**: no new class for the strip (reuses `.quick-box--vertical` verbatim); no new class needed for the compact box's position either, since that's plain inline `left`/`top` like today. No raw values added (tokens only, per `no-raw-values`).

## Component-level design

### `marks.ts`

```ts
function isBoxComment(anno: Annotation): boolean {
  return (
    anno.type === "comment" &&
    anno.anchor.kind === "rect" &&
    anno.anchor.rect.x1 > anno.anchor.rect.x0 &&
    anno.anchor.rect.y1 > anno.anchor.rect.y0
  );
}

export function quickBoxSpec(anno: Annotation): QuickBoxSpec {
  const base = MARK_DESCRIPTORS[anno.type as AnnotationTool].quickBox;
  if (anno.type === "comment") return { ...base, usesBubble: !isBoxComment(anno) };
  return base;
}
```

`isBoxComment` is exported from `marks.ts` — the single existing home for "branch by annotation kind/type" facts (AD-5) — and imported by `useSelection.ts` and `AnnotationInteraction.tsx`, so the "is this comment compact" check has exactly one definition.

### `position.ts`

- `QUICK_BOX_GAP` moves here from its current private `const` in `useSelection.ts` (same value, 6), exported so both the left-shift (quick-box) and right-shift (compact comment) computations import one definition instead of duplicating the number.
- New pure, exported helper alongside `clampToViewport` (same "DOM-free, unit-testable" module convention): `rightOf(rect: ScreenRect, gap = QUICK_BOX_GAP): Point` returning `{ x: rect.left + rect.width + gap, y: rect.top }`. `AnnotationInteraction.tsx` calls this once for a compact comment's `pos`; the shift itself is unit-tested here, not re-derived at each call site.

### `useSelection.ts`

- Imports `QUICK_BOX_GAP` from `position.ts` instead of declaring its own.
- Rename `isMemoSelected` → `usesLeftVerticalQuickBox` (or similar), computed as:
  ```ts
  const usesLeftVerticalQuickBox =
    selectedAnno?.anchor.kind === "rect" &&
    (selectedAnno.type === "memo" || (selectedAnno.type === "comment" && isBoxComment(selectedAnno)));
  ```
- Every existing use site (the `repositionBox` shift, the focus-steal guard) swaps in the renamed value unchanged — same behavior, just no longer memo-only.

### `AnnotationInteraction.tsx`

- `className={usesLeftVerticalQuickBox ? "quick-box quick-box--vertical" : "quick-box"}` (renaming the existing memo-only ternary to read off the hook's now-shared flag).
- `selectedComment`/`commentPreviewMarks` rendering: pass `compact={isBoxComment(a)}` to both `CommentBubble` and `CommentPreview`. When compact, the `pos` passed down is pre-shifted: `commentScreenPoint(a)` still returns the raw anchor rect as today, and `rightOf(raw)` (see `position.ts` below) computes the shifted point before it's handed to the component — so `CommentBubble`/`CommentPreview` never need to know about `width`/gap math themselves, only "render at `pos`, with or without the pin-offset transform." For `onRecolor`/`onConvertToHighlight`/`onDelete`: still wired to the same store actions as today, just now invoked from the SHARED quick-box's `recolorSelected`/`deleteSelected` (already present for every other mark type) instead of `CommentBubble`'s own buttons — no new store actions needed. Convert-to-highlight has no box-comment counterpart (D1, Story 8.6) and stays gated to text-kind comments only, so it never appears in the shared quick-box for a comment (the existing `selectedAnno.type === "highlight"` convert button is unrelated and untouched; no comment-side convert button is added to the shared quick-box).

### `CommentBubble.tsx` / `CommentPreview.tsx`

- New `compact?: boolean` prop.
- When `compact`, the render tree drops `ColorSwatchRow`, the convert button, and the delete button (and, for `CommentPreview`, nothing changes there since it never had them) — `CommentBubble`'s JSX shrinks to the drag-move wrapper (Story "comment-drag" design, unaffected — box comments are `kind=rect` non-degenerate so were never draggable-by-pin anyway, only degenerate pins are; box drag-to-move is out of scope here) + textarea + resize handle.
- `CommentBubble`'s existing `onPointerDown`/`onKeyDown` container handlers (Esc/Delete, drag) are conditioned off `compact` where they reference the now-removed action buttons (e.g. the `.closest("textarea, button")` drag-exclusion still works unchanged since the resize handle is still a `<button>`).
- Positioning: `compact ? { left: pos.left, top: pos.top } : { left: pos.left, top: pos.top, transform: PIN_OFFSET_TRANSFORM }` — the caller (`AnnotationInteraction.tsx`) has already shifted `pos` to the box's right edge before it reaches here, per above.

## Data flow

No new data flow — `pos` (a `ScreenRect` with `width`/`height`) is already computed by `commentScreenPoint` today; this change adds one small shift step in `AnnotationInteraction.tsx` (using the `width` field for box comments instead of ignoring it) before that same `pos` reaches `CommentBubble`/`CommentPreview`, and swaps which component (shared quick-box vs. `CommentBubble`) owns the recolor/delete calls into the existing, unchanged store actions (`recolorAnnotation`, `deleteAnnotation`).

## Edge cases

- A box comment resized very wide/tall: the right-side textarea's position is independent of the box's own size (same as today — the popup's size and the anchor rect's size have always been unrelated), so no interaction with Story 8.6's persisted `bubble_width`/`bubble_height`.
- A box comment near the right viewport edge: existing clamp logic nudges the textarea back on-screen (may end up overlapping the box in extreme cases, same tradeoff `MemoBox`'s left-shift-then-clamp already accepts — not a regression, not fixing what wasn't asked).
- Multi-page / group-aware comments: box comments are always single-page (`buildCommentPin`/box-drag builder never sets `group_id`), so no cross-page sibling sync concern (mirrors the existing "comment-drag" design's same observation).
- A comment converted TO a box comment or vice versa doesn't exist as a gesture today (conversion is text-highlight ⇄ text-comment only, D1/Story 3.7) — no transition state to handle.

## Testing

- `marks.test.ts`: `quickBoxSpec` returns `usesBubble: false` for a real-area rect comment, `true` for a degenerate-point or text-kind comment.
- `position.test.ts`: new `rightOf` cases (offsets by width + gap, `y` unchanged, default gap value).
- `CommentBubble.test.tsx` / `CommentPreview.test.tsx`: a `compact` box comment renders no color row / convert / delete, renders at exactly the given `pos.left`/`pos.top` with no transform; a non-compact comment (pin or text) is unchanged from today's assertions.
- `AnnotationInteraction.test.tsx`: selecting a box comment shows the shared quick-box (vertical, left of the anchor) with working recolor/delete, and passes the compact comment its `rightOf`-shifted `pos`; a pin/text comment selection still shows the self-contained bubble at its unshifted `pos`, as today.
- Live smoke at DPR>1 (this repo's standing convention for any selection/positioning feature): draw a box comment near page center — left strip and right textarea both clear of the highlight, resize + recolor + delete all work from their new locations; draw one near a viewport edge — clamp keeps both pieces on-screen; hover (not select) the same box comment — preview also sits beside it; verify an ordinary click-pin comment and a text-drag comment are pixel-for-pixel unchanged.
