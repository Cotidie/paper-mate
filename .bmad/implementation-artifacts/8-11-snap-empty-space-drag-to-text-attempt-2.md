# Story 8.11: Snap empty-space drag to nearest text (attempt 2)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a drag that starts in empty page space to snap its selection to the nearest text and behave like a normal on-text drag (highlight live, create on release, copy),
so that the gesture works the way I'd expect on a page with visible text nearby.

## Context: why this exists and what is already proven

Story 8.9 was a spike that closed NEGATIVE (see `deferred-work.md#Discarded: Story 8.9`). It is NOT reopened; this is a fresh attempt built on the spike's findings and an approved design (`docs/superpowers/specs/2026-07-12-snap-empty-space-drag-to-text-design.md`, the AUTHORITATIVE spec for this story). Read that spec first.

**Settled by the 8.9 spike (do not re-litigate):**

- **The caret-API family is DEAD.** `caretRangeFromPoint`/`caretPositionFromPoint` resolved even ONCE at pointerdown still returns the Story 3.8 corruption (empty node, offset 0) on a fraction of repeated same-session drags. Do NOT use it anywhere in this story.
- **The resolver WORKS.** A caret-API-free nearest-text resolver was prototyped, live-smoked, and resolved the correct character CONSISTENTLY (5/5 repeats, no flakiness) at DPR=1.25 on the two-column fixture. It was reverted with the rest of the spike but is the starting point here — restore it. A real bug was found and fixed inside it: pdf.js rotated glyph runs (margin arXiv id, `--rotate` custom property) have a page-tall post-transform bounding box that merged every line into one band; the resolver must filter those out before line-grouping.
- **The actual 8.9 blocker:** the browser will not ARM a native drag-select when the mousedown pixel misses glyph content, and a script `selection.collapse()` afterward cannot retroactively arm it.

**The reframe that unlocks this story:** the entire create/preview/copy pipeline already runs off native `window.getSelection()` (see Dev Notes). So the fix does not need native to ARM a selection — it needs a real native Selection to EXIST during the drag. The 8.9 spike never tested building the selection ourselves each move with the working resolver. That is Method A.

## Acceptance Criteria

1. **Decision gate (Probe P), first, throwaway, live-smoke only.** Before any production wiring, prototype seeding a native selection during an empty-origin drag: on empty-origin pointerdown call `event.preventDefault()`, resolve the anchor via the restored caret-API-free resolver, and on each `pointermove` call `selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)` for the resolver's output at the current point. Live-smoke at DPR>1 on `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf`, own fresh dev servers, trusted pointer input, across REPEATED same-session drags (NOT fresh-load-only — the caret lesson). **The single question P answers:** does the native selection form during the drag AND survive `pointerup` so `useCreateQuickBox` creates a mark from it? Record the exact observed result. **Selection survives release and a mark is created → Method A (AC 3). Selection is collapsed/wiped on release despite `preventDefault()` → Method B (AC 5).**

2. **Restore the resolver (used by BOTH paths).** `client/src/render/nearestTextAnchor.ts` holds the caret-API-free resolver, LOCAL to `render/` (AD-9: imports nothing from `anchor/`/`annotations/`/`store/`). It: filters out `--rotate` (rotated) glyph spans; groups the origin `.textLayer`'s glyph spans into vertical line bands; picks the nearest band to the pointer Y (preferring the PRECEDING line when equidistant); picks the nearest glyph span to the pointer X within that band; binary-searches the nearest character offset within that span's text node using NON-collapsed single-character sub-ranges + `getClientRects()` (mirroring `anchor/index.ts#collectTextRects`'s per-text-node measurement, replicated locally, NOT imported). Rect readers are injectable so the pure logic is jsdom-unit-testable. Returns null when no line is within a reasonable proximity of the origin (a far, truly-empty margin).

3. **Method A (if Probe P passes): seed a native selection.** In `render/textSelection.ts`, on empty-origin pointerdown resolve the anchor once: if found, `event.preventDefault()`, latch a `snapping` flag, store the anchor; a `{ signal }`-scoped `pointermove` (only while `snapping`) resolves the current point and `selection.setBaseAndExtent(...)` to seed/extend the native selection. One resolved anchor covers BOTH directions symmetrically (drag up extends the other way from the same anchor) — no up/down branch. Everything downstream is UNCHANGED (native Selection stays the render↔annotations contract): `useCreateQuickBox` creates the mark on release, the Story 8.1 copy handler joins paragraphs, the quick-box opens. NO clipping or post-filtering of native rects. NO caret API.

4. **The no-op fallback is preserved.** When the resolver returns null (far-empty margin, no nearby line), Story 8.8's `selectstart`-suppress no-op stays exactly as shipped (`emptyOrigin && !snapping`). Snap only when there is a clear nearest line next to the origin.

5. **Method B (only if Probe P fails): deterministic, never trust native.** Resolve anchor+focus each move; `render/` publishes the live endpoints (a store field shaped like the existing `dragPreview`); a React hook in `annotations/` renders OUR OWN preview highlight reusing `useCreateQuickBox`'s existing `previewRects`/`pendingGeometry` machinery, and on release builds the mark from the stored endpoints via a new `rectsFromRange(range, pages, scale, rectsOf)` extracted from `rectsFromSelection` (the latter becomes a thin per-range wrapper). Copy-during-drag is skipped in B (mark is created + selected on release) — documented, not silently dropped.

6. **Scope guard (hard).** NO column-aware clipping/post-filtering of native selection rects (the reverted-attempts failure class, `deferred-work.md` L62-79 / L189-197). NO caret-API family. Method A's per-move `setBaseAndExtent` deliberately crosses Story 8.9's spike-budget "don't drive selection in pointermove" guard; it never clips, so that guard's RATIONALE is preserved — document this crossing in the code so a future reader knows it was eyes-open, not a repeat of the reverted class. Do NOT reopen the continuous column-aware drag-select controller. If the change starts fighting the browser's contiguous range or filtering it per-move, STOP: out of scope.

7. **No regression to Story 8.8's guarantees**, live-smoked at DPR>1 with trusted pointer input across REPEATED same-session drags (8.8's full matrix): an on-text drag origin is unaffected — single-line, multi-line, and CROSS-PAGE selections still form, highlight/underline/comment on release, and copy with the Story 8.1 paragraph-join intact (8.8 AC-2); a cross-column empty-gutter drag still does NOT leak a cross-column or full-page highlight (8.8 AC-5, the `collectTextRects` per-text-node guard).

8. **No em-dash (—) in any new user-facing string** (none expected for this story) (UX-DR13).

9. **A negative outcome is still complete and acceptable.** If Probe P fails AND Method B also fails live smoke, append a write-up to `deferred-work.md` mirroring the Story 8.9 / 4.2-Part-B rigor, leave Story 8.8's no-op as the shipped baseline, land no production code. Do NOT invent a third technique or reopen the continuous controller to force a positive result (the 4.2-Part-B "no next attempt" guard applies to the in-story techniques).

## Tasks / Subtasks

- [ ] **Probe P: the decision gate (throwaway, live-smoke only)** (AC: 1)
  - [ ] Restore the resolver first (Task below) so P can use it, OR inline a minimal version — either way P must use the caret-API-free resolver, never `caretRangeFromPoint`.
  - [ ] On the empty-origin pointerdown path in `render/textSelection.ts`, add a TEMPORARY branch (not the shipped diff): `event.preventDefault()`, resolve the anchor, add a scoped `pointermove` calling `selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)` for the current point.
  - [ ] Launch your OWN fresh `uvicorn` + `vite dev` (never a found-running server), open the two-column fixture at ~200% zoom, DPR>1. Live-smoke with TRUSTED pointer input (raw mouse move/down/up, `[[use-trusted-input-for-focus-sensitive-smoke]]`, `[[drag-tools-dont-create-text-selection]]`): empty right-margin drag DOWN and UP, plus one cross-column drag, across REPEATED same-session drags.
  - [ ] Record the decisive observation: on `pointerup`, is `window.getSelection()` non-collapsed AND does a mark get created? If the selection is collapsed on release even with `preventDefault()` on the mousedown, try `preventDefault()` on the `click`/`selectstart` as a secondary lever before concluding. Decide: **A** (survives) or **B** (wiped). Remove the throwaway probe once decided.

- [ ] **Restore the resolver `render/nearestTextAnchor.ts` + unit tests** (AC: 2)
  - [ ] Recreate the caret-API-free resolver (it was reverted with the 8.9 spike): `groupSpanLines` (vertical-band grouping, skipping `--rotate` spans via `getComputedStyle(span).getPropertyValue("--rotate")`), `nearestLine` (preceding-line tiebreak on equidistance), `nearestSpanInLine` (horizontal nearest span), `nearestOffsetInTextNode` (binary search over non-collapsed single-character sub-ranges), `resolveNearestTextPoint` (composes them, returns null past a proximity threshold). Injectable rect readers (`elRectsOf`, `rangeRectsOf`) defaulting to the real DOM calls, exactly as `collectTextRects`/`rectsFromSelection` do with `rectsOf`.
  - [ ] Unit-test the pure logic in jsdom by injecting rect readers (jsdom has no real Selection geometry): the `--rotate` filter, band grouping, preceding-line tiebreak, nearest-span, and the offset binary search (including clamp-to-line-start/end past the last glyph). NOT re-exported from the `render/` barrel (like `textSelection.ts`/`paragraphCopy.ts`), so `vi.mock("./render")` barrels in `App.test.tsx`/`Reader.test.tsx` need no change.

- [ ] **If P passes → Method A: seed the native selection in `render/textSelection.ts`** (AC: 3, 4, 6)
  - [ ] Empty-origin pointerdown: resolve the anchor once. If found → `event.preventDefault()`, latch `snapping = true`, store `{ anchorNode, anchorOffset }`. If null → keep the existing `selectstart`-suppress no-op (fallback).
  - [ ] Scoped `pointermove` while `snapping`: resolve the current point, `selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)`. No clipping, no column model.
  - [ ] Extend the existing `releasePointer` closure to clear `snapping` + the stored anchor alongside `emptyOrigin` (share the `pointerup`/`pointercancel`/`blur` teardown; the recurring held-state bug: `[[held-key-state-reset-on-blur]]`). The `selectstart` listener fires only for `emptyOrigin && !snapping`. Do NOT stand up a second global listener manager (match Story 8.1/8.8).
  - [ ] Add a code comment recording the deliberate crossing of 8.9's per-move guard and why this is not the reverted clipping class (AC 6).

- [ ] **If P fails → Method B: own overlay + build-from-endpoints** (AC: 5, 6)
  - [ ] Extract `rectsFromRange(range, pages, scale, rectsOf)` from `rectsFromSelection` in `anchor/index.ts`; make `rectsFromSelection` a thin wrapper that loops the selection's ranges and delegates. (Pure extraction, existing tests must still pass.)
  - [ ] `render/` publishes the live drag's resolved endpoints via a store field shaped like `dragPreview`. A React hook in `annotations/` subscribes, renders the preview via the existing `previewRects`/`pendingGeometry` machinery, and on release builds the mark from the endpoints (`document.createRange()` + `setStart`/`setEnd` → `rectsFromRange` → the existing `buildAnnotations` create path).
  - [ ] Skip copy-during-drag in B; document it in a code comment.

- [ ] **Regression protection + full-suite green** (AC: 7)
  - [ ] `cd client && npm test && npm run typecheck` clean. Do not weaken the existing `isEmptyLayerSpace` / `pointercancel` tests. (Note: `Reader.test.tsx`'s Space-hold-pan test is a known pre-existing flake in the full run — passes in isolation; not caused by this story.)

- [ ] **Verify (live, own servers, DPR>1, trusted input, repeated same-session)** (AC: 1, 7, 9)
  - [ ] Empty right-margin drag next to text snaps and selects from the nearest line, drag-down AND drag-up, across REPEATED drags in one session.
  - [ ] Empty cross-column gutter drag does NOT leak a cross-column or full-page highlight (8.8 AC-5).
  - [ ] On-text single-line, multi-line, and CROSS-PAGE drags still select + highlight on release; Ctrl+C copies with the Story 8.1 paragraph-join intact (8.8 AC-2). Cross-page is the highest-risk path and jsdom can't see it (`[[verify-on-hidpi-and-real-host]]`) — required, not optional.
  - [ ] Far-empty-margin drag (no nearby line) still no-ops. Shut the dev servers down after.

- [ ] **If BOTH P and Method B fail: document the negative result** (AC: 9)
  - [ ] Append a write-up to `deferred-work.md` mirroring the Story 8.9 / 4.2-Part-B rigor (what failed, exact observation, what was eliminated, revisit condition). Leave Story 8.8's no-op shipped. No production code lands.

## Dev Notes

### The create/preview/copy pipeline already runs off native `window.getSelection()` (this is why Method A is small)

- `annotations/gestures/useCreateQuickBox.ts` `onPointerUp` (~line 273): reads `window.getSelection()` → `rectsFromSelection(selection, pages, scale, rectReader)` → `pages: PageSelection[]` → `createTextTool` builds the highlight/underline/comment. If a real native selection exists at pointerup, this fires UNCHANGED for the empty-origin drag.
- Story 8.1 copy (`render/textSelection.ts`, `copy` handler): reads the native selection, joins soft-wrapped lines. Works unchanged if the selection is real.
- The live blue is the browser's own `::selection` paint of the native selection — free with Method A.
- So Method A's only new code is: resolve the anchor + a scoped `pointermove` doing `setBaseAndExtent`. Everything else is already built.

### Where the change goes: `client/src/render/textSelection.ts` (read it fully before editing)

Story 8.8 shipped the empty-origin gate in `TextSelectionController.#enableGlobalListener`:
- `isEmptyLayerSpace(target, textLayers)` (textSelection.ts:37): true for a registered `.textLayer` container or its `.endOfContent` child. Pure DOM-classification, already unit-tested. This tells you the pointerdown is empty-origin; the ORIGIN LAYER for the resolver is that `.textLayer` (the target itself, or the layer whose `endOfContent` the target is — `#textLayers` is `Map<layerDiv, endOfContent>`).
- `emptyOrigin` is latched at document `pointerdown` (textSelection.ts:118-125) and cleared by the shared `releasePointer` closure on `pointerup`/`pointercancel`/window `blur` (textSelection.ts:126-136).
- The `selectstart` listener (textSelection.ts:142-148) calls `preventDefault()` when `emptyOrigin` — the current no-op. Method A narrows this to `emptyOrigin && !snapping`.
- The file also carries Story 4.1 `endOfContent` selection-bounding (`selectionchange`) and the Story 8.1 `copy` join — your change must be ADDITIVE and share the same `{ signal }` teardown; do not alter their reset semantics beyond adding the `snapping` clear.

**Registry shape you resolve against:** a registered `<div class="textLayer">` contains pdf.js glyph `<span>`s (each with a `--scale-x`/`transform: matrix(...)` width correction, and rotated runs carry a `--rotate` custom property), `<br role="presentation">`s, and one `<div class="endOfContent">`.

### The resolver algorithm (technique B, restored — keep it caret-API-free)

`render/nearestTextAnchor.ts`, local to `render/` (AD-9 — do NOT import `collectTextRects`/`rectsFromSelection` from `anchor/`; replicate the ~10-line per-text-node sub-range measurement locally):

1. Origin `.textLayer`'s glyph spans = `div.querySelectorAll("span")` minus `.endOfContent`, minus any span with a non-empty/non-zero `--rotate` (the rotated margin-run bug — its post-transform bounding box is page-tall and merges every line into one band).
2. Group spans into vertical line bands by `getBoundingClientRect()` overlap; pick the band containing the pointer Y, else the nearest band. Equidistant between two lines → prefer the PRECEDING line's end (matches "start from the end of the preceding line when dragging down").
3. Within the chosen band, pick the glyph span whose horizontal extent is nearest the pointer X (containing span wins; else nearer edge).
4. Binary-search the character offset within that span's text node: measure each probed boundary with a NON-collapsed single-character sub-range (`[offset-1, offset)` right edge, or `[0,1)` left edge for node start) via `getClientRects()` — a collapsed Range's rects are inconsistent across engines. Clamp to line start/end when the point is left/right of the line (the trailing-blank-space case).
5. Return `{ node, offset }`, or null past a proximity threshold (e.g. ~2 line-heights) so a far-empty margin keeps the no-op.

Make the rect readers injectable (`elRectsOf`, `rangeRectsOf` defaulting to the real DOM calls) exactly as `collectTextRects` (anchor/index.ts:448) and `rectsFromSelection` (anchor/index.ts:490) do, so the offset search is unit-testable in jsdom without real layout.

### The one real risk (Method A): native collapse-on-release

A mousedown that did not ARM a drag-select is treated as a click, and the browser collapses the selection to a caret at release — likely wiping the selection right before `useCreateQuickBox` reads it. This is the most probable identity of the undetermined "cancel-on-release regression" attempt #4 hit (`deferred-work.md#Discarded: Story 4.2 Part B`). `preventDefault()` on the MOUSEDOWN is the lever: we drive the selection ourselves, so we need no native mousedown behavior. Probe P exists solely to answer whether that beats the collapse. If it doesn't, Method B (which never trusts the native selection surviving) is the fallback.

### Why this is not the four reverted attempts / Story 4.2 Part B

Those needed CONTINUOUS column-aware tracking through a cross-column drag and CLIPPED/post-filtered `window.getSelection()`'s rects to a column band, fighting the browser. Method A does zero clipping — `setBaseAndExtent` produces the plain native contiguous range, identical to native on-text behavior between the same two points, just seeded from a resolved anchor. No column/line logical model, no per-move rect filtering. (See `deferred-work.md` L62-79, L189-197 for the reverted class.)

### Testing standards

- Vitest (jsdom). jsdom has no real Selection/`::selection`/layout, so the snap behavior, `setBaseAndExtent`, and the collapse-on-release question are NOT assertable there (mirrors the `textSelection.test.ts` header comment restricting coverage to registry/lifecycle bookkeeping). Unit-test only the pure resolver with injected rect readers.
- Live smoke is the real acceptance gate (AC 1, 7, 9), on your OWN fresh servers at DPR>1, trusted pointer input, across REPEATED same-session drags. Fold the empty-gutter cross-column drag and the on-text cross-page drag into this smoke, same as Story 8.8 did (carries AE7-4).

### Sequencing note (matters for Story 8.10)

Story 8.10 (Epic 8 structural refactor) explicitly scopes its `textSelection.ts` decomposition to "whatever Story 8.9 actually adds (or doesn't)" and names the anchor-resolution concern. Since 8.9 added nothing (negative) and THIS story adds the snap, **8.11 must land before 8.10** so 8.10's refactor absorbs the `nearestTextAnchor.ts` resolver + the `snapping` gate as one of the concerns it decomposes. Update `sprint-status.yaml` ordering accordingly (8.11 before 8.10).

### Project Structure Notes

- Expected touched production files, Method A: `client/src/render/nearestTextAnchor.ts` (new) + its test, and `client/src/render/textSelection.ts` (+ its test). Method B additionally: `client/src/anchor/index.ts` (`rectsFromRange` extraction), a `client/src/store/` field, and a hook + preview in `client/src/annotations/`.
- Layer rule (AD-9): the resolver stays in `render/`, importing nothing from `anchor/`/`annotations/`/`store/`. Method B's cross-layer flow goes endpoints→store→annotations (down-dependency preserved) and `rectsFromRange` lives in `anchor/`.
- No contract/store-MODEL/anchor-MODEL change, no design-token change, no `docs/API.md` change (no `/api` surface touched). No new FR unless the implementation validates (assign at close, mirroring 8.2-8.4).
- If the outcome is negative (P fails AND B fails): the only change is a new section in `deferred-work.md`; no production/test file changes.

### References

- [Source: docs/superpowers/specs/2026-07-12-snap-empty-space-drag-to-text-design.md (AUTHORITATIVE design for this story)]
- [Source: .bmad/implementation-artifacts/deferred-work.md#Discarded: Story 8.9 (the failed spike this builds on: technique A dead, resolver works, native-arm blocker) and #Discarded: Story 4.2 Part B (the cancel-on-release regression + no-next-attempt rigor)]
- [Source: .bmad/implementation-artifacts/8-9-snap-empty-space-drag-to-text.md (the spike's Dev Agent Record + resolver details)]
- [Source: client/src/render/textSelection.ts:37 (isEmptyLayerSpace), :100-248 (#enableGlobalListener: pointerdown latch, releasePointer, selectstart suppress, selectionchange bounding, copy join)]
- [Source: client/src/annotations/gestures/useCreateQuickBox.ts:273 (onPointerUp create-on-release reading window.getSelection via rectsFromSelection), :132 (computePendingGeometry / previewRects machinery to reuse in Method B)]
- [Source: client/src/anchor/index.ts:448 (collectTextRects: per-text-node sub-range + injectable rectsOf, the pattern to replicate in render/), :490 (rectsFromSelection: the create-on-release consumer; Method B extracts rectsFromRange from it)]
- [Source: .bmad/planning-artifacts/epics.md#Epic 8 (Story 8.9 spike framing, Story 8.10 refactor sequencing)]
- [Source: CLAUDE.md#Engineering principles (document-level phase-gated handlers; selection->rects via collectTextRects; cross-page live smoke at DPR>1; launch your own dev servers) and #Code navigation (CodeGraph)]
- [Memories: [[drag-tools-dont-create-text-selection]], [[use-trusted-input-for-focus-sensitive-smoke]], [[verify-on-hidpi-and-real-host]], [[held-key-state-reset-on-blur]]]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-12: Story created from the approved design spike-with-fallback design (attempt 2 after the 8.9 negative spike).
