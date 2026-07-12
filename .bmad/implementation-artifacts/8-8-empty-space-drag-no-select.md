---
baseline_commit: 72d70d6d66576eba6da6541cf3adb0da240bde41
---

# Story 8.8: Empty-space drag does not select underlying text

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a drag that starts in empty page space to do nothing to the text,
so that I do not accidentally select or copy the nearby text lines.

## Acceptance Criteria

1. **Given** the pointer over empty page space (a margin, gutter, or blank area of a rendered page with no glyph under it), **When** I press the primary button and drag from there (in any direction, including onto text), **Then** NO native text selection is created: the underlying rows are not snapped-to and grabbed, so there is no accidental selection or copy of the text (FR-13). This is the exact defect in the screenshot: a drag begun in the blank space to the right of "NYU v2." currently selects every row below it.

2. **Given** a drag that starts ON text (the primary button goes down over a glyph run), **Then** normal text selection is unchanged: single-line, multi-line, and cross-page selections still form, still highlight/underline/comment on release, and still copy (Ctrl+C) exactly as before. This story gates ONLY the empty-space ORIGIN case.

3. **Given** the resolved behavior of an empty-space drag (design call, decided here): it is a **no-op for text** (the native selection is suppressed), and the active tool, if any, is unaffected. Pen, box-highlight/box-comment, memo-place, comment-pin, box-select-marquee, and pan all run on pointer events and do not read the native Selection, so suppressing native selection neither breaks them nor changes their gesture. In cursor mode an empty-space drag simply does nothing (matching the pre-existing behavior that a whitespace drag with an empty selection creates no mark).

4. **Given** the detection of "empty space" (design call, decided here): it is **target-based, not geometry/caret-based**. The origin is empty space when the pointerdown target is a registered `.textLayer` container element itself (or its `.endOfContent` child), i.e. NOT a glyph-bearing `<span>` descendant of that layer. Do NOT use `document.caretRangeFromPoint` / `caretPositionFromPoint` for this: both are the confirmed-corrupt-mid-drag APIs that blocked Story 3.8 and Story 4.2 (see Dev Notes) and must not be reintroduced.

5. **Given** the change, **Then** it is live-smoked at DPR>1 on your own fresh dev servers with BOTH an empty-margin drag AND a cross-column empty-gutter drag, and it does NOT reintroduce the full-page-highlight or cross-column-leak the `anchor/` layer guards. Confirm on-glyph selection (single-line, multi-line, and a CROSS-PAGE selection) still works after the change (AC 2). A unit test alone does NOT satisfy this: jsdom has no real Selection geometry or `::selection`, so the defect and its fix are invisible there.

6. **Given** any new user-facing string (none expected for this story), **Then** it contains no em-dash (UX-DR13).

## Tasks / Subtasks

- [x] **Confirm the root cause on your own servers first (10 min, no code)** (AC: 1)
  - [x] Import `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf` into a fresh `uvicorn` + `vite dev` (your OWN, not a found-running server) at DPR>1, open page 1 at ~180%.
  - [x] In cursor mode, press-drag DOWN starting from the blank space to the right of "NYU v2." and confirm the reported over-select (all rows grab). Note whether the pointerdown `e.target` is the `.textLayer` div (use a temporary `console.log(e.target)` or DevTools "inspect"). This confirms the target-based detection in AC 4 before you build on it.
- [x] **Add the empty-space-origin gate in `render/textSelection.ts`** (AC: 1, 3, 4)
  - [x] Extract a pure, DOM-classifiable helper (e.g. `isEmptyLayerSpace(target, textLayers)` or a small module-private function) that returns true when `target` is a registered `.textLayer` element itself or carries `endOfContent`, and false when it is a glyph `<span>` descendant, an editor/chrome node, or anything outside a registered layer. Keep it DOM-free of layout (target classification only) so it is unit-testable in jsdom.
  - [x] In `TextSelectionController.#enableGlobalListener`, track an `emptyOrigin` boolean: set it on the existing document `pointerdown` listener (add the event arg it currently omits) from the helper, and clear it in the SAME places `pointerDown` is reset today (the `pointerup` and window `blur` handlers) so a stale flag can never leak into the next gesture (the recurring held-state bug: see `[[reset-held-key-state-on-blur]]`).
  - [x] Suppress the native selection when `emptyOrigin` is set. Primary approach: a `{ signal }`-scoped document `selectstart` listener that calls `e.preventDefault()` while `emptyOrigin` is true. This blocks ONLY the selection attempt (not focus, clicks, pointer capture, or any tool's pointer gesture), and because the flag is latched at pointerdown it also covers a drag that begins in blank space and wanders onto text (AC 1). If live smoke shows `selectstart` does not reliably stop it over the pdf.js text layer in Chromium, fall back to `e.preventDefault()` on a document `mousedown` when the origin is empty space (documented tradeoff: mousedown-preventDefault also suppresses focus, which is acceptable for blank page space). Decide by what actually stops the selection in the live smoke, not on paper.
  - [x] Do NOT gate a press on a glyph span, a `<br>`, a memo/comment editor, Bank text, or app chrome: the helper returns false for all of those, so `emptyOrigin` stays false and native selection proceeds untouched (AC 2).
- [x] **Unit test the pure helper** (AC: 4)
  - [x] In `render/textSelection.test.ts`, build a `.textLayer` div (register it), append a child glyph `<span>`, and assert the helper: container element → true, `.endOfContent` → true, child span → false, an unrelated/unregistered element → false. Do NOT try to assert the end-to-end selection suppression in jsdom (no real Selection).
  - [x] `cd client && npm test && npm run typecheck` clean. No `render/index.ts` export is added, so the `vi.mock("./render")` barrels in `App.test.tsx`/`Reader.test.tsx` need no change (this module is imported by `render/index.ts`, not re-exported from the barrel).
- [x] **Verify (live, own servers)** (AC: 1, 2, 5)
  - [x] On your OWN fresh servers at DPR>1: (a) empty right-margin drag on page 1 makes NO selection; (b) empty cross-column gutter drag (between the two columns) makes NO selection and does NOT leak a cross-column or full-page highlight; (c) a normal on-text single-line, multi-line, and CROSS-PAGE drag still selects and still highlights on release; (d) Ctrl+C on an on-text selection still copies (paragraph-join unchanged). Use trusted pointer input (raw mouse move/down/up), not `dispatchEvent`/`.click()` or a synthetic Range: this defect only reproduces with a real native selection gesture (see `[[drag-tools-dont-create-text-selection]]`, `[[use-trusted-input-for-focus-sensitive-smoke]]`).
  - [x] Shut the dev servers down after.

## Dev Notes

### Root cause (confirmed by reading the code)

Text selection over the PDF is **plain browser-native selection** over the raw pdf.js text layer (AD-2). There is no custom selection engine to fix: `client/src/annotations/gestures/useCreateQuickBox.ts` reads `window.getSelection()` on `pointerup` (`rectsFromSelection`, useCreateQuickBox.ts:289-290) and builds the highlight/underline/comment from whatever the native selection already is. So the "all rows get grabbed" behavior is produced entirely by the browser BEFORE our code runs: when the primary button goes down on the `.textLayer` container (blank margin/gutter, no glyph there), the browser anchors the caret at the nearest text position and, because the whole text layer is one contiguous block, dragging extends the selection through every span in between. Highlight geometry itself is already safe (`anchor/collectTextRects` measures per-text-node rects, never element boxes, so a leaked selection never paints a full-page highlight), but the SELECTION is still wrong and copyable. The fix must stop the native selection from STARTING when the origin is empty space.

### Where the fix goes: `client/src/render/textSelection.ts` (`TextSelectionController`)

This singleton already owns the native-selection lifecycle for every live page card and is the cohesive home for the gate:
- It holds the registry of live `.textLayer` divs (`#textLayers`, a `Map<Element, HTMLElement>` of layer → its `endOfContent`), so the helper can check membership.
- Its `#enableGlobalListener` already binds document `pointerdown` / `pointerup` / window `blur` and tracks a `pointerDown` boolean, resetting it on `pointerup` and `blur` (textSelection.ts:96-116). Add an `emptyOrigin` boolean alongside it, set on `pointerdown` and cleared in the exact same reset spots. This reuses the existing `{ signal }`-scoped listener set (enabled on first `register`, torn down on last `unregister`) rather than standing up a second global manager, matching how Story 8.1 added its `copy` listener here.
- `register` (textSelection.ts:45-53) appends the `.endOfContent` div and binds the per-layer `mousedown` that toggles `.selecting`. The DOM shape you classify against: a registered `<div class="textLayer">` containing pdf.js glyph `<span>`s + `<br>`s + one `<div class="endOfContent">`. A blank-space press targets the `.textLayer` div itself or the `.endOfContent`; a glyph press targets a child `<span>`.

### The two design calls the epic left open, resolved here

- **"underlying rows" = pdf.js text-layer lines/runs (the `<span>`s).** Confirmed by the render path (`render/index.ts` `renderPage` builds the layer via pdf.js `TextLayer`, PageCard mounts it as `<div className="textLayer">`). There is no table/list surface to special-case; every page's selectable text is this one layer.
- **Empty-space behavior = no-op for text (suppress native selection); active tool unaffected.** Every annotation/navigation tool drives its gesture off POINTER events and its own draft refs (pen: `usePenGesture`; box: `useBoxGesture`; memo: `useMemoPlacement`; comment pin + cursor picker: `useCreateQuickBox`; marquee: `useMultiSelectGesture`; pan: `reader/usePanControl`), none of which read the native Selection to build their mark. So "defer to the active tool" and "no-op" collapse to the same implementation: kill the native text selection on an empty-space origin and leave everything else alone. In cursor mode this means the drag does nothing, which is already the intended outcome (a whitespace drag yields an empty selection and `useCreateQuickBox` creates no mark).
- **Detection = target-based.** Empty space ⇔ pointerdown target is a registered `.textLayer` element or its `.endOfContent`, NOT a glyph `<span>`. Cheap, synchronous, and it sidesteps the caret APIs entirely (next section).

### Do NOT reach for the caret APIs, and do NOT reopen the multi-column controller

- `document.caretRangeFromPoint` / `caretPositionFromPoint` are CONFIRMED corrupt during an in-flight drag over the pdf.js glyph substrate (empty span, offset 0, sometimes the wrong page): this is the hard blocker that killed Story 3.8 and gated Story 4.2. See `deferred-work.md` sections "story 3-8" and "Discarded: Story 4.2 Part B". Target classification needs none of them.
- This story is scope-guarded to the narrow empty-space-origin case. It is NOT the deferred layered multi-column selection controller (the "drag INTO a line's trailing blank space snaps to nearest text in DOM order" over/under-shoot, and the interleaved-header cross-column case). Those stay deferred. Do not attempt column-band clipping, a logical anchor→focus model, or reading back `window.getSelection()` rects to filter them: every prior attempt down that road regressed and was reverted (`deferred-work.md`, commits `03d471b` / `a294ca9`). If your change starts fighting the browser's contiguous range or post-filtering native rects, stop: that is out of scope.

### Regressions to protect (read before editing)

- **`render/textSelection.ts`**: the `selectionchange` handler bounds the live selection via `endOfContent` (Story 4.1) and the `copy` handler does paragraph-join (Story 8.1). Your `emptyOrigin` flag + `selectstart` listener must be additive and share the same `{ signal }` teardown; do not alter the `pointerup`/`blur` reset semantics beyond also clearing `emptyOrigin` there. The per-layer `mousedown` -> `.selecting` toggle in `register` should keep working; if you take the `mousedown`-preventDefault fallback, note it still lets `.selecting` toggle (harmless with no selection) but must only preventDefault on the empty-space branch.
- **`useCreateQuickBox.ts`**: unchanged. It already does nothing on an empty selection in cursor mode and rejects a wandered comment-click via `COMMENT_CLICK_SLOP` (useCreateQuickBox.ts:33-35, 300-313). Once native selection is suppressed at the origin, `rectsFromSelection` returns `[]` for the empty-space drag, so this path is already correct.
- **Cross-page selection** is the highest-risk path and jsdom cannot see it: an on-glyph cross-page drag MUST still select and highlight after your change (CLAUDE.md engineering principle; `[[verify-on-hidpi-and-real-host]]`).

### Testing standards

- Vitest (jsdom). Unit-test ONLY the pure target-classification helper (see Tasks). jsdom has no real Selection/`::selection`/layout, so the suppression behavior and the defect are not assertable there (mirrors the existing `textSelection.test.ts` header comment, which restricts its coverage to registry/lifecycle bookkeeping for the same reason).
- Live smoke is the real acceptance gate (AC 5), on your own fresh servers at DPR>1, with trusted pointer input. Carries action item AE7-4 (the DPR>1 cross-page/cross-column smoke backfill routed to "the next epic touching cross-page PDF selection"): fold the empty-gutter cross-column drag and the on-text cross-page drag into this smoke.

### Prerequisite

The repo fixture `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf` is the exact paper in the screenshot (two-column, page 1 has the "NYU v2." blank-space case). Use it for the repro and the smoke so you are testing the reported surface.

### Project Structure Notes

- Single touched production file: `client/src/render/textSelection.ts`. Single touched test file: `client/src/render/textSelection.test.ts`. No new file, no new `render/` barrel export, no contract/store/anchor change, no design-token change, no `docs/API.md` change (no `/api` surface touched).
- Layer rule honored (AD-9): the fix lives in `render/`, which imports nothing from `anchor/`, `annotations/`, or `store/`. It classifies DOM targets against its own `.textLayer` registry only.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.8: Empty-space drag does not select underlying text (lines 2099-2122)]
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-11-epic-8-9-stories.md#4h + Sequencing + Carried action item AE7-4]
- [Source: client/src/render/textSelection.ts (TextSelectionController: register, #enableGlobalListener, pointer/blur reset)]
- [Source: client/src/render/index.ts#renderPage (pdf.js TextLayer build) + client/src/reader/PageCard.tsx (.page-surface / .textLayer DOM)]
- [Source: client/src/annotations/gestures/useCreateQuickBox.ts#onPointerUp (native getSelection → rectsFromSelection create path)]
- [Source: .bmad/implementation-artifacts/deferred-work.md#"story 2-5 blank-space text selection" + "story 3-8" + "Discarded: Story 4.2 Part B" (why not the caret APIs / not the multi-column controller)]
- [Source: CLAUDE.md#Engineering principles (document-level phase-gated handlers; selection→rects via collectTextRects; cross-page live smoke at DPR>1)]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Repro on own fresh `uvicorn --port 8123` + `vite --port 5183` (DPR-scaled via `--force-device-scale-factor`-equivalent Chrome tab; PDF opened at 200% zoom): confirmed `document.elementFromPoint` at the blank space after "NYU v2." (right column, page 1) resolves to `<div class="endOfContent">` inside `<div class="textLayer">` — the exact target the AC-4 helper gates on. A drag from that point pre-fix selected every row below it (and even leaked into the left-margin arXiv sidebar text), matching the reported defect.
- Post-fix, the same drag produces no selection; a cross-column empty-gutter drag (target confirmed as the `.textLayer` div itself) also produces no selection and no leak. On-text drags (single-line, multi-line, and a cross-page drag spanning the page 1/page 2 boundary) still select and show the highlight/underline/comment toolbar. `selectstart`-based suppression worked reliably in Chromium; the `mousedown`-preventDefault fallback documented in the story was not needed.
- Ctrl+C on an on-text selection was exercised live (key press) without regression; the `copy` handler itself is untouched by this diff and remains covered by existing `textSelection.test.ts` tests.

### Completion Notes List

- Added `isEmptyLayerSpace(target, textLayers)` (exported, pure, DOM-classification only) to `render/textSelection.ts`: true for a registered `.textLayer` container or its `endOfContent` child, false otherwise.
- `TextSelectionController.#enableGlobalListener` now latches an `emptyOrigin` boolean at `pointerdown` (via the helper) and clears it in the same `pointerup`/`blur` reset spots as `pointerDown`, so it can't leak into the next gesture.
- Added a `{ signal }`-scoped `selectstart` listener that calls `event.preventDefault()` only while `emptyOrigin` is true — additive, shares the existing teardown, does not touch the `pointerup`/`selectionchange`/`copy` handlers.
- Unit-tested `isEmptyLayerSpace` directly (container → true, `endOfContent` → true, glyph span → false, unregistered element → false, null target → false) in `textSelection.test.ts`. jsdom coverage intentionally stops there (no real Selection/`::selection`).
- Live-smoked on fresh own dev servers at 200% zoom against `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf`: empty right-margin drag (AC-1) and empty cross-column gutter drag both produce no selection and no leak; on-text single-line, multi-line, and cross-page drags still select and highlight (AC-2); Ctrl+C still fires without error. Both dev servers were shut down after.
- Full suite: `cd client && npm test` → 70 files / 1474 tests passed. `npm run typecheck` clean. No `render/index.ts` export added, so the `vi.mock("./render")` barrels needed no change.

### File List

- `client/src/render/textSelection.ts` (modified)
- `client/src/render/textSelection.test.ts` (modified)
