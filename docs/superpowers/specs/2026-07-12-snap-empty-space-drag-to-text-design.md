# Design: Snap an empty-space drag to nearest text (attempt 2)

Date: 2026-07-12
Status: Approved for planning
Supersedes the negative-spike outcome of Story 8.9 (see
`.bmad/implementation-artifacts/deferred-work.md#Discarded: Story 8.9`).

## Problem

A press-drag that STARTS in blank page space (the `.textLayer` div's own
background, right/left of a column, or a wide margin) produces no text
selection. Story 8.8 made that case an explicit no-op (an `emptyOrigin`
latch + a `selectstart` preventDefault). The user wants the drag to instead
snap its selection to the nearest text and behave like a normal on-text
drag: highlight blue live as you drag, create the mark on release, copy.

## What the failed Story 8.9 spike established (do not re-litigate)

- **Technique A dead.** `caretRangeFromPoint`/`caretPositionFromPoint`
  resolved once at pointerdown still returns the Story 3.8 corruption
  signature (empty node, offset 0) on a fraction of repeated same-session
  drags after any prior text-layer interaction. No patch. The whole
  caret-API family is off the table.
- **Technique B's resolver WORKS.** A caret-API-free resolver
  (`groupSpanLines` → `nearestLine` → `nearestSpanInLine` →
  `nearestOffsetInTextNode`, binary-searching character boundaries via
  non-collapsed single-character sub-ranges, mirroring
  `anchor/index.ts#collectTextRects`) resolved the correct nearest character
  CONSISTENTLY (5/5 repeats, no flakiness) at DPR=1.25 on the two-column
  fixture. A real bug was found and fixed inside it: pdf.js rotated glyph
  runs (margin arXiv id, `--rotate` custom property) have a page-tall
  post-transform bounding box that merged every line into one band; the
  resolver filters those out before line-grouping.
- **What actually blocked 8.9:** the browser will not ARM a native
  drag-select when the mousedown pixel misses glyph content, and a
  script-level `selection.collapse()` afterward cannot retroactively arm it.
  Confirmed with an on-glyph vs off-glyph control drag, under every
  `preventDefault` combination tried for the collapse-then-let-native-extend
  approach.

## Key reframe that unlocks attempt 2

The ENTIRE create/preview/copy pipeline already runs off the native
`window.getSelection()`:

- `annotations/gestures/useCreateQuickBox.ts` `onPointerUp` reads
  `window.getSelection()` → `rectsFromSelection` → builds the mark.
- Story 8.1 copy (`render/textSelection.ts`) reads the native selection.
- The live blue is the browser's own `::selection` paint.

So the empty-space drag does not need the browser to *arm* a selection — it
needs a real native Selection to *exist* during the drag. The 8.9 spike
only tested "collapse an anchor, let native extend." It never tested
**building the selection ourselves every move** with the working,
caret-API-free resolver. If a genuine native Selection exists during the
drag, every downstream consumer works unchanged.

## Approach: sequence A → B (a decision gate, then one of two paths)

The resolver from the 8.9 spike (`render/nearestTextAnchor.ts`, restored
verbatim including the `--rotate` filter and injectable rect readers) is
reused in BOTH paths. It was never the problem.

### Decision gate — Probe P (throwaway, live-smoke only)

On an empty-origin pointerdown: `event.preventDefault()`, resolve the
anchor, add a scoped `pointermove` that calls
`selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode,
focusOffset)` with the resolver's output for the current point.

**The single question P answers:** does a native selection FORM during the
drag AND SURVIVE pointerup, so `useCreateQuickBox` creates a mark from it?

Rationale for the `preventDefault()` on mousedown: a mousedown that did not
arm a drag-select is treated by the browser as a *click*, and the browser
collapses the selection to a caret at release — which would wipe our
built selection right before pointerup reads it. This is the most likely
identity of the undetermined "cancel-on-release regression" attempt #4 hit
(`deferred-work.md#Discarded: Story 4.2 Part B`). Because we drive the
selection ourselves, we need no native mousedown behavior at all, so
`preventDefault()` on the mousedown should suppress that release-collapse.

**Smoke matrix for P** (DPR>1, own dev servers, trusted pointer input,
REPEATED same-session drags — never a fresh-load-only test, per the 8.9
lesson): single-column empty-margin drag DOWN and UP; one cross-column
drag; confirm on pointerup `window.getSelection()` is non-collapsed and a
mark is created.

- **Selection survives release and a mark is created → Method A.**
- **Selection is collapsed/wiped on release despite `preventDefault()` →
  Method B.**

### Method A — seed a native selection during the drag (primary)

Restore `render/nearestTextAnchor.ts`. In
`render/textSelection.ts#enableGlobalListener`:

- Empty-origin `pointerdown`: resolve the anchor once.
  - Anchor found → `event.preventDefault()`, latch `snapping = true`, store
    `{ anchorNode, anchorOffset }`.
  - Anchor null (far-empty margin, past the resolver's proximity threshold)
    → keep Story 8.8's `selectstart`-suppress no-op (the fallback stays for
    a genuinely empty margin with no nearby line).
- Scoped `pointermove` while `snapping`: resolve the current point,
  `selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode,
  focusOffset)`. One resolved anchor covers both directions symmetrically
  (drag up extends the other way from the same anchor).
- `releasePointer` (the existing `pointerup`/`pointercancel`/`blur` closure)
  clears `snapping` and the stored anchor, alongside the existing
  `emptyOrigin` reset. No second global listener manager; all `{ signal }`-
  scoped, sharing the existing teardown (matches Story 8.1 / 8.8).
- The existing `selectstart`-suppress fires only for the no-nearest-line
  fallback (`emptyOrigin && !snapping`).

Everything downstream is unchanged: the native Selection stays the
render↔annotations contract exactly as it is for an on-text drag.
`useCreateQuickBox` creates the mark; Story 8.1 copy joins paragraphs; the
quick-box opens. No change to `anchor/`, `annotations/`, `store/`, the
contract, or design tokens.

**Why this is not the four reverted attempts / Story 4.2 Part B:** those
CLIPPED or post-filtered `window.getSelection()`'s native rects to a column
band, fighting the browser's contiguous range. Method A does zero clipping:
`setBaseAndExtent` produces the plain native contiguous range, identical to
what native would give for an on-text drag between the same two points,
just seeded from a resolved anchor instead of a mousedown hit-test. There
is no column/line logical model and no per-move rect filtering.

**Deliberately crossing 8.9's scope guard:** Story 8.9's Dev Notes forbade
"drive the selection yourself in `pointermove`." That guard was scoped to
the 8.9 spike's budget, and its RATIONALE was the clipping regressions of
the reverted attempts. Method A drives selection per-move but never clips,
so the rationale is still honored. We cross the per-move line deliberately,
with the failure history in view, and document it here so a future reader
knows it was an eyes-open decision, not a repeat of the reverted class.

### Method B — deterministic, never trust native (fallback)

Only if P shows the release-collapse cannot be beaten.

- Same resolver. `render/` publishes the live drag's resolved endpoints
  (a store field in the shape of the existing `dragPreview`), so the
  render layer never reaches up into React.
- A React hook in `annotations/` subscribes and renders OUR OWN preview
  highlight, reusing `useCreateQuickBox`'s existing `previewRects` /
  `pendingGeometry` machinery (which already draws position-fixed,
  zoom/scroll-tracked preview rows).
- Extract `rectsFromRange(range, pages, scale, rectsOf)` from
  `rectsFromSelection` (the latter becomes a thin wrapper that loops the
  selection's ranges and delegates). On release, build the mark from a
  `Range` constructed from the stored endpoints via `rectsFromRange` — the
  same trusted, leak-safe `collectTextRects` geometry, no native Selection
  involved.
- Copy-during-drag is skipped in B (the mark is created and selected on
  release; live copy of an un-released snap is a niche case). Documented,
  not silently dropped.

Method B is more code and crosses the render→anchor seam through a defined
interface (endpoints via the store, `rectsFromRange` in `anchor/`), but is
fully deterministic — immune to every native-selection quirk (poison,
arm-on-mousedown, release-collapse).

### Method C — rejected

Extending the pdf.js text layer's selectable content into the margin
(transparent per-line filler) so an off-glyph mousedown lands on a real
text position and native arms itself is conceptually cleanest (native does
100%), but invasive to the text layer and high-risk for the full-page-rect
/ highlight-leak class the anchor layer guards against. Not pursued unless
A and B both fail.

## Components and layering

- `client/src/render/nearestTextAnchor.ts` (new/restored): the pure
  resolver. Local to `render/`, imports nothing from `anchor/` (AD-9). Rect
  readers injectable for jsdom unit tests. Functions: `groupSpanLines`,
  `nearestLine`, `nearestSpanInLine`, `nearestOffsetInTextNode`,
  `resolveNearestTextPoint`, plus the `--rotate` span filter.
- `client/src/render/textSelection.ts` (modified): the empty-origin gate.
  Method A adds the `snapping` latch + scoped `pointermove` +
  `setBaseAndExtent`, sharing the existing `releasePointer` teardown.
- Method B only: `client/src/anchor/index.ts` gains `rectsFromRange`
  (extracted from `rectsFromSelection`); a store field + a React hook in
  `annotations/` for the live preview + create-on-release.
- Not re-exported from the `render/` barrel (like `textSelection.ts` /
  `paragraphCopy.ts`), so Reader/App test mocks need no change.

## Testing

- **Unit (Vitest/jsdom):** the pure resolver functions with injected rect
  readers (jsdom has no real Selection geometry / layout, so the snap
  behavior itself and `setBaseAndExtent` are NOT jsdom-assertable). Cover
  the `--rotate` filter, line-band grouping, preceding-line tiebreak,
  nearest-span, and the offset binary search. Do not weaken the existing
  `isEmptyLayerSpace` / `pointercancel` tests.
- **Live smoke (the real acceptance gate)** — DPR>1, own fresh
  `uvicorn` + `vite dev`, trusted pointer input, REPEATED same-session
  drags, on the two-column fixture:
  - Empty right-margin drag next to text snaps and selects from the nearest
    line, drag-down and drag-up.
  - Empty cross-column gutter drag does NOT leak a cross-column or
    full-page highlight (`collectTextRects` guard holds — Story 8.8 AC-5).
  - On-text single-line, multi-line, and CROSS-PAGE drags still
    select + highlight on release (Story 8.8 AC-2); Ctrl+C still copies with
    the Story 8.1 paragraph-join intact.
  - The far-empty-margin case (no nearby line) still no-ops (Story 8.8
    fallback preserved).

## Scope guards (explicit)

- No column-aware clipping or post-filtering of native selection rects
  (the reverted-attempts failure class).
- No caret-API family (`caretRangeFromPoint`/`caretPositionFromPoint`) —
  dead per the 8.9 spike.
- Method A's per-move `setBaseAndExtent` is a deliberate, documented
  crossing of 8.9's spike-budget guard; it never clips, so the guard's
  rationale is preserved.
- No new FR unless the implementation validates in live smoke (mirrors how
  8.2-8.4 earned their FRs only once committed). If P fails and B also
  fails live smoke, Story 8.8's no-op stays shipped and the negative result
  is appended to `deferred-work.md` — a complete, acceptable outcome.

## Process

Story 8.9 was closed as a negative spike. This work should become a fresh
BMad story (8.11, or an explicit reopen of 8.9) via `bmad-create-story`
before implementation, so `sprint-status.yaml` stays honest. This design
doc is the input to that story and to the implementation plan.
