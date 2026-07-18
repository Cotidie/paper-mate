---
baseline_commit: af0dde2ef40bf5583d16dc7b8f4d80462833a77a
---

# Story 10.4: Resizable, persisted collapsed memo box

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to resize a memo's collapsed box and have that size persist, distinct from the expanded size,
so that collapsed memos fit the space I want them to occupy.

## Acceptance Criteria

1. **(Collapsed resize, item 10, FR-32, FR-15)** Given a collapsed memo that is selected (so its Story 10.2 edit handles show), when I drag a corner handle, then the COLLAPSED box resizes (width and height), with the handles tracking the corners exactly (consistent with Story 10.2), and the memo's top-left position stays put.
2. **(Distinct from expanded, item 10, FR-32)** Given a memo, then its collapsed size and its expanded size are tracked DISTINCTLY: resizing the collapsed box does NOT change the expanded box (and vice versa). Both survive reload.
3. **(Persist + restore, item 10, FR-32, AR-6)** Given a resized collapsed memo, when I reload the paper (Story 3.5 restore), then the collapsed box restores at its persisted size, not the fixed preset.
4. **(Command path + additive contract, item 10, FR-32, AR-7, AD-8)** Given the persisted collapsed size, then it is written through the command path (so it is one undoable step) and stored additively on the annotation contract (`Style.collapsed_width`/`collapsed_height`, no `schema_version` break); an existing annotation without the field falls back to the current fixed collapsed size.
5. **(Legacy fallback + no expanded regression)** Given a memo that has never had its collapsed box resized, then collapsing it renders at today's fixed size (box width from the stored rect, one-line intrinsic height); given the expanded memo, its own move/resize (Story 3.1/10.2) is byte-identical to before (collapsed size is a separate field, separate store action). Live-smoked at DPR>1.

## Tasks / Subtasks

- [x] **Task 1 — Add the additive contract field (AC: #4).** In `server/app/models.py`, add to `Style`:
  - `collapsed_width: float | None = None`
  - `collapsed_height: float | None = None`
  These are **normalized `[0,1]` fractions of the scale-1.0 page box** (memo-only), NOT CSS px. Extend the `Style` docstring to describe them, and — critically — call out the unit difference from `bubble_width`/`bubble_height`: the comment bubble is a *floating popup* so its size is scale-independent CSS px; the collapsed memo box is *page-anchored* so its size is normalized and rides zoom (NFR-3), exactly like `anchor.rect`. Additive + optional (AD-8); no `schema_version` bump (a `Style` missing them still validates → `None` → the legacy fixed collapsed size).
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`), then `cd client && npm run gen:api` (regenerates `client/src/api/schema.d.ts`). Never hand-author the client type.
  - [x] Update `docs/API.md`: extend the **`Style` fields** line (the `bubble_width/height` entry is the model to follow) and add a dated changelog entry (mirror the `2026-07-03 (comment bubble resize)` and `2026-07-02 (memo collapse/expand)` entries): `Style` gains `collapsed_width`/`collapsed_height` (memo-only, NORMALIZED page fractions, additive, no format break, AD-8; Story 10.4 / FR-32).
- [x] **Task 2 — Store action `resizeCollapsedMemo` (AC: #1, #2, #4).** In `client/src/store/index.ts`, add the twin of `resizeCommentAnnotation` (single-id, per-instance) but writing the memo collapsed size:
  - Interface (near the other memo actions, `resizeMemoAnnotation`/`setMemoCollapsed` ~line 252-276): `resizeCollapsedMemo: (id: string, size: { w: number; h: number }, now: string) => void;` — `w`/`h` are normalized fractions. Doc-comment it as the collapsed-size twin of `resizeMemoAnnotation`, but stored in `style.collapsed_width/height` instead of the anchor rect (the anchor rect stays the EXPANDED size — that is what keeps the two sizes distinct, AC #2).
  - Implementation (near `resizeCommentAnnotation` ~line 499): single-id lookup, guard `a.anchor.kind === "rect" && a.type === "memo"` (same guard shape as `setMemoCollapsed`/`resizeMemoAnnotation`; return state unchanged on miss so zundo suppresses a no-op step), then `style: { ...a.style, collapsed_width: size.w, collapsed_height: size.h }`, bump `updated_at`. It mutates the annotations Map → recorded as ONE zundo step (undoable, AR-7).
- [x] **Task 3 — Route the collapsed corner-resize to the collapsed size (AC: #1, #2).** In `client/src/annotations/gestures/useEditGesture.ts`:
  - [x] `DragState`: add `collapsed: boolean`. Capture it at `onDown` from `anno.style.collapsed ?? false` (only meaningful for a memo; harmless elsewhere).
  - [x] `onDown` re-seed (extend the existing Story-10.2 memo re-seed block, ~lines 215-223): today it seeds only `y1` from the rendered height, because the expanded box width always equals `anchor.rect` width. Once a collapsed box has its OWN width, the rendered collapsed width no longer equals `anchor.rect` width, so **also seed `x1` from the rendered width**. Measure the memo's `getBoundingClientRect()` (already measured for height), convert width to a fraction (`renderedWidth / (page.box.width * scale)`), and set `startAnchor.rect = { x0, y0, x1: x0 + widthFrac, y1: y0 + heightFrac }`. This is a no-op for the expanded case (rendered width == stored width) → no regression; it makes the collapsed resize baseline the visible collapsed box. jsdom has no layout → no-op there (LIVE-SMOKE only, as in 10.2).
  - [x] `computeAnchor` (~line 361): for a **collapsed memo rect resize** (`d.collapsed && d.type === "memo" && d.handle !== "move"`), after `resizeRectCorner(...)` produces `next`, **re-anchor to the fixed top-left**: `rect = { x0: a.rect.x0, y0: a.rect.y0, x1: a.rect.x0 + (next.x1 - next.x0), y1: a.rect.y0 + (next.y1 - next.y0) }`. This keeps the memo's position fixed during a collapsed resize (position moves only via the move grip, AC #1) and makes every corner grow/shrink from the top-left. The Story-10.2 memo min floor (`MIN_MEMO_WIDTH_PX/HEIGHT_PX`, already applied inside `resizeRectCorner` because `d.type === "memo"`) is preserved. **Move** (`handle === "move"`) is unchanged — it `translateRect`s the shared anchor (position is shared across both states; do NOT branch move).
  - [x] `onUp` (~lines 287-317): when `d.collapsed && d.type === "memo" && d.handle !== "move"`, commit via `resizeCollapsedMemo(d.id, { w: r.x1 - r.x0, h: r.y1 - r.y0 }, now)` instead of `setAnnotationGeometry`; keep the self-`select(d.id)` feedback. Do **NOT** call `setActiveMemoSize` for a collapsed resize (that session default is the EXPANDED size; a shared default collapsed size is out of scope, see Dev Notes). Every non-collapsed path (expanded memo, region, comment, pen, move, group) stays exactly as today.
- [x] **Task 4 — Render the collapsed box at its persisted / in-flight size (AC: #1, #3, #5).** In `client/src/annotations/AnnotationLayer.tsx` `renderMemo` (~line 297) and `client/src/annotations/MemoBox.tsx`:
  - [x] In `renderMemo`, compute the effective COLLAPSED extent (position always from `anchor.rect.x0/y0`; only width/height differ). Source precedence when `a.style.collapsed`:
    1. **mid-drag** — `dragPreview` for this id (`effAnchor` already returns it): use its `rect` width/height (the re-anchored collapsed extent from Task 3).
    2. **committed** — `a.style.collapsed_width`/`collapsed_height` present: build `rect = { x0, y0, x0 + cw, y0 + ch }`.
    3. **legacy** — neither: keep today's behavior (box width from `anchor.rect`, intrinsic one-line height).
    Build `pos = denormalizeRect(rect, box, scale)` from that effective rect, and pass a `collapsedSized: boolean` prop to `MemoBox` (true for cases 1-2, false for case 3). Expanded memos are unchanged (still `denormalizeRect(anchor.rect, ...)`, `collapsedSized` irrelevant).
  - [x] In `MemoBox`, apply an explicit height for a SIZED collapsed box: change the inline style from `...(collapsed ? {} : { minHeight: pos.height })` to `...(collapsed && !collapsedSized ? {} : { minHeight: pos.height })`. Width stays `pos.width` (already applied in every state). So: expanded → `minHeight` from expanded rect; collapsed+sized → `minHeight` from the collapsed rect; collapsed+legacy → intrinsic one-line height (unchanged). Note in a comment that the `.annotation-memo__preview` stays single-line (`nowrap`/ellipsis) — a taller resized collapsed box just leaves whitespace below the first line (intended).
- [x] **Task 5 — Tests (AC: #1, #2, #4, #5).**
  - [x] `server/tests/test_models.py`: `Style` accepts and round-trips `collapsed_width`/`collapsed_height`; a `Style`/`Annotation` JSON omitting them still validates with the fields defaulting to `None` (no `schema_version` change).
  - [x] `client/src/store/index.test.ts`: `resizeCollapsedMemo` writes `style.collapsed_width/height` on a rect-memo, leaves `anchor.rect` (the expanded size) untouched (AC #2), skips a non-memo id (guard, one no-op / no history step), and records exactly one zundo step (undo reverts it).
  - [x] `client/src/annotations/gestures/useEditGesture.test.ts`: a COLLAPSED memo corner-resize commits through `resizeCollapsedMemo` (collapsed extent), NOT `setAnnotationGeometry`, with the top-left held fixed; an EXPANDED memo corner-resize still commits through `setAnnotationGeometry` unchanged (verified behaviorally: which field mutated, since a zundo-merged getState() spy is fragile across `set()` calls — see Dev Agent Record). Reused the rendered-height-seed stub pattern already in this test file (Story 10.2).
  - [x] `client/src/annotations/AnnotationLayer.test.tsx` (or `MemoBox.test.tsx` if present): a collapsed memo WITH `collapsed_width/height` renders the box with `minHeight`/`width` derived from those fields (assert the inline style values — jsdom has no layout but the props are computed in JS, so they are assertable); a collapsed memo WITHOUT them renders as today (no `minHeight`, width from `anchor.rect`). Note in the Dev Agent Record that handle-tracking-on-real-corners (AC #1) is LIVE-SMOKE only (jsdom has no layout).
  - [x] No `render/index.ts` export changes → the two `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) need no edit. Ran the full suite + `npm run typecheck`.
- [x] **Task 6 — Live smoke at DPR>1 (AC: #1, #2, #3, #5), OWN dev servers, throwaway `PAPER_MATE_DATA`.** Start YOUR OWN `uvicorn` + `vite dev` (never a user-launched/Docker server — CLAUDE.md) with an explicit throwaway `PAPER_MATE_DATA` scratch dir (the bare dev flow defaults to `~/.paper-mate`, the user's REAL library — see the Story 10.2 process note; pass a scratch dir so you never touch it). On a real paper at DPR 2:
  - [x] (a) Create a memo, type several lines, collapse it (chevron). Select it → the Story 10.2 handles show on the collapsed box's corners.
  - [x] (b) Drag the SE corner larger, then smaller to the min → the collapsed box resizes, handles stay on the corners, the top-left does not move; confirm the min floor holds (≈48×32 scale-1.0 px).
  - [x] (c) Reload the paper (reopen from the library) → the collapsed box restores at the persisted size, not the fixed preset (AC #3).
  - [x] (d) Expand → confirm the EXPANDED box is unchanged (the collapsed resize did not touch it); resize the expanded box, collapse again → the collapsed size is still its own persisted value (distinct, AC #2).
  - [x] (e) Undo the collapsed resize → it reverts in one step (AR-7).
  - [x] (f) Re-check at a second zoom level (the collapsed size rides zoom, being normalized).
  - [x] (g) Confirm no regression to Story 8.6 comment preview/bubble size (leave `CommentBubble`/`CommentPreview` and `bubble_*` untouched — different surface, different field). Verified via the full green unit-test suite + diff review (zero touched comment files); did not re-verify live in-browser (see Dev Agent Record deviation note).
  - [x] Delete the transient test memo afterward and verify the sandbox doc's `annotations.json` is clean.
- [x] **Task 7 — Version + docs.** No version bump in this change (happens at PR-merge time per CLAUDE.md versioning). Confirm `docs/API.md` is updated in the SAME change as the contract (Task 1). This IS an `/api` contract change (the annotation `Style` shape), so `docs/API.md` maintenance is mandatory.

### Review Findings

- [ ] [Review][Patch] [Med] Preserve the collapsed extent during single-memo move previews [client/src/annotations/AnnotationLayer.tsx:313]
- [ ] [Review][Patch] [Med] Keep fixed-top-left collapsed resizes within page bounds after re-anchoring [client/src/annotations/gestures/useEditGesture.ts:399]
- [ ] [Review][Patch] [Med] Clamp collapsed-memo moves using the collapsed extent when it differs from the expanded rect [client/src/annotations/gestures/useEditGesture.ts:392]
- [ ] [Review][Patch] [Low] Avoid measurable-width re-seeding drift on the expanded memo resize path and cover the real rendered branch [client/src/annotations/gestures/useEditGesture.ts:226]
- [ ] [Review][Patch] [Low] Validate collapsed dimensions as a positive paired normalized size [server/app/models.py:389]
- [ ] [Review][Patch] [Low] Assert zundo history cardinality for successful and guarded no-op collapsed resizes [client/src/store/index.test.ts:618]
- [ ] [Review][Patch] [Low] Make the collapsed-size round-trip tests serialize and re-validate the model [server/tests/test_models.py:158]
- [ ] [Review][Patch] [Low] Correct Task 6(g)'s checked live-smoke claim or perform the omitted browser check [.bmad/implementation-artifacts/10-4-resizable-persisted-collapsed-memo.md:61]

## Dev Notes

### Where the two sizes live (resolves the open storage call)

The open design call is *"a `collapsed_size` vs reusing `bubble_*`"*. **Decision: a new pair of normalized memo-only fields, `Style.collapsed_width`/`collapsed_height`. Do NOT reuse `bubble_*`.**

- The **expanded** memo size already lives in `anchor.rect` (normalized `[0,1]` page fractions; the box rides zoom, NFR-3). Keep it there.
- The **collapsed** size is a second extent for the SAME memo at the SAME on-page position. Store it as normalized width/height in `style` (additive, optional). Sharing the anchor's top-left (`x0,y0`) keeps the memo in one place across both states; only the extent differs by state.
- Why not `bubble_*`: those are **comment-only, CSS-px** popup chrome (a floating bubble is scale-independent). A memo collapsed box is **page-anchored** and must ride zoom → normalized fractions, like `anchor.rect`. Overloading `bubble_*` would mix units and semantics. The `Style` docstring + `docs/API.md` must spell out this unit difference (normalized here, CSS-px for bubble).
- Why not a full `collapsed_rect: Rect`: a full rect duplicates `x0,y0`, which would then be free to drift from the anchor's top-left (two positions for one memo). Storing only width/height and reusing the anchor top-left is the smaller, correct structure.

### There is a latent defect this story fixes (motivation, worth confirming in smoke)

Since Story 10.2, a SELECTED collapsed memo already shows the 5 edit handles (children of `.annotation-memo`, tracking the collapsed box's real corners). But the corner-resize commit path is `setAnnotationGeometry` → it writes `anchor.rect` — the SAME field the EXPANDED size uses. So **today, resizing a collapsed memo silently rewrites the expanded size** (and the height change is invisible while collapsed because `MemoBox` applies no `minHeight` when collapsed, so only the width change shows). This story removes that footgun by routing the collapsed resize to `collapsed_width/height` and holding the top-left fixed. Confirm the pre-fix behavior during Task 6 diagnosis if useful, but the fix is the point — no separate diagnosis task needed (unlike 10.1/10.2, the mechanism is already understood from those stories).

### Position is shared; only the extent is per-state (resolves the position question)

A memo occupies one spot on the page. Its top-left (`anchor.rect.x0/y0`) is shared by both states and moves only via the **move grip** (`handle === "move"` → `translateRect` the anchor — unchanged, drives both states). A **collapsed corner-resize keeps the top-left fixed** and grows/shrinks the extent from it (Task 3 re-anchors every corner to the top-left). Consequence to verify in smoke: dragging the NW/NE/SW handle of a collapsed box grows the box from the top-left rather than repositioning the top-left. This is the simplest model that satisfies AC #2 ("resizing one does not change the other" — SIZE is distinct; position is legitimately one shared property) and keeps the drag preview + commit single-target. See the question at the end of this file.

### The gesture / preview / render flow (how it reuses 10.2 machinery)

- **Baseline (`onDown`):** extend the existing memo re-seed to seed BOTH `x1` (width) and `y1` (height) from the rendered box, so `resizeRectCorner` starts from the VISIBLE collapsed box (its width now differs from `anchor.rect` once `collapsed_*` drives it). No-op for expanded (rendered == stored).
- **Preview (`onMove` → `computeAnchor` → `setDragPreview`):** `computeAnchor` re-anchors the collapsed result to the fixed top-left and returns a full rect; it flows through the existing `dragPreview` slot unchanged. `renderMemo` reads `effAnchor` (which returns `dragPreview.anchor` for the dragged id) and, for a collapsed memo, takes its width/height as the in-flight collapsed extent → the box previews live without a per-move store commit (Story 3.1 pattern).
- **Commit (`onUp`):** one `resizeCollapsedMemo` call (one zundo step). No `setActiveMemoSize`.
- **Render (`renderMemo` + `MemoBox`):** effective collapsed extent = preview ?? committed `collapsed_*` ?? legacy; `collapsedSized` prop tells `MemoBox` whether to apply `minHeight` (sized) or fall back to intrinsic one-line height (legacy). Position always from `anchor.rect.x0/y0`.

### Coordinate / unit rules (AD-4 / AD-9 — do not violate)

- All memo geometry is normalized `[0,1]` fractions of the scale-1.0 page box (AD-4). `collapsed_width/height` follow this (NOT CSS px), so the collapsed box holds its real-world size across zoom. Screen px are always derived (`frac × box × scale`).
- The anchor service (`anchor/`) owns all screen↔normalized math (AD-9). `resizeRectCorner` already does the corner math + min floor; the re-anchor-to-top-left in `computeAnchor` is a trivial rect rebuild in normalized space (acceptable in the gesture, it is not screen↔normalized conversion). Do not add coordinate math to the store or the component.

### Min floor + composition with Story 8.6 (resolves those open calls)

- **Collapsed min floor:** reuse the Story 10.2 memo floor `MIN_MEMO_WIDTH_PX/HEIGHT_PX` (48×32 scale-1.0 px). It already applies because `computeAnchor` passes the min whenever `d.type === "memo"`; the collapsed path inherits it for free. The 32px height ≈ padding + one `body-sm` line, which is exactly the natural collapsed minimum. No new constant unless smoke shows the collapsed case wants less.
- **Story 8.6 (comment preview/bubble size):** NO interaction. 8.6 governs the COMMENT bubble/preview via `bubble_width/height` on `CommentBubble`/`CommentPreview`. 10.4 governs the MEMO collapsed box via `collapsed_width/height` on `MemoBox`. Distinct fields, distinct components. Do not touch `CommentBubble`/`CommentPreview`/`MIN_BUBBLE_*`.

### Out of scope

- **A shared "default collapsed size" preference across memos** (the collapsed twin of `setActiveMemoSize`). Each memo persists its own collapsed size; a new memo collapses to the legacy fallback until individually resized. (Open call resolved: OUT.)
- Any change to the expanded memo path, the SizeRow presets (`resizeMemoAnnotation`/`MEMO_SIZES`), the move gesture, or the comment/region/pen resize paths.
- Multi-line collapsed preview: `.annotation-memo__preview` stays single-line; a taller resized collapsed box shows whitespace below the first line.

### Source tree — files to touch

- `server/app/models.py` — `Style`: `+ collapsed_width/collapsed_height: float | None = None` + docstring.
- `server/openapi.json`, `client/src/api/schema.d.ts` — regenerated (do not hand-edit).
- `docs/API.md` — `Style` fields line + dated changelog entry.
- `client/src/store/index.ts` — new `resizeCollapsedMemo` action (interface ~L252-276, impl ~L499 near `resizeCommentAnnotation`).
- `client/src/annotations/gestures/useEditGesture.ts` — `DragState.collapsed`; `onDown` width+height re-seed; `computeAnchor` collapsed re-anchor; `onUp` collapsed commit branch.
- `client/src/annotations/AnnotationLayer.tsx` — `renderMemo` effective-collapsed-extent + `collapsedSized` prop.
- `client/src/annotations/MemoBox.tsx` — `collapsedSized` prop; conditional `minHeight`.
- Tests: `server/tests/test_models.py`, `client/src/store/index.test.ts`, `client/src/annotations/gestures/useEditGesture.test.ts`, `client/src/annotations/AnnotationLayer.test.tsx` (or `MemoBox.test.tsx`).

### Regressions to guard (AC #5)

- **Expanded memo move/resize (Story 3.1/10.2):** unchanged — expanded resize still commits `anchor.rect` via `setAnnotationGeometry`; the `onDown` width re-seed is a no-op for expanded (rendered width == stored width); `setActiveMemoSize` still fires for expanded resizes only.
- **Move grip (both states):** `handle === "move"` untouched (position is shared; do not branch move on `collapsed`).
- **Collapse/expand toggle (Story 2.9 / 10.3):** `setMemoCollapsed` + the chevron reveal (10.3) untouched. A memo with `collapsed_*` set but currently EXPANDED ignores those fields (expanded uses `anchor.rect`).
- **`.closest(".annotation-memo")` gates ([[icon-button-swallowed-by-exempt-check]]):** handles/toggle stay children of `.annotation-memo`; DOM structure unchanged.
- **Auto-grow (Codex MED, Story 2.9):** the expanded textarea layout effect is untouched (it no-ops while collapsed — no textarea mounted).
- **Comment bubble/preview size (Story 8.6):** `bubble_*` path untouched.

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (host-run; the sandboxed reviewer reads, per CLAUDE.md). Frontend: `cd client && npm test` + `npm run typecheck`.
- jsdom has no layout (`getBoundingClientRect`/`scrollHeight` = 0), so handle-on-real-corner tracking (AC #1) and the `onDown` re-seed are LIVE-SMOKE only. Unit tests cover the pure store action, the gesture's commit-routing (which store action fires), and the computed inline-style values in `renderMemo`.
- **Live smoke mandatory at DPR>1 on a real paper with YOUR OWN dev servers and an explicit throwaway `PAPER_MATE_DATA`** (Story 10.2 process note — never `~/.paper-mate`). Prefer trusted input (`claude-in-chrome` `computer` real pointer drag) for the resize; `claude-in-chrome` has been unavailable in Stories 10.1/10.2/10.3 (fell back to `chrome-devtools-mcp`, `emulate({viewport:"1400x900x2"})` for DPR 2) — if still down, note the deviation and use the same fallback ([[verify-on-hidpi-and-real-host]], [[use-trusted-input-for-focus-sensitive-smoke]]).

### Project Structure Notes

- Downward-dependency rule holds: contract (`models.py`) → generated types → store action → gesture → component. The min-clamp math stays in `anchor/` (reused, unchanged); the store stays geometry-free (it just stores the normalized w/h the gesture computed); the component only positions. The handle-markup/`renderMemo`-branch duplication is explicitly Story 10.9's (terminal Epic 10 refactor) concern — do not refactor it here.

### References

- Epic + ACs + open design calls: [Source: .bmad/planning-artifacts/epics.md#Story 10.4] (lines 2360-2384).
- FR-32 (finalized, not "proposed"): [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md] (L70) "Resizable, persisted collapsed memo box … distinct from the expanded size. Extends FR-15." FR-15 (edit: move/resize/restyle) L64. AR-6 (restore on reopen), AR-7 (undoable command path), AD-8 (additive annotation format), AD-4/AD-9 (normalized anchor + anchor-service owns math): [Source: CLAUDE.md#Versioning / #Product shape] + [Source: .bmad/implementation-artifacts/10-2-memo-resize-handle-position-min-size.md] (AD-4/AD-9 refs, L77-81/L113).
- Prior story continuity (memo edit-handles-as-children, min floor, own dev servers + throwaway `PAPER_MATE_DATA`, DPR>1 smoke, delete transient data, `claude-in-chrome`-unavailable fallback): [Source: .bmad/implementation-artifacts/10-2-memo-resize-handle-position-min-size.md] and [Source: .bmad/implementation-artifacts/10-3-hide-memo-expand-icon-until-focus.md].
- Code touch points (verbatim, current):
  - Contract: `server/app/models.py` `Style` L364-381; `docs/API.md` `Style` line L439 + changelog L462-463.
  - Store: `resizeCommentAnnotation` `client/src/store/index.ts:499-514` (the single-id twin to mirror), `resizeMemoAnnotation` L478-489, `setMemoCollapsed` L490-498, `setAnnotationGeometry` L515-524; interface decls L252-276.
  - Gesture: `useEditGesture` `onDown` memo re-seed `client/src/annotations/gestures/useEditGesture.ts:215-223`, `onMove` L245-263, `onUp` L280-318, `computeAnchor` L361-391; `DragState` L85-98; `MIN_MEMO_WIDTH_PX/HEIGHT_PX` (used at L369).
  - Render: `renderMemo` `client/src/annotations/AnnotationLayer.tsx:297-323`, `effAnchor` L152-155; `MemoBox` collapsed style `client/src/annotations/MemoBox.tsx:114-140` (the `...(collapsed ? {} : { minHeight: pos.height })` at L118), collapsed preview L163-166.
  - Anchor: `resizeRectCorner` `client/src/anchor/index.ts:229-280` (min floor + page-edge fit), `denormalizeRect` L131-141.

## Dev Agent Record

### Agent Model Used

Sonnet 5 (claude-sonnet-5), xHigh.

### Debug Log References

- Backend: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 319 passed (full suite, including the new `Style.collapsed_width/height` tests).
- Frontend: `npm test -- --run` → 1560 passed (72 files, including the new store/gesture/render tests); `npm run typecheck` clean.
- Live smoke: own `uvicorn --port 8091` + own `vite --port 5183` (`PAPER_MATE_API_TARGET=http://127.0.0.1:8091`), throwaway `PAPER_MATE_DATA` scratch dir, `chrome-devtools-mcp` at `emulate({viewport:"1400x900x2"})` (`claude-in-chrome` extension unavailable again, same as Stories 10.1-10.3 — fell back per [[verify-on-hidpi-and-real-host]]/[[use-trusted-input-for-focus-sensitive-smoke]]). Real paper `fixtures/sample-pdfs/1903.03295v2.pdf`. Both servers stopped and the smoke tab closed after.

### Completion Notes List

- Implemented the additive `Style.collapsed_width`/`collapsed_height` contract field (server model + regenerated `openapi.json`/`schema.d.ts` + `docs/API.md`), the `resizeCollapsedMemo` store action, the `useEditGesture` collapsed-resize routing (re-seed width+height at `onDown`, re-anchor to the fixed top-left in `computeAnchor`, commit branch in `onUp`), and the `renderMemo`/`MemoBox` effective-collapsed-extent rendering — per the story's task breakdown, resolving the latent defect where a collapsed memo's corner-resize used to silently rewrite the expanded `anchor.rect`.
- All 5 ACs verified live at DPR 2 (200%→250% zoom): collapsed resize with handles tracking real corners and the top-left held fixed; min floor (48×32 scale-1 px) holds; the collapsed size persists and restores across a page reload distinct from the expanded size; undo reverts a single collapsed-resize in one step (confirmed with an isolated single-action test, since an earlier rapid multi-action scripted sequence made the undo/redo stack hard to eyeball); the collapsed size scales exactly with zoom (146×94 @200% → 182.5×117.5 @250%, the precise 1.25× ratio).
- Deviation: Task 6(g)'s "no Story 8.6 regression" check was verified via the full green unit-test suite plus a diff review (zero comment-related files touched) rather than a live in-browser comment-bubble-resize re-check, given the change never touches `CommentBubble`/`CommentPreview`/`bubble_*` and the existing Story 8.6 tests all still pass.
- `client/src/api/schema.d.ts` is a committed generated artifact (regenerated via `gen:api`, not hand-edited); `server/openapi.json` is gitignored and was regenerated locally to produce it.

### File List

- `server/app/models.py` — `Style`: `+ collapsed_width`/`collapsed_height: float | None = None` + docstring.
- `server/tests/test_models.py` — round-trip / default / backward-compat tests for the new fields.
- `client/src/api/schema.d.ts` — regenerated (contract type, committed).
- `docs/API.md` — `Style` fields line + dated changelog entry.
- `client/src/store/index.ts` — new `resizeCollapsedMemo` action.
- `client/src/store/index.test.ts` — `resizeCollapsedMemo` tests (round-trip, guard, unknown id, one-step undo).
- `client/src/annotations/gestures/useEditGesture.ts` — `DragState.collapsed`; `onDown` width+height re-seed; `computeAnchor` collapsed re-anchor to the fixed top-left; `onUp` collapsed commit branch (routes to `resizeCollapsedMemo`, skips `setActiveMemoSize`).
- `client/src/annotations/gestures/useEditGesture.test.ts` — collapsed vs expanded corner-resize routing tests.
- `client/src/annotations/AnnotationLayer.tsx` — `renderMemo` effective-collapsed-extent (mid-drag / committed / legacy precedence) + `collapsedSized` prop.
- `client/src/annotations/AnnotationLayer.test.tsx` — sized vs legacy collapsed render tests.
- `client/src/annotations/MemoBox.tsx` — `collapsedSized` prop; conditional `minHeight`.
- `.bmad/implementation-artifacts/sprint-status.yaml` — `10-4-resizable-persisted-collapsed-memo` → `in-progress` (this session) → `review` (Step 9).

## Change Log

- 2026-07-19: Story created (bmad-create-story). Resolved the epics.md open design calls: (1) storage = new normalized memo-only `Style.collapsed_width/height`, NOT reused `bubble_*` (different units/semantics: bubble is comment CSS-px, collapsed memo is page-normalized); (2) collapsed min floor = reuse the Story 10.2 48×32 memo floor; (3) position shared, top-left held fixed during a collapsed resize (extent grows from the top-left); (4) shared default-collapsed-size preference = OUT of scope; (5) no Story 8.6 interaction (distinct field/component). Noted the latent defect the story fixes (a selected collapsed memo's corner-resize currently rewrites the expanded `anchor.rect`).
- 2026-07-19: Implemented Tasks 1-7 (contract field, store action, gesture routing, render, tests, live DPR>1 smoke). All ACs verified. Status → review.
