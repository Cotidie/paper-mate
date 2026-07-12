---
baseline_commit: f8f7e540f057ac68e5c049c37ee84f46d636e08f
---

# Story 8.11: Snap empty-space drag to nearest text (attempt 2)

Status: review

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

- [x] **Probe P: the decision gate (throwaway, live-smoke only)** (AC: 1)
  - [x] Restored the resolver first (`render/nearestTextAnchor.ts`), so P used the caret-API-free resolver, never `caretRangeFromPoint`.
  - [x] Added a temporary `pointerdown` branch in `render/textSelection.ts`: `event.preventDefault()`, resolve the anchor, scoped `pointermove` calling `setBaseAndExtent(anchor, focus)` per point.
  - [x] Launched own fresh `uvicorn` (:8000) + `vite dev` (:5173), opened the two-column fixture at 200% zoom, DPR=1.25, `claude-in-chrome` trusted pointer input. Smoked empty right-margin drag DOWN and UP, plus a cross-column drag, across REPEATED same-session drags.
  - [x] **Decision: A.** Instrumentation showed the selection FORMS non-collapsed on the first pointermove and SURVIVES `pointerup` (`collapsed:false` at a capture-phase pointerup probe). One bug found + fixed in the probe: falling back `focus → anchor` when a move point is momentarily unresolvable COLLAPSES the selection; keeping the last good focus fixes it. The browser does NOT collapse on release once `preventDefault()` stops the mousedown click. Removed the throwaway probe (`git checkout`).

- [x] **Restore the resolver `render/nearestTextAnchor.ts` + unit tests** (AC: 2)
  - [x] Recreated the caret-API-free resolver: `groupSpanLines` (vertical-band grouping, skipping `--rotate` spans via `span.style.getPropertyValue("--rotate")` — pdf.js sets it INLINE, so this is jsdom-testable, cleaner than `getComputedStyle`), `nearestLine` (preceding-line tiebreak), `nearestSpanInLine`, `nearestOffsetInTextNode` (binary search over non-collapsed single-character sub-ranges), `resolveNearestTextPoint` (composes them, returns null past a ~2-line-height proximity threshold). Injectable rect readers (`elRectsOf`, `rangeRectsOf`).
  - [x] Unit-tested the pure logic (12 tests) with injected rect readers: `--rotate` filter, zero-area skip, band grouping, preceding-line tiebreak, nearest-span, offset binary search + clamp-to-start/end. Not re-exported from the `render/` barrel, so the `vi.mock("./render")` barrels need no change.

- [x] **Method A: seed the native selection in `render/textSelection.ts`** (AC: 3, 4, 6)
  - [x] Empty-origin pointerdown resolves the anchor once. If found → `event.preventDefault()`, latch `snapping = true`, store `snapAnchor`/`snapFocus`. If null → keep the `selectstart`-suppress no-op fallback.
  - [x] Scoped `pointermove` while `snapping`: resolve the current point (keeping the last good focus so a momentary miss can't collapse it), `setBaseAndExtent(snapAnchor, focus)`. No clipping, no column model.
  - [x] Extended the existing `releasePointer` closure to clear `snapping`/`snapAnchor`/`snapFocus` alongside `emptyOrigin` (shared `pointerup`/`pointercancel`/`blur` teardown). The `selectstart` listener now fires only for `emptyOrigin && !snapping`. No second global listener manager.
  - [x] Added a code comment recording the deliberate crossing of 8.9's per-move guard and why this is not the reverted clipping class.

- [x] **Method B: not needed** (AC: 5) — Probe P passed, so Method A shipped; the deterministic own-overlay fallback was not built. The `rectsFromRange` extraction and the preview hook remain available in the plan if a future need arises.

- [x] **Regression protection + full-suite green** (AC: 7)
  - [x] Added 4 controller gate tests (mocking the resolver) asserting snap-vs-suppress + `setBaseAndExtent` wiring + snap-latch clear on pointerup. `cd client && npm test` → 1493/1493 pass (the pre-existing `Reader.test.tsx` Space-hold-pan flake did not recur); `npm run typecheck` clean. Existing `isEmptyLayerSpace` / `pointercancel` tests unchanged and green.

- [x] **Verify (live, own servers, DPR>1, trusted input, repeated same-session)** (AC: 1, 7, 9)
  - [x] Empty right-margin drag next to text snaps and selects from the nearest line, drag-down AND drag-up, across REPEATED same-session drags. Created clean per-line highlights (verified geometry: 4 rects, max normalized width 0.386 = one column).
  - [x] Empty cross-column gutter drag does NOT leak: even a large 41-rect selection spanning author-line→abstract had ZERO rects wider than 0.5 (max 0.386) — the `collectTextRects` per-text-node guard holds (8.8 AC-5).
  - [x] On-text single-line and multi-line drags still select + highlight on release (8.8 AC-2). On-text CROSS-PAGE is untouched by construction: the entire snap path is gated behind `if (emptyOrigin)`, so an on-text-origin drag returns early and runs the identical Story 8.8-verified code (the `pointermove` handler no-ops via `if (!snapping) return`). Copy: the snap yields a genuine native Selection (verified non-collapsed, correct multi-line text, single range in-layer), which the unchanged Story 8.1 copy handler joins by construction; the clipboard-readback assertion itself is blocked by a clipboard-permission dialog in this harness (tooling limit, not a product issue).
  - [x] Far-empty-margin drag (700,150, well above the title) still no-ops (`getSelection()` collapsed/empty — resolver returned null past the proximity threshold). Dev servers shut down after.

- [ ] **If BOTH P and Method B fail: document the negative result** (AC: 9) — N/A: Probe P passed, Method A shipped and verified. No negative write-up needed.
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

Claude Opus 4.8

### Debug Log References

- Live-smoke: `claude-in-chrome` extension (real host Chrome, DPR=1.25), own `uvicorn --port 8000` + `vite dev --port 5173`, fixture `Multi-task self-supervised visual learning.pdf`.
- Probe P trace (final, fixed-fallback run): pointermove #1 `{collapsed:false, hasF:true}`; pointermove #2 `{collapsed:false, hasF:false}` (kept last focus); capture-phase pointerup `{collapsed:false, text:"\n1. Introduction\nVision is one"}` → selection SURVIVES release. Decision: Method A.
- Method A end-to-end: empty-margin drag at (1240,290) → highlight "semantics, yet any labels necessary...proposed [1, 2, 6...", per-line, quick-box shown; repeated drag at (1250,480) → "be re-trained to perform well...geometry estimation)". Clean-code re-verify at (1250,200) → "where performance is easy to measure...in supervised learning." + "Ideally, these tasks will be diffi-".
- No-leak geometry (via `/api/docs/{id}/annotations`): snap highlight 4 rects max-width 0.386; cross-region gutter selection 41 rects, 0 rects > 0.5 (max 0.386).
- Far-empty no-op at (700,150): `getSelection()` collapsed/empty.
- `npm test` 1493/1493 pass; `npm run typecheck` clean.

### Completion Notes List

- **Probe P passed → Method A shipped.** The 8.9 spike's blocker ("native won't arm a drag-select from an off-glyph mousedown") is bypassed by DRIVING the native selection ourselves via `setBaseAndExtent` each `pointermove`, seeded from the resolver's nearest-glyph anchor. The selection is real, so every downstream consumer (create-on-release, Story 8.1 copy, quick-box) works unchanged.
- **Key finding:** the browser does NOT collapse the built selection on release once `event.preventDefault()` is called on the empty-origin mousedown. The apparent collapse in early probing was a self-inflicted bug (focus-fallback to the anchor on a momentarily unresolvable move point); keeping the last good focus fixes it. This likely also explains the undetermined "cancel-on-release regression" the reverted Story 4.2 Part B attempt #4 hit.
- **Not the reverted class:** `setBaseAndExtent` yields the plain native contiguous range (no column-band clipping, no per-move rect filtering, no caret API). The per-move driving deliberately crosses 8.9's spike-budget guard, but that guard's rationale (clipping regressions) is preserved. Documented in-code.
- **No-leak holds** (8.8 AC-5): the `anchor/collectTextRects` per-text-node guard is downstream and unchanged, so even a large snap selection never paints a cross-column/full-page rect (verified: 0 rects > 0.5 normalized width).
- **On-text paths untouched by construction:** the whole snap lives inside `if (emptyOrigin)`; on-text-origin drags return early, so single/multi/cross-page on-text behavior is byte-identical to Story 8.8.
- Method B (deterministic own-overlay fallback) was not needed. FR: a new FR may be assigned at epic close now that the spike validated (mirrors 8.2-8.4). Story 8.10's `textSelection.ts` refactor should absorb `nearestTextAnchor.ts` + the `snapping`/`snapEngaged` gate.

### Post-implementation UX refinements (from live user testing)

Five rounds of live feedback drove the resolver from a single nearest-glyph point to a small state machine (all live-verified at DPR=1.25, trusted pointer input):
- **rAF throttle + live re-resolve + scroll listener:** `setBaseAndExtent` on every pointermove thrashed layout (empty-space felt ~1fps while on-text felt instant); coalesce to one frame; re-resolve focus live each frame so mid-drag scroll tracks.
- **Nearest glyph by 2D distance (no column lock):** anchor stays in the correct column automatically (gutter X-gap is large) AND a drag extends across columns like a native text drag.
- **Coverage-based column detection** for the gap's paragraph-boundary anchoring (robust to short headings/last lines).
- **Direction-aware gap anchor:** drag up from a gap anchors at the end of the line above ("...prediction."), drag down at the start of the line below ("1. Introduction").
- **Engage-on-row-touch (`snapEngaged` + `onRow`):** paints nothing until the cursor reaches a text row; off-row (blank paragraph gap) collapses to the anchor so no stale selection lingers; the `onRow` half-line-height tolerance bridges inter-line leading without flicker.

### Senior Developer Review (AI) — Codex, 2026-07-13

Ran `bmad-code-review` through **Codex** (`codex exec`, GPT model — different from the Sonnet/Opus implementer, per CLAUDE.md). Verdict: **Changes Requested — High 0 / Med 5 / Low 3.** Clean on every hard guard: no caret-API family, no AD-9 upward import, no column-band selection clipping, no new user-facing em-dash. All 5 Medium + 2 Low (L1/L2) resolved with targeted tests; L3 is a coverage note (below).

- **[Med, fixed] M1** — the moving focus could pick a horizontally-closer glyph on a *different* line, judging `onRow` against the wrong band → collapse even when the cursor Y was in a real row. Fixed: prefer a glyph whose band contains Y before 2D fallback.
- **[Med, fixed] M2** — the rAF throttle could drop the last pointermove (or a whole single-frame drag) before `pointerup`, so create-on-release read a stale/empty range. Fixed: capture-phase pointerup flushes the pending frame synchronously before the bubble-phase consumer.
- **[Med, fixed] M3** — a mid-drag layer unregister left a queued rAF + stale `snapLayer` → `setBaseAndExtent` on detached nodes. Fixed: `applySnapFrame` bails on `!snapLayer.isConnected`; an abort handler cancels the queued frame on teardown.
- **[Med, fixed] M4** — a lone-line sparse region wasn't a detected column, so the anchor could resolve into the other column. Fixed: column keyed off the origin glyph's centre with a local-band fallback.
- **[Med, fixed] M5** — a pre-existing Selection wasn't cleared on arm, so a stale range could linger/be consumed if the drag never engaged. Fixed: `removeAllRanges()` on arm.
- **[Low, fixed] L1** — `groupLines` was input-order-dependent for a bridging glyph. Fixed: sort by top.
- **[Low, fixed] L2** — the snap armed on middle/right button too. Fixed: primary button only.
- **[Low, accepted coverage note] L3** — on-text CROSS-PAGE selection and paragraph-copy clipboard readback are not automated (jsdom can't see real Selection geometry; clipboard readback is blocked by a permission dialog in the smoke harness). Mitigation: the entire snap path is gated behind `if (emptyOrigin)`, so on-text-origin drags (including cross-page) return early and run byte-identical Story-8.8-verified code; on-text single/multi-line and far-margin no-op were live-verified. A dedicated cross-page trusted-input smoke + paragraph-copy check remains a follow-up for the next epic touching cross-page selection (carries AE7-4).

### File List

- `client/src/render/nearestTextAnchor.ts` (new — the caret-API-free resolver: `nearestGlyph`/`nearestGlyphByX`/`nearestOffsetInTextNode`, `groupLines`/`detectColumns`/`localColumnBand`, `resolveNearestText` → `{node, offset, onRow}`, `resolveOrigin` → direction-aware `OriginContext`)
- `client/src/render/nearestTextAnchor.test.ts` (new — resolver unit tests incl. M1/M4 regression cases)
- `client/src/render/textSelection.ts` (modified — empty-origin snap state machine: `snapEngaged`/`snapAnchor`/`snapFocus`/`snapPoint`, rAF-throttled `pointermove` + capture-phase `scroll` + `pointerup` flush, `setBaseAndExtent`, narrowed `selectstart` suppress, shared `releasePointer` teardown + abort-cancel)
- `client/src/render/textSelection.test.ts` (modified — snap gate/direction/engage/collapse + M2/M3/M5/L2 tests)
- `.bmad/implementation-artifacts/8-11-snap-empty-space-drag-to-text-attempt-2.md` (this story)
- `.bmad/implementation-artifacts/sprint-status.yaml` (status transitions)

## Change Log

- 2026-07-12: Story created from the approved design spike-with-fallback design (attempt 2 after the 8.9 negative spike).
- 2026-07-12: Probe P passed live smoke (native selection seeded by `setBaseAndExtent` survives release) → Method A implemented: empty-space drag snaps to the nearest glyph and drives a real native selection, everything downstream unchanged. Full 8.8 regression matrix live-verified at DPR>1. Method B not needed.
- 2026-07-12/13: Five rounds of live UX refinement (rAF throttle, live/scroll re-resolve, nearest-2D no-column-lock, coverage-based columns, direction-aware gap anchor, engage-on-row-touch + off-row collapse).
- 2026-07-13: Codex `bmad-code-review` — Changes Requested (0 High / 5 Med / 3 Low). All 5 Med + L1/L2 fixed with tests; L3 documented as a cross-page smoke follow-up. 1512 suite green, typecheck clean.
