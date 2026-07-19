---
baseline_commit: f1a69f1360c2cb1629c0c2e8260716ffe0947257
---

# Story 9.2: Memo resize-handle position and minimum-size fix

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a memo's resize handles to sit exactly on its corners at any size, and to be able to shrink a memo to a sensible small minimum without the handles detaching or the text-entry clipping unusably,
so that I can grab and resize memos precisely.

## Acceptance Criteria

1. **(Handle position, item 3, FR-15, NFR-3)** Given a selected memo in its edit frame, when the corner handles render, then all four (including the two bottom handles) sit exactly on the box corners at every size and zoom level, not offset from the box edge.
2. **(Diagnosis-first, item 3)** Given the story, then it STARTS with a written root-cause diagnosis of the offset (a min-height/width clamp fighting handle placement, a border-box vs content-box mismatch, or a stale scale factor) BEFORE committing a fix.
3. **(Minimum size, item 3, FR-10)** Given the fixed minimum height/width, then the memo can be resized down to a sensible smaller minimum (this story sets the floor at **48 × 32 scale-1.0 px**, tunable in smoke) without the handles detaching, and shrinking never clips the text-entry unusably.
4. **(Live smoke, item 3)** Given the fix, then it is live-smoked at DPR>1 by resizing a memo from large to the new minimum and back (and by typing a memo taller than its box), confirming handle tracking, and it does not regress the Story 3.1 memo move/resize command path or Story 8.6's preview-size behavior.

## Tasks / Subtasks

- [x] **Task 1 — Root-cause diagnosis, written before any fix (AC: #2).** Reproduce both defects on a real memo at DPR>1 (own dev servers) and write the mechanism down in the Dev Agent Record, confirming or correcting the Dev Notes hypotheses below.
  - [x] Confirm defect A: create a memo, type more text than its box holds; verify the sw/se (bottom) handles float ABOVE the visible bottom edge (into the text) because the edit-frame is sized from the STORED anchor rect height (`fb.height`) while the rendered `.annotation-memo` box height is `max(fb.height, content-driven auto-grow height)`.
  - [x] Confirm defect B: corner-resize a memo smaller; verify the anchor rect shrinks toward zero (no min in `resizeRectCorner`) while the rendered box cannot shrink below the textarea's `min-height:100%` + content + padding — so handles detach and it "feels" like a fixed floor; and that width (`width: pos.width`, a hard set) shrinks text into an unusable sliver with no floor.
  - [x] Confirm the offset is GEOMETRY (frame height ≠ rendered box height), not a CSS transform bug (the `.edit-handle--sw/se` `translate(±50%)` is correct relative to the frame; the frame itself is the wrong height).
- [x] **Task 2 — Fix defect A: make the memo edit-frame track the memo's ACTUAL rendered box (AC: #1, #4).** Confirm the chosen mechanism in Task 1 (see Dev Notes "Fix approach"); implement so the four corner handles sit on the visible corners regardless of content-driven auto-grow, at all zoom levels.
  - [x] If choosing the recommended **handles-as-memo-children** path: render the memo's move-grip + 4 corner handles as children of the real `.annotation-memo` element (CSS-native tracking, no measurement); make `renderEditFrame` skip memos (it keeps rendering pen/region frames unchanged).
  - [x] Preserve the collapsed-memo behavior: whichever mechanism, verify the handles sit on the collapsed box's real corners (this may let the `renderEditFrame` collapsed drop-corners hack at `AnnotationLayer.tsx:396-404` be removed — allowed simplification, not required; do not regress collapsed).
- [x] **Task 3 — Fix defect B: enforce a memo-specific minimum in the interactive corner-resize (AC: #3).** Add a min width/height floor (`48 × 32` scale-1.0 px, converted to normalized fractions of the memo's page box) to `resizeRectCorner` (memo path only — pass the min in; region rects keep NO floor) so the moving corner cannot cross the min from the fixed corner (mirror the pen `axisScale` no-collapse/no-flip logic). All anchor math stays in `anchor/` (AD-9).
  - [x] Apply the same floor to the SizeRow preset path (`resizeMemoAnnotation`, store) only if a preset can fall below it (presets are ≥ the floor today — note it, do not add churn).
- [x] **Task 4 — Tests (AC: #1, #3).**
  - [x] `anchor/anchor.test.ts`: unit-test the `resizeRectCorner` min clamp for each corner — the moving edge is floored, the fixed edge is untouched, no flip/collapse, and region rects (no min) are unaffected.
  - [x] `annotations/gestures/useEditGesture.test.ts`: a memo corner-resize that would go below the min commits at the min; a region resize is unaffected.
  - [x] Note in the Dev Agent Record: jsdom has no layout, so the frame-tracks-real-height behavior (AC #1) is a LIVE-SMOKE assertion, not a jsdom test.
- [x] **Task 5 — Live smoke at DPR>1 (AC: #4), own dev servers, real paper.** Create a memo; (a) type it taller than its box → confirm bottom handles sit on the visible bottom corners; (b) resize large → the new minimum → back, confirming handles stay attached and text never clips unusably; (c) verify at two zoom levels. Do NOT regress Story 3.1 move/resize (drag the whole memo; resize commits one undo step) or Story 8.6 comment-preview-size (leave `CommentBubble` MIN_BUBBLE_* untouched). Delete any transient test memo from the real doc afterward and verify empty.
- [x] **Task 6 — Backend unaffected.** Client-only change (no `server/` file, no OpenAPI contract change, `docs/API.md` untouched). No version bump in this change (happens at PR-merge time per CLAUDE.md versioning).

### Review Findings

- [x] [Review][Patch] HIGH: Base memo resize geometry on the rendered box when auto-grow or collapse makes its height differ from the stored rect; otherwise bottom handles move invisibly until the stored anchor catches up and top-handle drags translate the box instead of tracking the pointer precisely. [client/src/annotations/gestures/useEditGesture.ts:340] — **Fixed**: `onDown` now measures the memo's real rendered height (`handleEl.closest(".annotation-memo").getBoundingClientRect()`) and seeds the corner-resize baseline's `y1` from it (top always matches stored `y0`; only height can diverge) before any delta is applied. Move is untouched (size-independent). Live-verified: a +20px drag committed a stored height of ~1037px (real 1017px + 20), not the buggy 200px (stale 180px + 20). New tests: `useEditGesture.test.ts` ("seeds a memo corner-resize from the RENDERED height…", "a memo MOVE is unaffected…").
- [x] [Review][Patch] MEDIUM: Offset memo-child handles to the outer border edge; absolute offsets currently resolve against the bordered memo's padding-box containing block, leaving every handle center about one hairline inward despite AC #1 requiring exact corners. [client/src/annotations/MemoBox.tsx:180] — **Fixed**: added `.annotation-memo > .edit-handle--*` child-combinator overrides (`Annotations.css`) that shift each handle out by `-1 * var(--hairline-width)`, compensating for the border-box containing-block offset; `.edit-handle--*` alone stays verbatim for the pen/region frame's own borderless handles. Live-verified: handle centers now land EXACTLY on the memo's real corners (previously ~1px inside).
- [x] [Review][Patch] MEDIUM: Keep a selected memo and its nested handles above overlapping later memos and comment controls; moving the handles from the z-index-2 edit-frame layer into the z-index-1 memo stacking context makes covered handles ungrabbable. [client/src/annotations/AnnotationLayer.tsx:527] — **Fixed**: `.annotation-memos` group bumped to `z-index:2` (was 1, now outranks `.annotation-comments`' 1); `MemoBox` gives the `editable` memo an inline `z-index:1` so it also outranks unselected sibling memos within the group (an explicit z-index always beats `auto` siblings regardless of DOM/creation order). Live-verified computed `z-index`: memos group `2`, comments group `1`. New test: `AnnotationLayer.test.tsx` ("gives the selected (editable) memo a z-index…").
- [x] [Review][Patch] MEDIUM: Preserve the 48 × 32 floor for legacy undersized memos at page edges; applying `clamp01` after the minimum calculation can reduce the result below the requested minimum when the fixed corner is already too close to a boundary. [client/src/anchor/index.ts:250] — **Fixed**: added a fit-within-page pass in `resizeRectCorner` that, if the floor pushes a coordinate past `[0,1]`, clamps it to the edge and slides the FIXED corner inward instead (preserving the floor rather than letting `clamp01` silently shrink it). New tests: `anchor.test.ts` (both page-edge directions).
- [x] [Review][Defer] Resize handles still lack distinct corner names and keyboard resize behavior. [client/src/annotations/MemoBox.tsx:182] — deferred, pre-existing

## Dev Notes

**This is an investigation-first defect story (like 9.1): write the diagnosis before the fix.** The Dev Notes below are a strong hypothesis derived from reading the code; confirm/correct it live at DPR>1.

### Root-cause hypothesis (confirm in Task 1)

**Defect A — bottom handles off position (the dominant, always-reproducible bug):**
The edit-frame is sized from the STORED anchor rect: `renderEditFrame` computes `fb = denormalizeRect(anchor.rect, box, scale)` and sets the frame `height: fb.height` (`AnnotationLayer.tsx:390-424`). The sw/se handles are `position:absolute; bottom:0; translate(±50%,50%)` relative to that frame (`Annotations.css:1025-1037`) — correct FOR THE FRAME. But the rendered `.annotation-memo` box does NOT use a fixed height: it sets `minHeight: pos.height` (`MemoBox.tsx:92`) and its `<textarea>` auto-grows to fit content (`MemoBox.tsx:61-66`, `min-height:100%` + JS `height = scrollHeight`). So the box's real height is `max(fb.height, padding + content height)`. The moment a memo holds more text than its stored rect (routine: memos are created at the medium default `90×90` scale-1.0 px and text quickly exceeds that), the box is TALLER than `fb.height`, so the bottom handles float up into the middle of the text. Width is a hard `width: pos.width` (border-box) matching `fb.width`, so ne/se are horizontally aligned — only the BOTTOM handles are off, exactly matching the user's report.
This is the SAME frame/rendered-height mismatch the codebase already hacked around for collapsed memos (`AnnotationLayer.tsx:396-404` drops the corners because the collapsed box "renders at an intrinsic CSS height that no longer matches its stored anchor rect, so the frame's stored-height corner handles (esp. sw/se) float"). Collapsed is the mismatch in the shorter direction; overflow is the taller direction. Same family, one proper fix.

**Defect B — "fixed minimum height/width":** two coupled causes.
1. The interactive corner-resize commits through `useEditGesture` → `computeAnchor` → `resizeRectCorner` (`anchor/index.ts:223-240`), which clamps only to `[0,1]` — NO minimum. The rect can shrink toward zero, but the rendered box cannot shrink below the textarea's `min-height:100%` + content + `--annotation-memo-padding` (6px), so past a point the rect (and frame) shrink while the visible box does not → handles detach AND the user perceives a stuck floor.
2. Width has no floor either; shrinking `width` re-wraps text into a vertical sliver ("clips the text-entry unusably").

### Two memo-resize entry points (don't confuse them)

- **Interactive corner drag (the defective path):** `useEditGesture.onDown` → `computeAnchor` (`d.handle !== "move"` → `resizeRectCorner`) → commit via `setAnnotationGeometry(d.id, d.lastAnchor)` on pointerup (`useEditGesture.ts:246-284`). The gesture also records the resized size as the session default via `setActiveMemoSize` (`useEditGesture.ts:275-282`, scale-1.0 px). **Defect A and B live here.** The min floor goes here.
- **SizeRow preset pick:** `useSelection.resizeSelected` → store `resizeMemoAnnotation` (`store/index.ts:478-489`). Presets (`MEMO_SIZES`, `store/index.ts:55`) are all ≥ the proposed floor; only touch this path if a preset could fall below the floor.

### Fix approach (confirm the mechanism in Task 1; the min floor is decided)

**Defect A — recommended: render the memo's edit handles as children of the real `.annotation-memo` box.** CSS-native tracking: `position:absolute` handles on a border-box element sit on its real corners no matter how auto-grow or zoom change the height — zero DOM measurement, zero coordinate/unit conversion, no timing lag, robust at DPR>1. It also lets the collapsed drop-corners hack be removed (handles track the collapsed box for free). Cost: forks handle rendering (memo handles in `MemoBox`; pen/region handles stay in `renderEditFrame`) and duplicates the handle `<button>` markup — acceptable; the epic's terminal refactor (Story 9.9) can unify. The `data-edit-handle`/`data-edit-id` wiring works identically wherever the buttons live (`useEditGesture` reads them at the document level via `closest('[data-edit-handle]')`); a press on a corner button resolves to that corner, not the wrapper's `data-edit-handle="move"`.

- **Alternative (fallback if the fork is undesirable): measure-and-size-the-frame.** Lift the memo's rendered box height (measured in `MemoBox`'s existing layout effect) up to `renderEditFrame` and size the frame to `max(fb.height, measuredHeight)`. Downsides that made it the fallback: a cross-component measured-height channel, a passive-effect re-measure on body/pos/collapsed change (the `[[ancestor-ref-passive-effect]]` timing class), and a px→frame-unit conversion across the page-card scale. Only pick this if Task 1 shows the child-handles fork is worse.

**Defect B — decided: enforce a memo min of `48 × 32` scale-1.0 px** (page-box px, so the floor is zoom-independent, consistent with `MEMO_SIZES`/`DEFAULT_MEMO_SIZE` and the `setActiveMemoSize` commit which already records scale-1.0 px). Derivation: height `32` = `--annotation-memo-padding` 12px total + ~1 line of `body-sm` (~18px), rounded up; width `48` = 12px padding + room for a short word. Tunable during smoke (AC #3 says "sensible"). Implement as an optional `min: {w, h}` (normalized fractions) param on `resizeRectCorner`, clamped BEFORE `canonicalize` against the FIXED (opposite) corner so the moving edge can't cross it (mirror `axisScale`'s no-collapse/no-flip logic, `useEditGesture.ts:374-382`); the gesture passes `{w: MIN_W_PX / box.width, h: MIN_H_PX / box.height}` for memos and `undefined` for region rects. `computeAnchor`/`DragState` will need the annotation `type` (capture `anno.type` at `onDown`) to know it's a memo.

### Coordinate/unit rules (AD-4 / AD-9 — do not violate)

- All anchors are normalized `[0,1]` fractions of the page's scale-1 CSS-px viewport, top-left origin (AD-4). Screen px are always derived (`frac × page_box × scale`).
- The anchor service (`anchor/`) is the ONLY place doing screen↔normalized math (AD-9). The store stays geometry-free; the gesture computes the next anchor and hands it to `setAnnotationGeometry`. Put the min-clamp math in `resizeRectCorner`, not the store, not the component.
- The min floor is scale-1.0 px converted to a normalized fraction (`px / box.{width,height}`), NOT CSS px — a CSS-px floor would change the allowable min rect as the user zooms.

### Source tree — files to touch

- `client/src/anchor/index.ts` — `resizeRectCorner` (add the optional normalized `min` clamp). Keep `RectCorner`/`canonicalize`/`clamp01` usage.
- `client/src/annotations/gestures/useEditGesture.ts` — capture `anno.type` into `DragState`; pass the memo min into `resizeRectCorner` via `computeAnchor`.
- `client/src/annotations/AnnotationLayer.tsx` — `renderEditFrame` (skip memos if using the child-handles path; otherwise size the frame to the measured height). Remove the collapsed drop-corners hack only if the new mechanism covers it.
- `client/src/annotations/MemoBox.tsx` — (child-handles path) render the memo's handles as children when `selected`; keep the auto-grow layout effect, the collapse toggle, and the empty-space drag-to-move (`data-edit-handle="move"` on the wrapper, `isBelowMemoText` gate in `useEditGesture`).
- `client/src/annotations/Annotations.css` — reuse `.edit-handle`/`.edit-handle--*` verbatim; if handles move into the memo, verify positioning against the border-box + padding (they should straddle the box edge as they do on the frame).
- Tests: `client/src/anchor/anchor.test.ts`, `client/src/annotations/gestures/useEditGesture.test.ts`.

### Regressions to guard (AC #4)

- **Story 3.1 memo move/resize command path:** the drag still previews via `dragPreview` and commits ONE `setAnnotationGeometry` on release (one zundo step). The move grip (top-center, anchored to the top edge) must stay put. Don't break the empty-space drag-to-move-while-unselected (`isBelowMemoText`).
- **Story 8.6 comment-preview-size:** memo-specific change; leave `CommentBubble.tsx` `MIN_BUBBLE_WIDTH`/`MIN_BUBBLE_HEIGHT` untouched.
- **Auto-grow (Codex MED, Story 2.9):** the textarea must still re-fit height on body/scale change — do not remove the `MemoBox` layout effect.
- **Collapsed memo (9.3/9.4 not yet built):** keep collapsed behaving; do not couple to a future persisted-collapsed-size (9.4).

### Testing standards

- Frontend: Vitest (`cd client && npm test`), typecheck (`npm run typecheck`). Keep both `vi.mock("./render")` barrels in sync if any `render/index.ts` export changes (not expected here).
- jsdom has NO layout (scrollHeight/getBoundingClientRect return 0), so the frame-tracks-real-height assertion is LIVE-SMOKE only. Unit tests cover the pure `resizeRectCorner` min math and the gesture's min-pass-through.
- **Live smoke is mandatory at DPR>1 on a real paper with YOUR OWN dev servers** (never reuse a user-launched server — see CLAUDE.md). Prefer trusted input (`claude-in-chrome` `computer` for a real pointer drag) over synthetic `dispatchEvent` for the resize gesture, since focus/pointer-capture matter (`[[use-trusted-input-for-focus-sensitive-smoke]]`, `[[verify-on-hidpi-and-real-host]]`). If `claude-in-chrome` is unavailable, note the deviation as 9.1 did.

### Project Structure Notes

- Downward-dependency rule holds: `anchor/` (pure math) ← gestures ← components. The min-clamp is pure geometry → belongs in `anchor/`. No new module needed; this is a targeted defect fix. If the child-handles path duplicates handle markup, that debt is explicitly in-scope for the terminal Story 9.9 refactor, not this story.

### References

- Epic + ACs: [Source: .bmad/planning-artifacts/epics.md#Story 9.2] (lines 2313-2336).
- FR-10 (memo), FR-15 (edit: move/resize/restyle), NFR-3 (anchor fidelity across zoom): [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md] (FR-10 L52, FR-15 L64, NFR-3 L96).
- AD-4 (normalized `[0,1]` top-left anchor; discriminated `anchor.kind`; type→kinds matrix memo={rect}) and AD-9 (anchor service owns screen↔normalized math): [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/review-adversary.md] (AD-4 fix L28/L52, AD-9 L48-60).
- Prior story continuity (diagnosis-first + DPR>1 smoke discipline, own dev servers, delete transient test data): [Source: .bmad/implementation-artifacts/9-1-unify-selection-color-fix-double-thickening.md].
- Code touch points (verbatim, current): `resizeRectCorner` `client/src/anchor/index.ts:223-240`; edit-frame render `client/src/annotations/AnnotationLayer.tsx:390-424`; handle CSS `client/src/annotations/Annotations.css:985-1048`; memo box `client/src/annotations/MemoBox.tsx:61-107`; memo CSS `client/src/annotations/Annotations.css:525-567`; resize gesture `client/src/annotations/gestures/useEditGesture.ts:134-283,327-351`; SizeRow store action `client/src/store/index.ts:478-489`; MEMO_SIZES/DEFAULT `client/src/store/index.ts:55-68`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Own dev servers (not any user-launched instance): backend `uv run uvicorn app.main:app --port 8010`, frontend `npm run dev -- --port 5183` (proxied to 8010 via `PAPER_MATE_API_TARGET`). `claude-in-chrome` extension unavailable this session ("Browser extension is not connected") — used `chrome-devtools-mcp` instead (same fallback as Story 9.1), `emulate({viewport: "1400x900x2"})` for a real DPR-2 Chrome instance. Diagnosis performed against the existing imported paper ("Multi-task Self-Supervised Visual Learning", `doc_id 3e63cb04...`) already in `.paper-mate/library.json` — no upload needed. Drives were real `PointerEvent`s dispatched at specific screen coordinates (the app's `useEditGesture` document listeners are not `isTrusted`-gated), with a `setTimeout` yield between dispatch and DOM read so React's state update actually commits before measuring (a same-tick read before the yield showed stale geometry — a test-methodology trap, not an app bug).

### Root-Cause Diagnosis (Task 1, AC #2) — written before any fix

Both Dev Notes hypotheses confirmed exactly, live at DPR 2:

**Defect A (bottom handles off position).** Placed a memo (default 90×90 scale-1 px → 180×180 CSS px at 200% zoom), then set its body to 20 lines of text. Measured via `getBoundingClientRect()`:
- `.annotation-memo` (real box): `{left:701, top:301, right:881, bottom:1335, height:1034}`
- `.annotation-edit-frame` (handle frame): `{left:701, top:301, right:881, bottom:481, height:180}`
- `.edit-handle--se` / `--sw`: centered at `y≈481` — 854px above the real bottom edge (1335), sitting in the middle of the memo's text.

Confirms the frame is sized from the STORED anchor rect (`fb.height` in `renderEditFrame`, `AnnotationLayer.tsx:390-409`) while the rendered box height is `max(fb.height, auto-grow content height)` (`MemoBox.tsx:61-66`, `92`). Pure geometry mismatch (frame height ≠ rendered height) — not a transform bug; `.edit-handle--sw/se`'s `translate(±50%,50%)` correctly centers each handle on ITS frame's corner (`Annotations.css:1025-1037`), the frame itself is just the wrong height. Same family as the already-shipped collapsed-memo drop-corners hack (`AnnotationLayer.tsx:396-404`).

**Defect B (no minimum size).** Shrank the same memo (short 2-char body, so auto-grow is not a confound) via a simulated `se`-corner drag (`resizeRectCorner`'s only caller path, `useEditGesture`'s `onDown`/`onMove`/`onUp`):
- First drag, ~90px of travel toward the fixed `nw` corner: rect/frame/box all shrank in lockstep to 58×58 CSS px (29×29 scale-1 px) — well under the intended 48×32 floor, handles still attached (content was short enough that auto-grow wasn't yet the limiter).
- Second drag, further toward `nw`: frame shrank to 5×5 CSS px (rect nearly zero — confirms `resizeRectCorner`, `anchor/index.ts:223-240`, clamps only to `[0,1]`, no minimum) while the RENDERED box floored at `{width:14, height:48}` (textarea `min-height:100%` + padding) and the `<textarea>` itself measured `{width:0, height:34}` — text-entry genuinely unusable (zero-width). The frame (5×5 at the nw corner) and the visible box (14×48, extending well past it) fully decoupled: handles detached exactly as the AC describes.

Both defects are confirmed GEOMETRY issues in the two places Dev Notes named: `renderEditFrame`'s frame-height source (Defect A) and `resizeRectCorner`'s missing min-clamp (Defect B). Proceeding with the Dev Notes' recommended fix: handles-as-memo-children for Defect A, a normalized min-floor param on `resizeRectCorner` for Defect B.

### Completion Notes List

- **Defect A fix (handles-as-memo-children, the recommended path).** `MemoBox.tsx` now renders the move grip + 4 corner `.edit-handle`/`.edit-handle--*` buttons (reused verbatim) as its OWN children when `editable` (a new prop, `a.id === selectedId` — deliberately NOT the OR'd `selected` prop, which also lights up for a box-select multi-selection member that must show only the bulk group frame). Since `.annotation-memo` is `position:absolute; box-sizing:border-box`, the handles track its REAL rendered corners at every size (auto-grow, collapse, or the new min floor) with zero measurement. `AnnotationLayer.tsx`'s `isEditable` now excludes `type === "memo"` so `editMark`/`renderEditFrame` never sees a memo; the now-dead collapsed-memo drop-corners hack (`AnnotationLayer.tsx:396-404`) is removed — collapsed memos get all 5 handles too, correctly tracking the collapsed box (a behavior IMPROVEMENT over the old "move-grip only while collapsed" hack), confirmed both live (DPR 2) and by an updated `AnnotationLayer.test.tsx` case.
- **Defect B fix (min floor).** `resizeRectCorner` (`anchor/index.ts`) takes an optional normalized `min: {w, h}`, clamping the moving corner's distance from the FIXED opposite corner BEFORE `canonicalize` (mirrors `axisScale`'s pen no-collapse/no-flip logic) — omitted entirely for non-memo rects, so region/comment resize is byte-identical to before. `useEditGesture`'s `DragState` now captures `anno.type` at pointerdown; `computeAnchor` passes `{w: 48/box.width, h: 32/box.height}` (scale-1.0 px → normalized fraction, zoom-independent) only when `type === "memo"`. The `MEMO_SIZES` preset path (`resizeMemoAnnotation`, store) was NOT touched — its smallest preset (160×64) is already well above the floor, per the story's own note (no churn).
- **Live-smoke confirmed (DPR 2, `chrome-devtools-mcp`, `claude-in-chrome` unavailable this session — same fallback as Story 9.1):** typed-taller-than-box now puts se/sw handle centers within ~1px of the real bottom edge (was 854px off before the fix); a corner-resize toward the fixed corner now floors at EXACTLY 48×32 scale-1 px (96×64 CSS px at 200% zoom) with the textarea still usable (82×34 CSS px), instead of collapsing toward 0 with a 0-width textarea; a large→min→large round trip and a second zoom level (128%) both kept handles attached within the same ~1px hairline-border inset (see "Known minor gap" below); Story 3.1's move grip still drags the whole memo correctly (single-commit, untouched code path); Story 8.6's `CommentBubble.tsx` was not touched. Transient test memo deleted from the real doc afterward; verified `meta.json` has no `annotations` key.
- **Known minor gap, noted then RESOLVED by the code-review round (see below):** nesting the handles inside `.annotation-memo` (which has a 1px hairline border + padding) initially left every handle ~1px inside the visual corner (CSS containing-block padding-edge vs the old borderless frame's exact edge). Codex's review caught this as a MEDIUM finding against AC #1's "exactly"; fixed with a border-compensating CSS override (see Codex review section).
- Full frontend suite green (1543/1543, 72 files), typecheck clean. Backend `test_version.py` re-run and still passes; `server/uv.lock` picked up an incidental sync (`paper-mate-server` version 0.5.30 → 0.5.31) when `uv run uvicorn` started for live-smoke — the lockfile was already stale against `pyproject.toml`'s committed `0.5.31` (a pre-existing drift from the prior story's merge, not something this story's diff introduces); left in place since AE3-6 exists specifically to keep these in sync.

### Codex code-review round (bmad-code-review, cross-model per CLAUDE.md)

Ran via `codex exec` against the working-tree diff (`git diff HEAD`, baseline = HEAD, no commits yet). 4 actionable patch findings (1 High, 3 Med) + 1 pre-existing deferred item; 15 other findings dismissed as context-free/already-covered by the review's own triage. All 4 patches fixed and live-verified — see the ticked "Review Findings" checkboxes above for the per-finding fix description. Summary:
- **HIGH**: the resize gesture computed a corner-drag's new geometry from the STALE stored anchor rect, not the memo's real rendered height — Task 2's fix correctly repositioned the handle to the visual corner, but the underlying math still used the old baseline, so a resize on an auto-grown or collapsed memo would silently commit a wrong (usually much smaller) size that only became visible later. Fixed by seeding the resize baseline's height from a live `getBoundingClientRect()` measurement at drag-start.
- **MED** ×3: the ~1px border-edge handle inset (CSS fix), a z-index stacking regression that could let an overlapping later memo or comment pin cover a selected memo's handles (group + per-instance z-index fix), and a `clamp01`-after-floor bug that could silently violate the 48×32 minimum for a memo already near a page edge (page-fit-then-floor fix).
- New/updated tests for all 4: `anchor.test.ts` (+2 page-edge floor cases), `useEditGesture.test.ts` (+2 rendered-height-seed cases), `AnnotationLayer.test.tsx` (+1 z-index case). Full suite re-verified green after each fix (final: 1548/1548), typecheck clean.

### Process note: live-smoke touched the wrong data directory (own mistake, caught and corrected)

The bare `uv run uvicorn` dev flow's ACTUAL default `PAPER_MATE_DATA` is `~/.paper-mate` (`server/app/storage/paths.py`), not repo-root `./.paper-mate` — a wrong assumption carried over from CLAUDE.md's Docker-Compose-specific default note. Both the Task 1/5 live-smoke AND the first pass of this review-fix verification round ran against the user's REAL personal library at `~/.paper-mate` (which happens to independently contain the same test paper, doc_id `3e63cb04...`, at a different `added` timestamp than the repo's stale leftover `./.paper-mate/library.json` fixture) — concurrently with the user's own pre-existing `docker compose` container (`paper-mate-paper-mate-1`, already running ~30 min before this session touched it, same data dir). Impact: one empty test memo was left in the real `annotations.json` after a round of testing (the per-round "verify empty" check was itself checking the WRONG file, `meta.json`, which never has an `annotations` key — a second, independent mistake that gave false confidence). Found via the z-index live-verification (a persisted memo survived across what should have been a fresh page load) and traced to the real cause via `ps aux`/`docker ps`. **Corrected:** deleted the stray memo through the running app (confirmed `~/.paper-mate/.../annotations.json` → `{"annotations": []}`); the ONLY other side effect was an updated `last_opened` timestamp on that one paper (a normal, harmless field any real open bumps). The rest of this review-fix round's live verification (z-index, border-edge, resize-baseline) was redone against a throwaway `PAPER_MATE_DATA` sandbox (own uvicorn/vite pair, scratch dir, deleted after). **Follow-up worth raising:** the stale repo-root `./.paper-mate/` fixture should probably be deleted (it's misleading — it looks like an isolated test library but isn't what the app actually uses), and future dev-story sessions should pass an explicit throwaway `PAPER_MATE_DATA` for ALL live-smoke, not just when something goes wrong.

### File List

- `client/src/anchor/index.ts` — `resizeRectCorner`: optional normalized `min` param, floors the moving corner before `canonicalize`.
- `client/src/anchor/anchor.test.ts` — new `describe("resizeRectCorner min floor …")` block (6 cases: each corner floored, an above-floor resize unaffected, `undefined` min unaffected).
- `client/src/annotations/gestures/useEditGesture.ts` — `DragState.type` captured at `onDown`; `MIN_MEMO_WIDTH_PX`/`MIN_MEMO_HEIGHT_PX` constants; `computeAnchor` passes the normalized memo min into `resizeRectCorner` (undefined for non-memo).
- `client/src/annotations/gestures/useEditGesture.test.ts` — 2 new cases: a memo corner-resize floors at the min (fixed corner untouched); a non-memo (region) rect resize is unaffected by the same drag.
- `client/src/annotations/AnnotationLayer.tsx` — `isEditable` excludes `type === "memo"`; `renderMemo` passes the new `editable` prop (`a.id === selectedId`) to `MemoBox`; `renderEditFrame` and its doc comment drop the now-dead collapsed-memo hack (memo never reaches it).
- `client/src/annotations/AnnotationLayer.test.tsx` — updated the collapsed-memo handle test: now expects ALL 5 handles (behavior improvement), not just the move grip.
- `client/src/annotations/MemoBox.tsx` — new `editable` prop; renders the move grip + 4 corner `.edit-handle` buttons as children when true; new `EDIT_HANDLES` constant + doc comment explaining the CSS-native tracking mechanism.
- `.bmad/implementation-artifacts/sprint-status.yaml` — `9-2-…`: `ready-for-dev` → `in-progress` → `review` → (Codex round) `in-progress` → `review`.
- `server/uv.lock` — incidental version-field sync (`0.5.30` → `0.5.31`) matching the already-committed `pyproject.toml`, picked up when the backend dev server started for live-smoke; not a functional change.

**Codex code-review round additions:**
- `client/src/anchor/index.ts` — `resizeRectCorner`: added the page-edge fit-then-floor pass (slides the fixed corner inward instead of letting `clamp01` violate the min).
- `client/src/anchor/anchor.test.ts` — +2 cases: floor preserved when the fixed corner is within `min` of the page's bottom-right / top-left edge.
- `client/src/annotations/gestures/useEditGesture.ts` — `onDown` now seeds the memo corner-resize baseline's `y1` from the real rendered height (`handleEl.closest(".annotation-memo").getBoundingClientRect()`).
- `client/src/annotations/gestures/useEditGesture.test.ts` — +2 cases: a memo corner-resize seeds from the rendered height (stubbed `getBoundingClientRect`); a memo MOVE is unaffected.
- `client/src/annotations/Annotations.css` — `.annotation-memos` z-index 1→2 (outranks `.annotation-comments`); new `.annotation-memo > .edit-handle--*` child-combinator overrides compensating the border-box containing-block inset.
- `client/src/annotations/MemoBox.tsx` — inline `zIndex: 1` when `editable`, so the selected memo outranks unselected siblings within its group.
- `client/src/annotations/AnnotationLayer.test.tsx` — +1 case: the editable memo gets `style.zIndex === "1"`, an unselected sibling gets `""`.

## Change Log

- 2026-07-19: Root-cause diagnosis (Task 1, AC #2) written before any fix, live-verified against a real paper at DPR 2 (`chrome-devtools-mcp`, `claude-in-chrome` unavailable this session). Both Dev Notes hypotheses confirmed exactly: Defect A's bottom handles floated 854px above the real box edge on an overflowed memo; Defect B's corner-resize shrank the anchor rect toward zero with no floor, decoupling the handle frame (5×5px) from the rendered box (14×48px) and collapsing the textarea to 0 width.
- 2026-07-19: Implemented (Tasks 2-3): moved the memo's edit handles into `MemoBox` as children of the real `.annotation-memo` box (CSS-native corner tracking, fixes Defect A and removes the now-dead collapsed-memo hack as a side benefit); added an optional normalized `min` floor to `resizeRectCorner`, threaded a memo-only 48×32 scale-1px floor through `useEditGesture` (fixes Defect B). Region/comment/pen resize paths are unaffected (no min passed).
- 2026-07-19: Tests (Task 4): 6 new `anchor.test.ts` cases (per-corner floor, above-floor no-op, `undefined` no-op) + 2 new `useEditGesture.test.ts` cases (memo floors, non-memo doesn't); updated one `AnnotationLayer.test.tsx` case for the collapsed-memo behavior improvement (now shows all handles, not just move). Full suite 1543/1543 green, typecheck clean.
- 2026-07-19: Live-smoked the fix (Task 5) at DPR 2 against a real paper: auto-grow overflow now puts handles within ~1px of the real bottom edge; corner-resize floors at exactly 48×32 scale-1px with a still-usable textarea; a large→min→large round trip and a second zoom level (128%) both tracked correctly; Story 3.1 move-grip and Story 8.6 `CommentBubble` unaffected. Noted a ~1px hairline-border containing-block inset as a known minor, non-blocking gap. Transient test memo deleted; doc verified clean.
- 2026-07-19: Ran Codex `bmad-code-review` (cross-model, per CLAUDE.md standing practice) against the working-tree diff. 1 High + 3 Med actionable patches, 1 pre-existing item deferred, 15 dismissed. Fixed all 4: (1) HIGH — the resize gesture now seeds its corner-drag baseline from the memo's REAL rendered height, not the stale stored rect, fixing a silent wrong-size commit on auto-grown/collapsed memos; (2) MED — the ~1px handle border-edge inset noted as a "known minor gap" is now actually fixed via a CSS border-compensation override; (3) MED — `.annotation-memos`' z-index bumped (1→2) + the editable memo gets its own inline z-index, so a selected memo's handles can no longer be covered by an overlapping later memo or comment; (4) MED — `resizeRectCorner` now slides the fixed corner inward instead of letting `clamp01` silently violate the 48×32 floor for a memo near a page edge. Added tests for all 4; full suite 1548/1548 green, typecheck clean.
- 2026-07-19: **Process note (own mistake, corrected):** discovered mid-review-fix-verification that the bare dev-server flow's actual `PAPER_MATE_DATA` default is `~/.paper-mate`, not repo-root — so this story's live-smoke (Task 5 AND the first review-fix verification pass) had been running against the user's REAL personal library the whole time, concurrently with their own already-running `docker compose` stack on the same data dir. One empty test memo was left behind in the real `annotations.json` (found + deleted; the only other effect was a harmless `last_opened` bump). Redid the affected live checks against a throwaway `PAPER_MATE_DATA` sandbox. See the Dev Agent Record's "Process note" for the full writeup and a follow-up recommendation (delete the misleading stale repo-root `./.paper-mate/` fixture; always pass an explicit throwaway data dir for live-smoke going forward).
- 2026-07-19: PR #74 ("Fix: Keep Memo Handles Attached During Resize") merged to `main` (commit `0c6a9c3`). Story flipped to `done`; version bumped to `0.5.32` (PATCH +1, standalone story) per CLAUDE.md versioning.
