---
baseline_commit: 93379807e1f3a260a15b9dc3a74f3ac907f12b15
---

# Story 8.9: Snap empty-space drag to nearest text (spike)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a drag that starts in empty page space to snap its selection to the nearest text instead of doing nothing,
so that the gesture works the way I'd expect on a page with visible text nearby.

## Acceptance Criteria

1. **Given** the empty-space-origin no-op behavior Story 8.8 shipped (`emptyOrigin` latch + `selectstart` preventDefault in `render/textSelection.ts`), **Then** this story STARTS with a design/prototyping spike, NOT a committed implementation: prototype ONE candidate technique at a time for resolving a stable nearest-text anchor from an empty-space pointerdown, and live-smoke it against a real two-column paper (`fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf`) at DPR>1 across REPEATED drags in the SAME browser session (not only a fresh page load) before writing production code. Rationale: the Story 3.8 / 4.2 caret corruption needs prior text-layer interaction to manifest, so a fresh-load-only test would falsely pass (deferred-work.md L183).

2. **Given** the two candidate techniques named in `deferred-work.md`, **Then** the spike evaluates them in this order: (A) `document.caretRangeFromPoint(x, y)` / `document.caretPositionFromPoint(x, y)` resolved EXACTLY ONCE at pointerdown, before any drag motion begins, FIRST (cheapest to prototype; this is AE3-7's named-but-untested "resolve once, not continuously" escape route); and only if (A) fails live smoke, (B) the manual `Range.setStart`/`setEnd` + `getClientRects()` binary search that avoids the caret-API family entirely.

3. **Given** a validated technique, **Then** the fix resolves the nearest text position EXACTLY ONCE at gesture start (never continuously mid-drag, unlike the four discarded multi-column attempts) and hands off to native `Selection`/`Range` extension for the rest of the gesture. One resolved point + `Selection.collapse(node, offset)` to it covers both directions symmetrically: dragging DOWN from blank space starts the selection at the resolved point and native extension carries it downward; dragging UP extends from the same collapsed anchor the way normal reverse-direction selection already does. NO separate up/down branch is written.

4. **Given** "nearest text" must not reopen the abandoned controller, **Then** it resolves to the nearest glyph in the SAME column/line context as the empty-space origin (the line at the origin's vertical band, its nearest character horizontally), NOT the arbitrary next node in raw DOM order that produced the Story 8.8 defect. This story does NOT attempt cross-column-aware selection DURING a drag, only a single-shot anchor resolution AT THE ORIGIN.

5. **Given** the spike's outcome is genuinely uncertain, **Then** if BOTH techniques fail live smoke (the caret corruption recurs on a repeated same-session drag, or the manual binary search proves unreliable or too slow within the budget below), the story documents the negative result in `deferred-work.md` with the same rigor as the "Discarded: Story 4.2 Part B" write-up, and Story 8.8's no-op stays the shipped baseline. This is a COMPLETE, ACCEPTABLE outcome, not a failed story. Do NOT start a third patch-on-patch attempt or reopen the continuous column-aware controller to force a positive result.

6. **Given** any implementation lands, **Then** it does not regress Story 8.8's guarantees, live-smoked at DPR>1 exactly as 8.8 was: an on-text drag origin is unaffected (8.8 AC-2: single-line, multi-line, and CROSS-PAGE selections still form, highlight/underline/comment on release, and copy); and a cross-column empty-gutter drag still does not leak a cross-column or full-page highlight (8.8 AC-5: the `anchor/collectTextRects` per-text-node guard still holds).

7. **Given** any new user-facing string (none expected for this story), **Then** it contains no em-dash (UX-DR13).

## Tasks / Subtasks

- [x] **Reproduce the baseline and confirm the target surface first (no code)** (AC: 1, 6)
  - [x] Launched own `uvicorn` (port 8000) + `vite dev` (port 5173), opened `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf` in the `claude-in-chrome` extension (real host, DPR=1.25) at 200% zoom, page 1.
  - [x] Confirmed the shipped no-op: a trusted press-drag DOWN from the blank space right of "...NYU depth prediction." (left column, page 1) produced `getSelection()` = `{rangeCount:1, isCollapsed:true, text:""}` — no visible/programmatic selection. Sanity-checked the drag tool itself against an on-text drag first (`he ImageNet network on NY` selected), confirming the tool can form real selections and the empty-space result is the app's behavior, not a tooling artifact.
  - [x] Confirmed via `document.elementFromPoint` at the pointerdown coordinates: target is the `.textLayer` div itself (`isEmptyLayerSpace` true), matching Story 8.8's registry.

- [x] **Spike technique (A): caret-API resolved once at pointerdown** (AC: 1, 2, 3)
  - [x] Added a temporary probe on the empty-origin pointerdown path calling `document.caretRangeFromPoint(e.clientX, e.clientY)` exactly once, logging the resolved node/offset.
  - [x] **Decisive A/B measurement:** at fixed coordinates, the FIRST fresh-load drag resolved correctly (`DIV`, offset 142, the layer's own child-index — technique A's raw output needs further walking even when "correct"). After interleaving on-text drags/clicks elsewhere on the page (touching the text layer) and repeating the SAME empty-space drag 9 more times at the identical coordinates, 3 of 9 repeats returned the exact poison signature `deferred-work.md`'s Story 3.8 entry documents: empty resolved node, offset 0. Non-deterministic but a genuine, repeated recurrence — technique (A) is DEAD per AC 2's own bar. No patch was attempted (per AC 2's explicit instruction). Full trace recorded in `deferred-work.md`.
  - [x] Technique (A) did not validate — proceeded to technique (B). Probe reverted (`git checkout -- client/src/render/textSelection.ts`).

- [x] **Spike technique (B): manual Range + getClientRects binary search** (AC: 2, 3, 4)
  - [x] Prototyped `client/src/render/nearestTextAnchor.ts` (caret-API-free, local to `render/`, no `anchor/` import): `groupSpanLines` (vertical-band line grouping, filtering pdf.js's rotated `--rotate` glyph runs — found and fixed a real bug where an unfiltered rotated margin span's page-tall post-transform bounding box merged every line on the page into one band), `nearestLine` (preceding-line tiebreak on equidistance), `nearestSpanInLine` (horizontal nearest-span), `nearestOffsetInTextNode` (binary search over non-collapsed single-character sub-ranges, injectable `rectsOf` mirroring `collectTextRects`).
  - [x] Live-smoked on own servers at DPR=1.25 across repeated same-session drags: the resolver itself was CORRECT and non-flaky (5/5 repeats resolved the exact intended character boundary, unlike technique A). However, the AC-3 hand-off ("`selection.collapse()` then let native drag-extension run") does not work when the pointerdown pixel itself misses glyph content: a control drag starting 1px inside the nearest glyph (x=599) correctly armed native extension; the identical drag from the blank-space point (x=640) stayed fully collapsed regardless of `selection.collapse()` to the correctly-resolved anchor, and regardless of `preventDefault()` on `pointerdown`, `selectstart`, both, or neither. This is a browser constraint (native selection-arm requires its own successful hit-test at the mousedown pixel), not a resolver bug — confirmed decisively, not worked around, since a fix would require driving `pointermove`-continuous extension ourselves (the explicitly out-of-scope continuous controller). Full trace recorded in `deferred-work.md`.
  - [x] Technique (B) did not validate (anchor resolution correct; native-extension hand-off does not occur). All spike code reverted (`git checkout -- client/src/render/textSelection.ts`; `rm client/src/render/nearestTextAnchor.ts`).

- [x] **If a technique validates: replace the empty-origin no-op with the snap in `render/textSelection.ts`** (AC: 3, 4, 6) — **N/A, not reached.** Both techniques failed live smoke (see above); per AC 5 this branch does not apply and no snap was wired in.

- [x] **Regression protection and unit tests** (AC: 6) — **N/A, not reached.** No production code lands (both techniques failed), so there is no new resolver to unit-test. The pre-existing `isEmptyLayerSpace` and `pointercancel` tests were not touched. `cd client && npm test && npm run typecheck` run clean against the reverted (baseline) tree as part of Task "Regression check on the reverted tree" below.

- [x] **Verify (live, own servers, DPR>1)** (AC: 1, 5, 6) — **N/A as originally scoped** (there is no snap to verify — both techniques failed before reaching this task). What WAS verified live, at DPR=1.25 with trusted pointer input (`claude-in-chrome`'s CDP-backed drag, sanity-checked against a real on-text selection first): Story 8.8's no-op is unchanged post-revert (re-confirmed after `git checkout`), matching pre-spike baseline exactly. No cross-page/cross-column/on-text regression check was needed since no shipped file was modified in the final state (`git status` clean on `client/src/render/`).

- [x] **If BOTH techniques fail: document the negative result** (AC: 5)
  - [x] Appended "Discarded: Story 8.9 (snap empty-space drag to nearest text)" to `deferred-work.md` (plus a status-ledger row), mirroring the "Discarded: Story 4.2 Part B" rigor: both failure modes, exact observed corruption/blocker, what was fixed vs. what remains fatal, and the condition for a future revisit (the anchor-resolution half of technique B is reusable; the missing piece is a budgeted `pointermove`-driven extension design, explicitly out of THIS spike's scope). Story 8.8's no-op stays the shipped baseline; no production code change lands (`client/src/render/` is unmodified in the final diff).

## Dev Notes

### This is a SPIKE. A negative result is a complete, valid outcome.

Same posture as Story 8.7 and the Story 4.2 Part B design-gate: prototype first, live-smoke against the real surface, and only commit production code if the prototype survives. If both named techniques fail, you WRITE UP the negative result and stop; you do NOT keep patching. The epic explicitly sequenced Story 8.10 (Epic 8 refactor) AFTER this story precisely because 8.9's outcome is uncertain. No new FR is assigned unless the spike validates (mirrors how 8.2-8.4 earned FR-23/24/25 only once their design was committed).

### Why this is NOT the four discarded attempts (read before starting)

Four prior multi-column/snap-selection attempts were built and reverted (`deferred-work.md` "story 2-5 blank-space text selection", commits `03d471b` / `a294ca9`), and Story 3.8 + Story 4.2 Part B were discarded on a hard Chromium caret bug. The critical distinction that makes this story narrower than all of them:

- Those attempts needed CONTINUOUS column-aware tracking through an active cross-column drag (resolving the caret / re-clipping the selection on every `pointermove`). This story needs a ONE-TIME anchor resolution at gesture start, then hands off to the browser's own native `Selection` extension. Single-shot, not continuous.
- The caret corruption that killed Story 3.8 / gated Story 4.2 manifests "during an active native mouse-button-held drag ... both `caretRangeFromPoint` and `caretPositionFromPoint` return wrong/empty results" for calls made mid-drag (`deferred-work.md` L182). AE3-7 (the project's own follow-up) names "resolve once on `pointerup`" as an UNTESTED idea for a future revisit. This story tests the sibling idea: resolve once at POINTERDOWN, before any pointermove. Whether a single pre-move call dodges the poison is THE empirical question of the spike (AC 2, technique A). deferred-work.md L183 warns the poison reproduces "once ANY prior click or drag has touched the page's text layer" at fixed coordinates, which is exactly why AC 1 mandates repeated same-session drags, not a fresh-load-only test that would falsely pass.

**Hard scope guard (do not cross):** do NOT reopen the continuous column-aware drag-select controller, do NOT post-filter `window.getSelection()` rects to a column band, do NOT drive the selection yourself in `pointermove` from a logical column/line model. Every one of those regressed and was reverted (`deferred-work.md` L68-79, L193-195). If your change starts fighting the browser's contiguous range or steering it per-move, STOP: that is out of scope and out of budget.

### Where the change goes: `client/src/render/textSelection.ts`

Story 8.8 shipped the empty-origin gate in `TextSelectionController.#enableGlobalListener`:
- `isEmptyLayerSpace(target, textLayers)` (textSelection.ts:37) classifies the pointerdown target: true for a registered `.textLayer` container or its `.endOfContent` child, false for a glyph `<span>` or anything outside a registered layer. Pure, DOM-classification only, already unit-tested.
- `emptyOrigin` is latched at the document `pointerdown` (textSelection.ts:118-125) and cleared by the shared `releasePointer` closure on `pointerup` / `pointercancel` / window `blur` (textSelection.ts:126-136).
- When `emptyOrigin` is true, a `{ signal }`-scoped `selectstart` listener calls `event.preventDefault()` (textSelection.ts:142-148), suppressing the native selection = the current no-op.

The snap replaces that `selectstart`-suppress for the empty-origin-WITH-nearest-line case: at the `pointerdown` where `emptyOrigin` becomes true, resolve the nearest-text point once and `selection.collapse(node, offset)` to it, then let native extension run. Keep the no-op (suppress) as the fallback for a truly-empty far margin with no nearby line. Reuse the existing latch + `releasePointer` teardown; do NOT stand up a second global manager (matches how Story 8.1 added its `copy` listener and 8.8 added `emptyOrigin`).

**Registry shape you resolve against** (from Story 8.8 notes): a registered `<div class="textLayer">` contains pdf.js glyph `<span>`s (each with a `transform: matrix(...)` width correction) + `<br role="presentation">`s + one `<div class="endOfContent">`. `#textLayers` is a `Map<Element, HTMLElement>` of layer div -> its `endOfContent`. The origin layer for a resolution is the `.textLayer` the pointerdown target is (or is inside).

### Technique (A): caret-API resolved once at pointerdown

`document.caretRangeFromPoint(x, y)` returns a collapsed `Range` at the character nearest `(x, y)` (Chromium/WebKit). `document.caretPositionFromPoint(x, y)` is the standardized equivalent returning `{ offsetNode, offset }` (Firefox, and now Chromium). Call ONE of them EXACTLY ONCE, synchronously, in the empty-origin pointerdown handler, before any pointermove. Then `selection.collapse(range.startContainer, range.startOffset)` (or `selection.collapse(pos.offsetNode, pos.offset)`).

This is the cheapest prototype and the most likely to be poisoned. The whole point of AC 2 ordering it FIRST is to get a fast, decisive yes/no from the A/B measurement (fresh-load-first-drag vs repeated-same-session-drag). If it is poisoned at pointerdown-time, abandon it immediately; the extensive elimination list in `deferred-work.md` L184 means there is no known patch.

### Technique (B): manual Range + getClientRects binary search (only if A fails)

Avoids the caret-API family entirely (the family `deferred-work.md` flags, unconfirmed, as the likely poison source via pdf.js's per-span `transform: matrix(...)` substrate). Recommended starting algorithm, keep it LOCAL to `render/` (AD-9: `render/` imports nothing from `anchor/` / `annotations/` / `store/`, so do NOT import `collectTextRects`; replicate its tiny per-text-node sub-range measurement pattern locally, which is ~10 lines):

1. From the origin `.textLayer`, get its glyph spans (`div.querySelectorAll("span")`, excluding `.endOfContent`).
2. Pick the line nearest the pointer Y: group/scan spans by their `getBoundingClientRect()` vertical band and choose the band whose Y-range contains the pointer, else the nearest band. This is the "same column/line context" of AC 4 (in a body column the DOM is column-sequential, so the vertical-nearest span in the origin layer is same-column by construction). When the point is vertically equidistant between two lines, prefer the PRECEDING line's end (matches the user's "start from the end of the preceding line when dragging down").
3. Within the chosen line's span(s), find the character offset nearest the pointer X: binary-search the span's text node with `range.setStart(textNode, mid)` / `range.setEnd(textNode, mid)` and compare `range.getClientRects()` horizontal position against pointer X, converging on the nearest inter-character boundary. Clamp to the line's start if the point is left of the line, its end if right of it (the trailing-blank-space case).
4. `selection.collapse(textNode, resolvedOffset)`; native extension does the rest.

Make the rect reader injectable (a `rectsOf: (r: Range) => ArrayLike<DOMRect>` parameter defaulting to `r.getClientRects()`), exactly as `collectTextRects` (anchor/index.ts:448) and `rectsFromSelection` (anchor/index.ts:490) do, so the offset-search logic is unit-testable in jsdom without real layout.

### Regression protection (read before editing)

- `render/textSelection.ts` also carries the Story 4.1 `endOfContent` selection-bounding (the `selectionchange` handler) and the Story 8.1 paragraph-join (`copy` handler). Your change must be ADDITIVE and share the same `{ signal }` teardown. Do not alter the `pointerup`/`pointercancel`/`blur` reset semantics beyond what the snap needs; the `releasePointer` closure (textSelection.ts:126) already clears `emptyOrigin` in all three spots (the recurring held-state bug: `[[reset-held-key-state-on-blur]]`, `[[held-key-state-reset-on-blur]]`).
- `useCreateQuickBox.ts` consumes the native selection on `pointerup` via `rectsFromSelection` unchanged. Once the snap starts a real selection at the resolved point, the create-on-release path builds the highlight/underline/comment from that selection as it does for any on-text drag; no change needed there.
- Highlight geometry is already leak-safe: `anchor/collectTextRects` measures per-text-node rects, never element boxes, so even a contiguous selection that runs down a column never paints a full-page highlight (8.8 AC-5). The snap changes only WHERE the selection starts, not the paint safety.
- **Cross-page selection is the highest-risk path and jsdom cannot see it.** An on-glyph cross-page drag MUST still select + highlight after your change (CLAUDE.md; `[[verify-on-hidpi-and-real-host]]`). This is a required live-smoke item (AC 6), not optional.

### Testing standards

- Vitest (jsdom). jsdom has no real Selection/`::selection`/layout, so the snap itself and the caret poison are NOT assertable there (mirrors the `textSelection.test.ts` header comment restricting coverage to registry/lifecycle bookkeeping). Unit-test only the pure resolver logic with an injected rect reader.
- Live smoke is the real acceptance gate (AC 1, 5, 6), on your OWN fresh servers at DPR>1, with trusted pointer input, across REPEATED same-session drags. Carries action item AE7-4 (the DPR>1 cross-page/cross-column smoke backfill routed to "the next epic touching cross-page PDF selection"): fold the empty-gutter cross-column drag and the on-text cross-page drag into this smoke, same as Story 8.8 did.

### Open design calls (resolved here for the dev)

- **"nearest" = same-column vertical-band line first, then horizontal-nearest character** (AC 4 / technique B step 2-3). When vertically equidistant between two lines, prefer the preceding line's end. This keeps it a single-shot origin resolution, never a cross-column decision.
- **No-op fallback stays** for a far, truly-empty margin with no nearby line: snap ONLY when a clear nearest line exists next to the origin. This preserves Story 8.8's guarantee for the genuinely-empty case and adds snap only for the "blank space next to text" case the user asked about.
- **Budget:** technique (A) gets the one decisive A/B measurement (poisoned at pointerdown or not); if poisoned, abandon immediately, no patching. Technique (B) gets a bounded prototype + smoke; if unreliable or too slow after reasonable iteration, document the negative result and stop. Do NOT invent a third technique, a patch-on-patch on either, or a continuous controller (the 4.2 Part B "no 5th attempt" guard applies).

### Project Structure Notes

- Expected touched production file (if a technique validates): `client/src/render/textSelection.ts` only, plus its test `client/src/render/textSelection.test.ts`. A self-contained resolver helper may warrant its own small `render/` module (e.g. `render/nearestTextAnchor.ts` + test) if it grows beyond a few functions; keep it in `render/`, imported by `textSelection.ts` directly (NOT re-exported from the `render/` barrel, like `textSelection.ts` / `paragraphCopy.ts` already are).
- Layer rule (AD-9): the fix stays in `render/`, which imports nothing from `anchor/`, `annotations/`, or `store/`. Do NOT import `collectTextRects`/`rectsFromSelection` from `anchor/`; replicate the tiny per-text-node sub-range measurement locally.
- No contract/store/anchor-MODEL change, no design-token change, no `docs/API.md` change (no `/api` surface touched). No new FR unless the spike validates (then assign at close, mirroring 8.2-8.4).
- If the spike ends negative: the only change is a new section in `.bmad/implementation-artifacts/deferred-work.md`; no production/test file changes.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.9: Snap empty-space drag to nearest text (spike) (lines 2124-2155)]
- [Source: .bmad/implementation-artifacts/8-8-empty-space-drag-no-select.md (the shipped no-op this story tries to replace; `emptyOrigin` latch + `selectstart` suppress + `isEmptyLayerSpace`)]
- [Source: client/src/render/textSelection.ts:37 (isEmptyLayerSpace), :100-248 (#enableGlobalListener: pointerdown latch, releasePointer, selectstart suppress, selectionchange bounding, copy join)]
- [Source: client/src/anchor/index.ts:448 (collectTextRects: per-text-node sub-range + injectable rectsOf, the pattern to replicate in render/), :490 (rectsFromSelection: the create-on-release consumer, unchanged)]
- [Source: .bmad/implementation-artifacts/deferred-work.md#"story 2-5 blank-space text selection" (L62-79, the four reverted attempts), #"Discarded: story 3-8" (L178-187, the caret poison and AE3-7 "resolve once" idea), #"Discarded: Story 4.2 Part B" (L189-197, the design-gate rigor to mirror on a negative outcome)]
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-12-epic-8-snap-select-refactor.md (the correct-course that added Stories 8.9/8.10)]
- [Source: CLAUDE.md#Engineering principles (document-level phase-gated handlers; selection->rects via collectTextRects; cross-page live smoke at DPR>1; launch your own dev servers)]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Live-smoke tool: `claude-in-chrome` extension (real host Chrome, DPR=1.25), fixture `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf`, own `uvicorn --port 8000` + `vite dev --port 5173`.
- Technique A A/B trace (10 repeated empty-space drags at fixed coords, interleaved with on-text drags/clicks): correct/correct/**corrupted(empty,0)**/correct/correct/correct/**corrupted(empty,0)**/correct/correct/**corrupted(empty,0)** — 3/10 poisoned.
- Technique B trace: resolver correct 5/5 repeats (offset 45 = line length, correctly clamped past the line's last glyph). Native-extension control test: drag from x=599 (on-glyph) → real selection extended through following paragraphs; identical drag from x=640 (blank margin, our resolved+collapsed anchor) → stayed `{rangeCount:1, isCollapsed:true, text:""}` under all four `preventDefault()` combinations tried (pointerdown only, selectstart only, both, neither).
- Post-revert regression check: `npm test -- --run` → 1475/1476 pass (1 pre-existing flaky Reader.test.tsx Space-hold-pan timing test, passes in isolation, unrelated to this story — `client/src/render/` untouched); `npm run typecheck` clean; `git status --short client/ server/` empty.

### Completion Notes List

- Spike executed per AC 1-2 exactly as scripted: baseline reproduced first (no code), technique (A) tried first, technique (B) tried only after (A) failed.
- Technique (A) (`caretRangeFromPoint` resolved once at pointerdown) is DEAD: the decisive same-session A/B measurement reproduced the Story 3.8 corruption signature (empty node, offset 0) 3 times out of 10 repeated calls at fixed coordinates, after prior text-layer interaction. No patch attempted, per AC 2.
- Technique (B) (manual `Range` + `getClientRects()` binary search) has a CORRECT, non-flaky anchor resolver (prototyped, live-smoked, a real rotated-span bug found and fixed along the way), but AC 3's "let native drag-extension run" hand-off does not occur when the pointerdown pixel itself misses glyph content — a browser constraint, confirmed via a same-page on-glyph vs off-glyph control drag, not worked around (a workaround would require the explicitly out-of-scope continuous `pointermove`-driven controller).
- Both techniques failed → per AC 5 this is a complete, acceptable outcome. Negative result written up in `deferred-work.md` (new "Discarded: Story 8.9" section + status-ledger row) mirroring the Story 4.2 Part B rigor. All spike code (`render/textSelection.ts` probe edits, the prototype `render/nearestTextAnchor.ts`) reverted; `client/src/render/` is unmodified in the final diff.
- Story 8.8's no-op stays the shipped baseline. No new FR assigned (per Dev Notes, only on a validated spike). Story 8.10 (Epic 8 refactor) is unblocked to proceed next as originally sequenced.

### File List

- `.bmad/implementation-artifacts/deferred-work.md` (modified — new "Discarded: Story 8.9" section + status-ledger row; the only change this story ships)

## Change Log

- 2026-07-12: Spike executed; both named techniques (caret-API resolved-once, manual Range binary search) failed live smoke for different reasons (caret-API mid-session poisoning; native drag-extension does not arm from a script-collapsed selection on an off-glyph pointerdown). Negative result documented in `deferred-work.md`; no production code change. Story 8.8's no-op remains shipped.
