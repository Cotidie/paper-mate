# Story 3.1 Cross-Model Code Review

## Verdict

Changes Requested

## Findings

| Severity | File:line | Problem | Concrete fix |
| --- | --- | --- | --- |
| Med | `client/src/annotations/gestures/useEditGesture.ts:158` | Pen resize does not cover valid 1-D strokes and can distort strokes at page edges. `computeAnchor` returns the original anchor whenever either bbox extent is zero, so a perfectly horizontal or vertical pen stroke cannot be resized at all, despite AC-2 requiring path resize. On top of that, `scalePoints` clamps each scaled point independently (`client/src/anchor/index.ts:238`), so dragging a pen resize past the page edge clips/flat-spots the stroke instead of clamping the scale factor and preserving the stroke shape. | Treat zero extents per axis, not as a whole-stroke no-op: allow the non-zero axis to scale and use scale `1` for the zero axis; only no-op a true dot. Clamp `sx`/`sy` to finite min/max factors that keep the bbox in `[0,1]`, then scale points without per-point clipping except for final floating-point safety. Add tests for horizontal, vertical, and near-edge overscale pen resize. |

No High findings. No Low findings.

## Acceptance-Criteria Audit

| AC | Status | Evidence |
| --- | --- | --- |
| AC-1 | Met | Selection reuses store `selectedId` and mark click handlers (`client/src/annotations/AnnotationLayer.tsx:190`, `:258`, `:284`). The selected editable mark renders an edit frame with move + corner handles at `client/src/annotations/AnnotationLayer.tsx:353`. |
| AC-2 | Partially met | Rect move/resize and path move route through `computeAnchor` (`client/src/annotations/gestures/useEditGesture.ts:148`) and anchor helpers (`client/src/anchor/index.ts:156`, `:168`, `:213`). Path resize exists at `client/src/annotations/gestures/useEditGesture.ts:154`, but the finding above leaves 1-D strokes and edge overscale incorrectly handled. |
| AC-3 | Met | Memos are `kind=rect` and receive the same edit frame (`client/src/annotations/AnnotationLayer.tsx:166`, `:271`, `:353`). The textarea remains the typing surface while movement is via the separate move grip (`client/src/annotations/Annotations.css:768`). |
| AC-4 | Deferred per story scope | The story explicitly defers the cross-type hit layer. The implementation keeps existing paint groups in `client/src/annotations/AnnotationLayer.tsx:395`, `:407`, `:411`, and only adds pen-mode pointer passthrough CSS at `client/src/annotations/Annotations.css:784`. |
| AC-5 | Met | Restyle still routes through store actions in `useSelection` (`client/src/annotations/gestures/useSelection.ts:118`, `:132`, `:142`, `:154`). Memo double-click focuses the textarea without bypassing `retextAnnotation` (`client/src/annotations/MemoBox.tsx:51`, `:71`). Comment text edits route through `retextAnnotation` from `CommentBubble` wiring (`client/src/annotations/AnnotationLayer.tsx:328`). |
| AC-6 | Met | Geometry commits go through `setAnnotationGeometry` (`client/src/store/index.ts:266`) while restyle/retext/delete use store actions (`client/src/store/index.ts:221`, `:246`, `:197`). Mechanical search found no component-side `annotations.set/delete` mutation outside tests. |
| AC-7 | Met with residual risk from finding | The edit frame and preview re-derive from normalized anchors via `denormalizeRect`/`pointsBounds` (`client/src/annotations/AnnotationLayer.tsx:160`, `:356`). Drag preview is transient and avoids per-pointermove commits (`client/src/annotations/gestures/useEditGesture.ts:109`). The pen-resize edge bug is a behavioral risk for selected strokes at degenerate extents or page edges. |
| AC-8 | Met | Contract guard is empty for `server/openapi.json` and `client/src/api/schema.d.ts`. Store rejects anchor kind changes (`client/src/store/index.ts:266`), and the store imports only API types (`client/src/store/index.ts:15`). |

## Behavior And Contract Neutrality

Contract guard: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` is empty, both in the worktree and across `bcbec29..HEAD`.

Verification observed:
- `cd client && npm run typecheck`: passed.
- `cd client && npm test`: passed, 29 files / 465 tests.
- `cd client && npm run build`: passed; Vite emitted the existing large-chunk warning.
- Backend: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q` produced no output and was interrupted after roughly four minutes. A verbose retry with `timeout 120s ... uv run pytest -vv` collected 43 tests but timed out while still at `tests/test_docs.py::test_upload_returns_doc`, with no failure trace. Backend verification is inconclusive in this sandbox run.

Behavior-regression risk is limited to pen resize edge cases. The command path, layering constraints, memo placement capture ordering, pen no-auto-select change, and `data-draw` hit-surface passthrough all look consistent with the stated scope.

## Resolution (2026-06-30, post-review fix)

The one Med finding is FIXED. `useEditGesture.computeAnchor` pen-resize now scales PER AXIS via a new `axisScale(moving, origin, delta)` helper:
- A zero-extent axis (a perfectly horizontal/vertical stroke) returns scale `1` for that axis instead of no-op-ing the whole resize — so 1-D strokes resize on their non-zero axis. Only a true dot (both axes zero) is a no-op.
- The scale is derived from the moving edge CLAMPED to the page `[0,1]` (and floored at `MIN_PEN_SCALE` of the extent, on the original side of the origin), so an overscale drag limits the FACTOR and the stroke keeps its shape, instead of `scalePoints` clipping each point flat at the edge.

Added 4 `useEditGesture.test.ts` cases: horizontal-stroke resize, vertical-stroke resize, overscale-clamps-factor (midpoint preserved, not flattened), and no-collapse/flip past the opposite edge. Re-verified: `npm run typecheck` clean, `npm test` 468/469 (the 1 fail is the pre-existing `Reader.test.tsx` Ctrl+wheel isolation flake — passes alone/on rerun, unrelated), `npm run build` clean, contract guard empty. Live-smoked: a horizontal pen stroke's SE-handle drag widened it 136→236px (was a no-op before the fix).

Verdict after fix: the Changes-Requested item is resolved; no other findings outstanding.
