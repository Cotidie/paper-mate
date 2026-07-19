---
baseline_commit: 47502f075e86dda69711a952d3e0e1259460ebf6
---

# Story 10.6: Quick-box pops to the right of the selection

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the quick-box to appear to the right of my selection,
so that it does not cover the text I just selected or the line I am reading.

## Acceptance Criteria

1. **(Right by default for a text selection, item 7, FR-14, NFR-1)** Given a completed text drag-selection (the CREATE tool-picker) OR a selected text-kind mark (highlight/underline, `anchor.kind === "text"`), when its quick-box opens, then the box is positioned to the RIGHT of the selection's right edge, top-aligned to the selection's top, clear of the selected text and the current reading line. The page never shifts (`position: fixed`, NFR-1).

2. **(Graceful overflow fallback, item 7, NFR-1)** Given a selection near the right page/viewport edge where a right-side box would overflow, then the placement flips in this order: RIGHT → LEFT (mirror to the selection's left edge, top-aligned) → BELOW (the pre-10.6 anchor: selection left edge, below its bottom). A final on-screen clamp (the existing `clampToViewport`) always runs last, so the box is fully visible and never clipped in any case.

3. **(Anchor point, resolves open design call)** Given a multi-line text selection, then "right edge" is the MAX right edge across the anchor page's selection rects (clears the widest selected line) and "top" is the FIRST rect's top. Placement is TOP-aligned (not vertically centered) so it aligns with where reading starts and a tall multi-row box against a short selection never lands unpredictably above/below.

4. **(Scope = text marks only; everything else unchanged, resolves open design call, FR-14)** Given the existing non-text quick-box placements, then they are UNCHANGED: the left-vertical-strip marks (memo, box comment, box highlight, per `usesLeftVerticalQuickBox`) keep their LEFT strip; a selected pen (path) mark keeps its BELOW-left anchor; the CREATE picker's empty-click case (Comment + Memo, no selection) keeps its point placement at the click. Right-placement applies ONLY to text selections/marks.

5. **(Shared, unit-tested placement primitive, AD-9-clean)** Given both quick-box code paths (the CREATE picker in the create gesture and the selected-mark box in the selection gesture), then the prefer-right → flip-left → below → clamp decision lives in ONE DOM-free pure function in `annotations/position.ts`, consumed by both, with unit tests covering fits-right, flip-left, below-fallback, final-clamp, top-alignment, and a box taller/wider than the viewport.

6. **(Live-smoked at DPR>1, item 7)** Given the placement change, then it is live-smoked at DPR>1 across a selection at the LEFT, CENTER, and RIGHT of a page (both the CREATE picker and a selected highlight/underline), confirming right-by-default, the near-right-edge flip, no clipping, and no reading-line occlusion.

7. **(No regression)** Given zoom/scroll/resize, then both quick-boxes still live-re-anchor to their selection (the Story 4.x re-derive-on-scroll behavior and `[[fixed-overlay-live-reanchor]]` idiom are preserved, not the old dismiss-on-scroll/stale-on-zoom behavior). Given memo/box-comment/box-highlight/pen selection and the empty-click picker, then their placement, focus behavior (`hasOwnTextEntry` first-swatch autofocus guard), and dismiss-on-pick/outside-click/`Esc` are all unchanged.

## Tasks / Subtasks

- [x] **Task 1 — The shared placement primitive (AC: #1, #2, #3, #5).** In `client/src/annotations/position.ts`, add a pure, DOM-free function beside the existing `rightOf`/`clampToViewport`:
  - A small input type for the selection's viewport bounds, e.g. `export interface SelectionRect { left: number; top: number; right: number; bottom: number; }` (viewport/`position: fixed` px).
  - `export function placeBesideSelection(sel: SelectionRect, boxW: number, boxH: number, vw: number, vh: number, gap = QUICK_BOX_GAP, margin = 8): Point`
    - **Right candidate:** `x = sel.right + gap`, `y = sel.top`. Accept if `x + boxW <= vw - margin`.
    - **Else left candidate:** `x = sel.left - gap - boxW`, `y = sel.top`. Accept if `x >= margin`.
    - **Else below (pre-10.6 anchor):** `x = sel.left`, `y = sel.bottom + gap`.
    - **Always** `return clampToViewport(x, y, boxW, boxH, vw, vh, margin);` as the final safety net (AC #2).
  - Reuse the existing `QUICK_BOX_GAP` constant and `clampToViewport` (do NOT introduce a second gap/margin constant). This is the ONLY new decision logic; both call sites below just feed it measured inputs.

- [x] **Task 2 — CREATE quick-box: expose selection bounds instead of a below-point (AC: #1, #3).**
  - [x] In `client/src/anchor/index.ts`, change `pendingSelectionGeometry` (L424) so `anchor` carries the first page's CARD-LOCAL selection **bounds** rather than a pre-computed below-point: replace `anchor: { pageIndex, point: { x, y } }` (L406, L443) with `anchor: { pageIndex, rect: { left, top, right, bottom } }` where `left = first.left`, `top = first.top`, `right = max(r.left + r.width)` over the first page's rects, `bottom = max(r.top + r.height)` over them. Update the `PendingSelectionGeometry` interface doc (L393-407) to describe bounds, not a below-anchor. The `gap` parameter is no longer applied here (the gap now belongs to `placeBesideSelection`); drop it from the anchor math (keep the param signature only if a caller still needs it — it does not; remove the now-unused `gap` argument from the function and its call in `useCreateQuickBox.ts:143`).
  - [x] In `client/src/annotations/gestures/useCreateQuickBox.ts` `computePendingGeometry` (L132): for the text-drag branch (`state.selection.length > 0`), offset the card-local `geom.anchor.rect` by the anchor card's live `getBoundingClientRect()` (as it already does for the old point at L157-164) into a viewport `SelectionRect`, and expose it on the returned geometry as `selRect`. For the empty-click branch (L169-181), keep returning `boxAt` (a point) unchanged. Update `PendingViewportGeometry` (L45-48): `selRect: SelectionRect | null` (text-drag), `boxAt: { x, y } | null` (empty-click), `previewRects`. Remove `PENDING_BOX_GAP` (L37-41) — the gap now lives in `placeBesideSelection`.

- [x] **Task 3 — CREATE quick-box: place imperatively via the shared helper (AC: #1, #2, #4, #7).** In `client/src/annotations/AnnotationInteraction.tsx`, at the CREATE quick-box render (L414-492):
  - Remove the declarative `style={{ left: ..., top: ... }}` (L425) and make an imperative `useLayoutEffect` the SOLE writer of this element's position — mirroring the selected-mark box, whose comment at L494-501 explains exactly why declarative + imperative both writing fights on re-render.
  - The layout effect (keyed on `pendingGeometry` so it re-runs on the existing scroll/resize/zoom recompute, AC #7): measure `quickBoxRef.current.getBoundingClientRect()`; if `pendingGeometry.selRect` (text drag) → `placeBesideSelection(selRect, w, h, window.innerWidth, window.innerHeight)`; else if `pendingGeometry.boxAt` (empty click) → `clampToViewport(boxAt.x, boxAt.y, w, h, innerW, innerH)`. Set `el.style.left`/`el.style.top`. `useLayoutEffect` runs before paint, so there is no (0,0) flash even on first open (same guarantee the selection box already relies on).
  - The empty-click case now also gets a viewport clamp (it previously had none) — a strict improvement, no behavior regression for the common in-viewport click (AC #4).

- [x] **Task 4 — Selected-mark quick-box: bounds + branch to the helper for text marks (AC: #1, #2, #3, #4, #7).** In `client/src/annotations/gestures/useSelection.ts`:
  - [x] Refactor `selectionPoint()` (L324-360) to return the selected mark's viewport **bounds** as a `SelectionRect` (rename to `selectionBounds()` for clarity): text kind → `{ left: cardRect.left + first.left, top: cardRect.top + first.top, right: cardRect.left + maxRight, bottom: cardRect.top + maxBottom }` (mirror the max-right/max-bottom loop from `pendingSelectionGeometry`); path kind → the points' viewport bbox; rect kind → the denormalized rect's four edges. Return a zero-rect on the no-anchor guard. This is only consumed by `repositionBox` + the hook return (no external consumer positions from it — verified: `selectionPoint` appears elsewhere only in comments), so the shape change is safe.
  - [x] In `repositionBox()` (L381-393): measure `rect = el.getBoundingClientRect()`, get `b = selectionBounds()`, then branch — **text-kind AND not `isVerticalQuickBox`** → `const c = placeBesideSelection(b, rect.width, rect.height, window.innerWidth, window.innerHeight)` (the helper clamps internally; set `el.style.left/top` and return). **`isVerticalQuickBox`** (memo/box comment/box highlight) → keep today's LEFT shift exactly: `clampToViewport(b.left - rect.width - QUICK_BOX_GAP, b.top, ...)`. **Otherwise (pen/path)** → keep today's BELOW anchor exactly: `clampToViewport(b.left, b.bottom + QUICK_BOX_GAP, ...)`. Preserve the `useCallback` dep list discipline (the L311-323 comment explains why `selectionPoint`/`repositionBox` must be `useCallback`, not plain functions — do not regress that).
  - [x] Determine text-kind at the call site from `selectedAnno` (`selectedAnno.type === "highlight" || selectedAnno.type === "underline"` with `anchor.kind === "text"`). Since `usesLeftVerticalQuickBox` already excludes text marks, the ordering "vertical first, else text-beside, else below" also works — pick whichever reads cleanest, but a box highlight (`isBoxHighlight`, `kind=rect`) MUST stay in the vertical branch, not the text branch (it is `type=highlight` but not text-kind).

- [x] **Task 5 — Tests (AC: #1-#5, #7).**
  - [x] `client/src/annotations/position.test.ts`: new `describe("placeBesideSelection ...")` — (a) a box that fits lands to the RIGHT, top-aligned (`x === sel.right + GAP`, `y === sel.top`); (b) a box that would overflow the right edge flips LEFT (`x === sel.left - GAP - boxW`); (c) a box that fits neither side falls BELOW (`x === sel.left`, `y === sel.bottom + GAP`); (d) the below/flip result is still `clampToViewport`-bounded (a below placement near the viewport bottom is pulled up); (e) a box larger than the viewport pins to the top-left margin (delegated clamp); (f) custom `gap`/`margin` honored. Mirror the existing `rightOf`/`clampToViewport` test style at the top of the file.
  - [x] `client/src/anchor/anchor.test.ts`: update the `pendingSelectionGeometry` block (L500-560) for the new `anchor.rect` bounds shape — the three anchor-point assertions (L511, L527, L539) become `anchor.rect` assertions: single rect → `{ left: 0, top: 0, right: 300, bottom: 80 }` (no gap); multi-rect → `left` = first rect's left (60), `top` = first rect's top (0), `right` = max right, `bottom` = lowest bottom (160); scale-doubles → the rect edges double (no gap term to subtract). Keep the null/multi-page/unavailable-box cases.
  - [x] `client/src/annotations/AnnotationInteraction.test.tsx` (or wherever the create/selection quick-box render is covered): keep existing quick-box tests green after the JSX left/top removal — jsdom has no layout so the IMPERATIVE pixel math is live-smoke-only (AC #6), but assert the structural facts that ARE testable in jsdom: the create box still renders its picker buttons for a text-drag vs. empty-click pending, the selected-mark box still renders, and no test asserts a specific declarative `left/top` on these elements any more (remove/adjust any that do).
  - [x] No `render/index.ts` export change → the two `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) need no edit. Run the full suite + `npm run typecheck`.

- [x] **Task 6 — Live smoke at DPR>1 (AC: #6, #7), OWN dev servers, throwaway `PAPER_MATE_DATA`.** Start YOUR OWN `uvicorn` + `vite dev` (never a user-launched/Docker server, CLAUDE.md) with an explicit throwaway `PAPER_MATE_DATA` scratch dir (never `~/.paper-mate`, Story 10.2/10.4/10.5 process note). On a real paper at DPR 2:
  - [x] (a) Drag-select text near the LEFT of a page → the CREATE picker pops to the RIGHT of the selection, top-aligned, not over the text (AC #1).
  - [x] (b) Same near the CENTER → right placement, no reading-line occlusion (AC #1).
  - [x] (c) Same near the RIGHT edge → placement flips LEFT (or below), fully on-screen, no clip (AC #2).
  - [x] (d) Repeat (a)-(c) for a SELECTED highlight and a SELECTED underline (click-select an existing text mark) → the selection quick-box (color row + convert/delete) is right/flip-placed identically (AC #1, #2).
  - [x] (e) Zoom in/out and scroll while a quick-box is open → it live-re-anchors beside the (now moved/zoomed) selection, never detaches or dismisses-on-scroll (AC #7, `[[fixed-overlay-live-reanchor]]`).
  - [x] (f) Regression: select a memo, a box comment (Story 8.4), and a box highlight → each still shows its LEFT vertical strip unchanged; select a pen stroke → its box still sits BELOW; empty-click with the cursor tool → the Comment+Memo picker still appears at the click point (AC #4, #7).
  - [x] Delete the transient test annotations afterward and verify the sandbox doc's `annotations.json`/`library.json` are clean.
  - [x] Prefer trusted input (`claude-in-chrome` `computer` real pointer drag — it forms a real Selection, `[[claude-in-chrome-drag-forms-selection]]`); if it is unavailable (recurring AE7-2/AE6-2), fall back to `chrome-devtools-mcp` with `emulate({viewport:"1400x900x2"})` for DPR 2 and note the deviation (as Stories 10.1-10.5 did). A text drag-selection MUST form a real browser Selection — do NOT use the chrome-devtools/Playwright drag tools for the selection itself (`[[drag-tools-dont-create-text-selection]]`).

- [x] **Task 7 — Version + docs.** No version bump in this change (happens at PR-merge time per CLAUDE.md versioning — next bump is `0.5.36`). This is a pure client change: no `/api` contract change, so `docs/API.md` needs NO edit. No new DESIGN.md token (reuse `QUICK_BOX_GAP`). Grep new/changed UI strings for `—` before committing (there should be none — no copy changes).

## Dev Notes

### Resolved open design calls (from epics.md L2435)

- **Exact anchor point** → RIGHT edge of the selection (max right across the anchor page's rects), TOP-aligned to the first rect's top. Not vertically centered: top-alignment aligns with where reading begins and keeps a tall multi-row selection box (pen has color + stroke-width + alpha rows) from landing unpredictably; it also matches the existing rect-case anchor (`selectionPoint` L356-357 already top-aligns memo boxes).
- **Overflow flip order** → RIGHT → LEFT → BELOW → final `clampToViewport`. Right is the default (AC #1); left is the natural mirror when the right side overflows; below is the pre-10.6 behavior as the last structural fallback; the clamp is the universal never-clip guarantee (AC #2).
- **Whether the left-vertical-strip marks change** → they DO NOT (AC #4). Right-placement is for TEXT selections/marks only. The memo/box-comment/box-highlight left strip is deliberate (it clears the memo collapse toggle and sits beside a region, not over reading text) and is out of scope; changing it risks regressing Stories 10.2/10.4/8.4. Pen (path) stays below-left; the empty-click Comment+Memo picker stays a point placement (no reading line to clear).

### Two placement paths, one primitive (the refactor, AD-9-clean)

There are two independent quick-box code paths, and today each hand-rolls its own "anchor + clamp":
1. **CREATE picker** (text-drag pending, before the mark exists): `pendingSelectionGeometry` (`anchor/index.ts:424`, DOM-free) → `computePendingGeometry` (`useCreateQuickBox.ts:132`, adds live card offset) → rendered declaratively at `pendingGeometry.boxAt` (`AnnotationInteraction.tsx:425`).
2. **SELECTED-mark box** (after create / on click-select): `selectionPoint()` (`useSelection.ts:324`) → `repositionBox()` (`useSelection.ts:381`, shift + `clampToViewport`, imperative sole-writer on open/zoom/scroll/resize/drag).

Story 10.6 unifies the DECISION (prefer-right → flip → below → clamp) into one pure `placeBesideSelection` in `position.ts` that both paths consume — the same move `rightOf`/`clampToViewport` already made for the box-comment popup. This is less code than two flip implementations and is the only unit-tested piece (jsdom has no layout, so the pixel wiring is live-smoke-only). The paths stay separate where they legitimately differ (the CREATE preview-rect pass, the selection re-anchor deps); only the placement decision is shared.

### Why the CREATE box moves to imperative positioning

Today the CREATE box sets `left/top` declaratively from `boxAt`. Right-placement + flip needs the MEASURED box width, which is only known after render — so the box must be positioned in a `useLayoutEffect` (measure the ref, decide, set `style.left/top`), exactly like the selected-mark box already is. The selected-mark box's L494-501 comment documents the failure mode of BOTH declarative and imperative writing the same element (oscillation on zoom): follow it — remove the JSX `left/top`, make the layout effect the sole writer, key it on `pendingGeometry` so it re-runs on the existing scroll/resize/zoom recompute. `useLayoutEffect` runs before paint, so there is no first-frame (0,0) flash.

### Preserve exactly (regression guards, AC #4/#7)

- `usesLeftVerticalQuickBox` (`marks.ts:112`) and `hasOwnTextEntry` (`marks.ts:125`) semantics are UNCHANGED — do not touch `marks.ts`. The vertical branch in `repositionBox` keeps `b.left - width - QUICK_BOX_GAP, b.top` (today's exact left shift). A box highlight is `type=highlight` but `kind=rect` → it stays in the VERTICAL branch, NOT the text-beside branch (AC #4; `hasOwnTextEntry` deliberately excludes it so it keeps first-swatch autofocus — do not conflate).
- Pen (path) keeps below-left: `b.left, b.bottom + QUICK_BOX_GAP`.
- The empty-click CREATE picker keeps its click-point placement (now additionally viewport-clamped — a strict improvement).
- The Story 4.x re-derive-on-scroll/zoom behavior and the `[[fixed-overlay-live-reanchor]]` idiom (re-derive the screen point on scroll/resize/zoom, scroll fires no re-render) must survive on BOTH paths — the create path already recomputes `pendingGeometry` on those events; the selection path already re-runs `repositionBox` on them. Do not remove those effects.
- Focus (first-swatch autofocus guard via `hasOwnTextEntry`), dismiss-on-pick/outside-click/`Esc`, and the `useCallback` dep discipline (L311-323) are untouched.

### Coordinate / unit rules (AD-4 / AD-9 — do not violate)

Anchors stay normalized `[0,1]` page fractions (AD-4); this story only changes where a `position: fixed` popup sits in VIEWPORT px, derived from the anchor via the existing denormalize helpers. No `anchor/` math changes except `pendingSelectionGeometry`'s output SHAPE (below-point → bounds rect); the denormalize call it makes is unchanged. `placeBesideSelection` is DOM-free (AD-9-clean: pure data in `position.ts`, no store/anchor/React import beyond the `ScreenRect`/`Point` types).

### Testing standards

- Backend: none (pure client change; no backend touched). Frontend: `cd client && npm test` + `npm run typecheck`.
- jsdom has no layout (`getBoundingClientRect` = 0), so the imperative pixel placement (AC #1, #2) is **live-smoke only**; the pure `placeBesideSelection` decision (AC #5) and `pendingSelectionGeometry`'s bounds output (AC #3) are fully unit-testable.
- **Live smoke mandatory at DPR>1** on a real paper with YOUR OWN dev servers and an explicit throwaway `PAPER_MATE_DATA` (Story 10.2 process note — never `~/.paper-mate`). Selection features MUST use trusted input that forms a real Selection (`[[claude-in-chrome-drag-forms-selection]]`); `[[verify-on-hidpi-and-real-host]]`.

### Project Structure Notes

- Downward-dependency rule holds: `position.ts` (pure) ← `useSelection.ts`/`useCreateQuickBox.ts` (gestures) ← `AnnotationInteraction.tsx` (view); `anchor/index.ts` (pure geometry) stays leaf-level. No new module; the change is one new pure function + rewiring two existing call sites. The `MemoBox`/`CommentBubble` handle-markup duplication is Story 10.9's (terminal Epic 10 refactor) concern — do not refactor it here.

### References

- Epic + ACs + open design calls: [Source: .bmad/planning-artifacts/epics.md#Story 10.6] (L2412-2435).
- Source of the request (item 7, polish): [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-18.md] (L34, L136).
- FR-14 (drag-to-change-tool / contextual quick-box), UX-DR5 (contextual quick-box, positioned at selection, never shifts canvas), UX-DR17 (quick-box keyboard-reachable + `Esc`-dismissable): [Source: .bmad/planning-artifacts/epics.md] (L142, L112, L124). NFR-1 (overlay never reflows canvas).
- Prior-story continuity (own dev servers + throwaway `PAPER_MATE_DATA`, DPR>1 smoke, delete transient data, `claude-in-chrome`-unavailable → `chrome-devtools-mcp` fallback): [Source: .bmad/implementation-artifacts/10-5-persist-comment-box-position.md].
- Code touch points (verbatim, current):
  - Pure placement: `client/src/annotations/position.ts` — `rightOf` L47-49, `clampToViewport` L22-37, `QUICK_BOX_GAP` L15 (add `placeBesideSelection` + `SelectionRect` beside these); tests `client/src/annotations/position.test.ts`.
  - CREATE geometry: `client/src/anchor/index.ts` — `PendingSelectionGeometry` L399-407, `pendingSelectionGeometry` L424-445 (below-point → bounds rect); tests `client/src/anchor/anchor.test.ts:500-560`.
  - CREATE controller: `client/src/annotations/gestures/useCreateQuickBox.ts` — `PENDING_BOX_GAP` L37-41 (remove), `PendingViewportGeometry` L45-48, `computePendingGeometry` L132-183 (text-drag L138-166 → emit `selRect`; empty-click L169-181 keep `boxAt`).
  - CREATE render: `client/src/annotations/AnnotationInteraction.tsx` — create quick-box L414-492 (remove declarative L425 `style`, add imperative layout effect using `quickBoxRef` L201).
  - SELECT controller: `client/src/annotations/gestures/useSelection.ts` — `selectionPoint` L324-360 (→ bounds), `repositionBox` L381-393 (branch to `placeBesideSelection` for text), `isVerticalQuickBox` L289, `useCallback`-discipline note L311-323.
  - Registry (read-only, DO NOT edit): `client/src/annotations/marks.ts` — `usesLeftVerticalQuickBox` L112, `hasOwnTextEntry` L125, `isBoxHighlight` L101.
- Relevant memories: [[fixed-overlay-live-reanchor]], [[drag-tools-dont-create-text-selection]], [[claude-in-chrome-drag-forms-selection]], [[verify-on-hidpi-and-real-host]], [[ancestor-ref-passive-effect]].

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Own dev servers only (never a user-launched/Docker server, CLAUDE.md): `uv run uvicorn app.main:app --port 8123` with `PAPER_MATE_DATA` pointed at a throwaway scratch dir, and `vite --port 5183 --strictPort` proxying to it (`PAPER_MATE_API_TARGET=http://127.0.0.1:8123`). Imported `fixtures/sample-pdfs/1903.03295v2.pdf` via `POST /api/docs`.
- `claude-in-chrome` was connected this session but has no DPR/viewport-emulation control, so `chrome-devtools-mcp` was used instead for the DPR>1 smoke (`emulate({viewport:"1400x900x2"})`, later narrowed to `1250x900x2` to force the near-right-edge overflow case) — the recorded Stories 10.1-10.5 fallback pattern (`[[verify-on-hidpi-and-real-host]]`).
- Selections were formed via a real `Range`/`Selection.addRange` (native browser Selection; per `[[drag-tools-dont-create-text-selection]]` the chrome-devtools-mcp drag tool does NOT form one, so a scripted Range was used instead) over real pdf.js text-layer spans, then a synthetic `pointerup` dispatched at the selection's end — the app's document-level handler does not gate on `event.isTrusted`.
- Live-verified at DPR 2 (`window.devicePixelRatio` confirmed 2.0000...): CREATE quick-box right-placement for a LEFT-of-page ("Abstract" heading, box left = sel.right+6 exact), a CENTER selection (same formula, exact), and a RIGHT/near-edge selection at a narrowed 1250px viewport that triggered the LEFT flip (box left = sel.left-6-boxW exact, both top-aligned to sel.top exact). Committed the pending selection into a real highlight and confirmed the SELECTED-mark quick-box (non-vertical class) uses the identical flip-left placement. Verified scroll re-anchor (canvas `scrollTop` change moved the box top by the same delta, box stayed open) and zoom re-anchor (`Zoom in` click repositioned the box, stayed open) for the CREATE box, and scroll re-anchor for the selected-mark box.
- Verified underline (selected-mark, non-vertical class, right-placed with the same exact-math clamp catching an intentionally off-screen selection top — the universal never-clip safety net, AC #2).
- Regression-verified all four AC #4 non-text placements are unchanged live: memo (vertical-strip class, exact left-shift formula, existing clamp still pulls a tall box up off the viewport bottom), box highlight (`type=highlight`,`kind=rect` — critical guard confirmed: vertical-strip class, NOT the text branch), box comment (vertical-strip class + its own beside bubble, per Story 8.4), pen/path (non-vertical class, BELOW-anchor using the raw stroke points' bbox, not the rendered stroke's padded visual bbox — matches the pre-10.6 formula exactly), and the cursor-mode empty-click Comment+Memo picker (point placement at the click, now viewport-clamped).
- Cleanup: `DELETE /api/docs/{doc_id}` on the transient test doc, confirmed `GET /api/library` empty afterward; both dev servers killed and the throwaway `PAPER_MATE_DATA` scratch dir removed. An incidental `server/uv.lock` version-metadata sync produced by running `uv run uvicorn` (unrelated to this story, pyproject.toml's version was already committed) was reverted to keep the diff scoped (recurred a second time after the fix-request round below; reverted again).
- **Fix request (mid-story, user-reported via screenshot):** a selected TEXT comment's bubble (`CommentBubble`) spawned at the raw pin point (often overlapping/below the annotated text) instead of beside the selection like a highlight/underline, and its position was clamped fully inside the viewport. Live-verified the fix on a fresh pair of dev servers (own `uvicorn --port 8124` / `vite --port 5184`, throwaway `PAPER_MATE_DATA`, DPR 2): a text comment on "Abstract" now opens its bubble at `sel.right+6, sel.top` exactly (no pin-offset transform); a comment on a selection near a narrowed viewport's right edge now renders with its bubble's right edge PAST the viewport boundary (`br.right > vw` confirmed), proving the clamp is gone. Cleaned up (doc deleted, library empty, servers killed, scratch dir + incidental `uv.lock` diff removed) the same way as the main round.

### Completion Notes List

- Added `placeBesideSelection` + `SelectionRect` to `client/src/annotations/position.ts`: prefer-right (top-aligned) → flip-left → below → final `clampToViewport`, reusing the existing `QUICK_BOX_GAP` constant. Fully unit-tested (6 new cases covering fits-right, flip-left, below-fallback, below-then-clamped, oversized-box clamp, and custom gap/margin).
- `anchor/index.ts`'s `pendingSelectionGeometry` now returns the first page's selection BOUNDS (`anchor.rect`, max-right/max-bottom across the first page's rects) instead of a pre-computed below-point; the `gap` parameter is gone (the gap now lives solely in `placeBesideSelection`). Updated the one other caller (`useLiveSelectionPreview.ts`, which only reads `geom.pages` and never touched `anchor`).
- `useCreateQuickBox.ts`'s `PendingViewportGeometry` now carries `selRect: SelectionRect | null` (text drag) XOR `boxAt: Point | null` (empty click); removed the now-dead `PENDING_BOX_GAP` constant and the old boxAt-only imperative clamp effect (that positioning logic moved to the render layer, below).
- `AnnotationInteraction.tsx`: removed the CREATE quick-box's declarative `style={{left,top}}` and added a `useLayoutEffect` (keyed on `pendingGeometry`) as the sole position writer — branches on `selRect` (→ `placeBesideSelection`) vs `boxAt` (→ `clampToViewport`), mirroring the selected-mark box's existing imperative-sole-writer pattern and its documented double-write hazard.
- `useSelection.ts`: renamed `selectionPoint` → `selectionBounds` (returns a `SelectionRect`, not a point; verified it has no consumer outside this file's own `repositionBox` + its own return). `repositionBox` now branches: `isVerticalQuickBox` (memo/box-comment/box-highlight) keeps the exact pre-10.6 left-shift formula; a text-kind mark (`effectiveAnchor.kind === "text"`, which structurally excludes a box highlight since that anchor is `kind=rect`) routes to `placeBesideSelection`; everything else (pen/path) keeps the exact pre-10.6 below-anchor formula.
- All 5 ACs backed by unit tests where jsdom permits (AC #3, #5) and live DPR-2 smoke where it doesn't (AC #1, #2, #6, #7) — see Debug Log. Full suite: 1597/1597 frontend tests pass, `npm run typecheck` clean. No backend change (pure client story). No version bump this change (per Task 7, happens at PR-merge time), no `/api` or `docs/API.md` change, no new DESIGN.md token (reused `QUICK_BOX_GAP`), no new UI copy (nothing to grep for em-dash).
- **Fix request addendum:** extended the same "beside the anchor, no clamp" treatment to the comment BUBBLE/PREVIEW (`CommentBubble`/`CommentPreview`), which sit outside the two quick-box paths the ACs describe but share the same underlying complaint. `commentScreenPoint`'s text-kind branch now computes BOUNDS (max-right/max-bottom across all rects, mirroring `selectionBounds`), not just the first rect, so a multi-line text comment shifts beside its widest line. A new `commentBesideAnchor(a)` helper (`isBoxComment(a) || a.anchor.kind === "text"`) decides right-shift-via-`rightOf` vs the untouched raw-point/below-pin-nudge case (a degenerate click-placed pin only, unchanged). Introduced a `besideAnchor` prop on `CommentBubble` (distinct from the chrome-only `compact` prop: a text comment now positions like a box comment but keeps its own full internal controls) and reused `CommentPreview`'s existing purely-positional `compact` prop. Removed the `clampToViewport` nudge from both components' reposition effects entirely (deliberate: a note the user is reading/typing may now overflow the viewport rather than jump to an unrelated spot). Added 2 new unit tests (single-line right-shift + no-pin-transform, multi-line max-right) plus fixed 1 existing `CommentBubble.test.tsx` case that asserted `compact` alone controlled the transform (now needs `besideAnchor` too, matching how the two props are always passed together in production for a box comment). Full suite after the fix: 1599/1599 pass, typecheck clean.

### File List

- `client/src/annotations/position.ts` — added `SelectionRect` + `placeBesideSelection`.
- `client/src/annotations/position.test.ts` — added `placeBesideSelection` test suite.
- `client/src/anchor/index.ts` — `PendingSelectionGeometry`/`pendingSelectionGeometry`: below-point → bounds rect, dropped the `gap` param.
- `client/src/anchor/anchor.test.ts` — updated `pendingSelectionGeometry` assertions for the new bounds-rect shape.
- `client/src/annotations/gestures/useCreateQuickBox.ts` — `PendingViewportGeometry` gains `selRect`/`boxAt`; removed `PENDING_BOX_GAP` and the old boxAt-only clamp effect.
- `client/src/annotations/gestures/useLiveSelectionPreview.ts` — updated the `pendingSelectionGeometry` call site (dropped the removed `gap` arg).
- `client/src/annotations/AnnotationInteraction.tsx` — CREATE quick-box: removed declarative `style`, added the imperative sole-writer `useLayoutEffect`; updated two stale comments referencing the old `selectionPoint` name.
- `client/src/annotations/gestures/useSelection.ts` — `selectionPoint` → `selectionBounds`; `repositionBox` branches to `placeBesideSelection` for text marks, unchanged formulas for vertical/pen.
- `client/src/annotations/AnnotationInteraction.test.tsx` — added 2 tests for the text comment's new beside-selection bubble position (single-line + multi-line max-right).
- `client/src/annotations/CommentBubble.tsx` — fix request: `commentScreenPoint`'s text branch now computes bounds across all rects; new `besideAnchor` prop drives the pin-offset-transform decision (was `compact`); removed the `clampToViewport` reposition nudge.
- `client/src/annotations/CommentBubble.test.tsx` — updated the compact-transform test to also pass `besideAnchor` (matching production usage).
- `client/src/annotations/CommentPreview.tsx` — fix request: removed the `clampToViewport` reposition nudge (its `compact` prop was already purely positional, now fed `commentBesideAnchor`).
- `client/src/annotations/AnnotationInteraction.tsx` — fix request: added `commentBesideAnchor` helper; `getSelectedCommentPoint` and the hover-preview loop now shift a text-kind comment beside its selection (previously box-comment-only); pass `besideAnchor` to `CommentBubble`.

## Change Log

- 2026-07-19: Story created (bmad-create-story). Resolved the three epics.md open design calls: (1) anchor = selection's RIGHT edge (max right across the anchor page's rects), TOP-aligned to the first rect's top; (2) overflow flip order RIGHT → LEFT → BELOW → final `clampToViewport`; (3) scope = TEXT selections/marks ONLY — the left-vertical-strip marks (memo/box comment/box highlight), pen (below-left), and the empty-click Comment+Memo picker are all unchanged. Architected the change as one shared DOM-free `placeBesideSelection` primitive in `position.ts` consumed by both quick-box paths (create picker + selected-mark box), moving the CREATE box from declarative to imperative (layout-effect) positioning to match the selected-mark box and get the measured width the flip needs. `pendingSelectionGeometry`'s `anchor` output changes from a below-point to a bounds rect; `selectionPoint` → `selectionBounds`. Pure client change, no `/api` or DESIGN.md token change; version bumps to 0.5.36 at PR merge.
- 2026-07-19 (dev-story, mid-implementation fix request): a selected TEXT comment's bubble spawned at the raw pin point (often overlapping the annotated text) instead of beside the selection, and its position was clamped fully inside the viewport. Extended the story's "beside the anchor" treatment to `CommentBubble`/`CommentPreview`: a text-kind comment now right-shifts via `rightOf` off its selection BOUNDS (max-right across all rects, like `placeBesideSelection`'s own input), skipping the old below-pin nudge; the `clampToViewport` reposition nudge was removed entirely from both components (deliberate — a note the user may be reading/typing can now overflow the viewport). A degenerate click-placed pin comment is unaffected (no selection to sit beside). Live-verified at DPR 2 on fresh dev servers.
