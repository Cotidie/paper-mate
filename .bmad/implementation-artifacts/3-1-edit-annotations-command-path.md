---
baseline_commit: bcbec292f5bc2085dd6f3c19c067c4e989630c1e
---

# Story 3.1: Edit annotations (command path)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to select and edit a mark (move, resize, restyle, re-edit text),
so that I can refine annotations after creating them, with every edit flowing through one mutation surface.

> **The convergence story of Epic 3.** Every Epic-2 edit today is a client-only direct store mutation (`recolorAnnotation`, `restrokeAnnotation`, `realphaAnnotation`, `retextAnnotation`, `resizeMemoAnnotation`, `deleteAnnotation`) whose own doc-comment says *"no command stack yet (Epic 3 folds it in)."* Story 3.1 IS that fold: it adds the missing edit features (drag-handle move/resize, double-click re-edit) and makes the store's annotation-mutation action surface THE single command path that no component mutates around (AD-7, AE-3). It lands on the clean base Story 5.0 left (the `marks.ts` descriptor registry, the `patchAnnotations` combinator, the `gestures/` hooks, the `useSelection` seam).
>
> **Scope boundary, read first (AE-1 / AE-3 / Story 5.0 note):** 3.1 builds the command PATH (one mutation funnel + the new geometry/retext edits + the edit UI). It does **NOT** add `zundo` or any do/undo *stack* mechanism: that is the AE-1 enabler for **Story 3.2 (undo/redo)**, which wraps this one clean seam. It also does NOT add autosave/persistence (3.4/3.5), the Annotation Bank (3.6), highlight↔comment convert (3.7), or text-range adjust (3.8). Shape the mutation surface so 3.2's zundo wraps it cleanly; do not pre-build 3.2.
>
> **Scope decisions (2026-06-30, user):** (1) move/resize = **pen + rect ONLY**; text-mark spatial edit is deferred to Story 3.8 (resolves Open Q1). (2) The **cross-type hit-layer (AC #4) is DEFERRED** out of 3.1 to a fast-follow: it mainly disambiguates overlapping TEXT marks, which 3.1 does not edit.

## Acceptance Criteria

> Faithful to `epics.md` Story 3.1 (incl. the 3 deferred-work notes folded in 2026-06-30). Restated self-contained so the dev needs only this file.

1. **Select shows handles.** In cursor mode, single-clicking an annotation selects it (reusing the Story 2.5 `selectedId` seam) AND shows drag handles on the selected mark (move + resize affordances). (FR-15, IP-6, UX-DR14, AD-12)

2. **Drag a handle moves/resizes; geometry re-normalizes via the anchor service.** Dragging a handle moves or resizes the selected mark, and the new geometry is re-normalized against the page box through the `anchor/` service (never hand-rolled). This MUST cover every mark geometry, not just text rects (FR-15, AR-4, AD-4):
   - `kind=path` (pen): move = TRANSLATE all normalized `points`; resize = SCALE them about the drag anchor.
   - `kind=rect` (memo, region highlight, rect comment): move = translate the rect; resize = free corner drag to a new canonical `{x0,y0,x1,y1}` (`x0<=x1, y0<=y1`).
   - `kind=text` (highlight/underline/text-comment): handled "per the run." Free-drag move/resize of text marks is NOT in 3.1 (it would desync `anchor.text` from the glyphs and break re-render fidelity); their spatial edit is the text-RANGE adjust of **Story 3.8**. In 3.1 a selected text mark gets restyle + re-edit + delete only. (See Dev Notes "Text-mark move scope" + the Open Question.)

3. **Memo corner-resize is the priority piece (folded from deferred-work).** A selected memo exposes CORNER handles for free resize, and a body-drag affordance (a move handle / border drag, NOT the textarea, which owns pointer for typing) to move. Routed through the command path here, NOT the client-only Story 2.9 mutation. (The memo's transparent / no-color VISUAL treatment is Epic 4 Story 4.3 and is OUT of scope.) (FR-15, AR-4)

4. **Cross-type unified hit-layer (DEFERRED out of 3.1, 2026-06-30 user decision).** NOT built in 3.1. It disambiguates which mark wins when marks of DIFFERENT types overlap the same spot (recent-wins across types), which is almost entirely a text-mark concern (highlight + underline + comment on one run), and 3.1 does not edit text marks. Tracked as a fast-follow (fold into Story 3.8 or its own story). Original intent preserved for that story: one transparent `created_at`-ordered hit layer (`pointer-events:auto`), paint groups `pointer-events:none`, preserving the 2.5 hover/select/group-aware behavior; `marks.ts` is the seam Story 5.0 left for it.

5. **Restyle + double-click re-edit, both through the command path.** Re-opening a selected mark's quick-box restyles its color (works for every selected mark, reusing 2.5/2.6/2.13 rows). Double-clicking a text/memo/comment annotation re-edits its text: memo focuses its textarea, comment opens its bubble. Memo and comment text re-edit route through `retextAnnotation` (the command path), with no special-case client mutation surviving once 3.1 lands. (FR-15, IP-6)

6. **One command path; nothing mutates around it.** Every edit (move/resize/restyle/retext/delete) flows through the single client command path = the store's annotation-mutation action surface. NO component mutates annotations outside it (AR-7, AD-7). The path is shaped so Story 3.2 can wrap it with `zundo`; 3.1 adds NO zundo, NO undo/redo, NO autosave.

7. **Editing state is stable and zoom-glued.** In the editing state, handles + the restyle affordance show and the canvas never reflows (UX-DR16, NFR-1); handles, ring, and live drag preview re-derive at the correct screen position across all zoom levels (NFR-3).

8. **Contract + anchor-MODEL neutrality.** No contract change: the `Annotation` shape, the `style`/`body`/`anchor.kind` discriminator, and the tracked OpenAPI (`server/openapi.json`) + generated TS (`client/src/api/schema.d.ts`) stay byte-identical (`git diff --stat` empty on both). Move/resize/retext rewrite only anchor/body VALUES, not the model; no Pydantic edit. (AR-3, AR-5, AR-9)

## Tasks / Subtasks

> Land as a SEQUENCE of small PRs (low-risk to high-risk), each suite-green + contract-byte-identical, mirroring the Story 5.0 strategy so a regression is bisectable. Tasks 1-4 are 3.1. Task 5 (cross-type hit-layer) is DEFERRED out of 3.1 (see AC #4).

- [x] **Task 1 - anchor/ geometry helpers for move/resize (AC: #2, #3).** Lowest risk: pure functions, the types the store mutations consume.
  - [x] Added `translateRect`, `translatePoints`, `resizeRectCorner` (canonicalize-d), `scalePoints`, and `pointsBounds` (pen bbox, used by the frame + resize origin) in `anchor/index.ts`. All thin transforms on the existing `Rect`/`Point` types; reuse `canonicalize`. translate clamps the DELTA (not the corners) so size is preserved at the edge.
  - [x] Results clamped to `[0,1]` (translatePoints clamps the delta by the stroke bbox so the whole stroke stays on-page).
  - [x] 14 unit tests in `anchor/anchor.test.ts` (binary-clean fractions for exact `toEqual`). 37 anchor tests green.

- [x] **Task 2 - store geometry mutation = the command-path addition (AC: #2, #3, #6).**
  - [x] **ONE action `setAnnotationGeometry(id, anchor, now)`** (deviation from the task's separate `moveAnnotation`/`resizeAnnotationRect` sketch — see Completion Notes). The GESTURE computes the moved/resized anchor with the `anchor/` helpers and hands it in; the store does NO coordinate math (AD-9: the store still imports `api/` only). Covers `rect` (memo/region/comment-pin) + `path` (pen) via one path.
  - [x] `resizeMemoAnnotation` (PRESET SizeRow) kept untouched. Free corner-resize goes through `setAnnotationGeometry`.
  - [x] DIRECT mutation (no command stack — zundo is 3.2). Rewrites anchor VALUES only: a kind CHANGE is rejected as a no-op (AC-8). Store header + the per-action "Epic 3 folds it in" comments updated to say 3.1 is the fold, 3.2 adds undo.
  - [x] `setAnnotationGeometry` no-ops an unknown id; transient `dragPreview` is doc-agnostic UI state (the layer only previews the selected mark, already doc-scoped). Full doc-scoping stays AE-4 / 3.4.
  - [x] 5 unit tests in `store/index.test.ts` (rect replace, path replace, unknown-id no-op, kind-change reject, dragPreview is transient). 28 store tests green.

- [x] **Task 3 - drag-handle UI + edit gesture (AC: #1, #2, #3, #7).**
  - [x] `AnnotationLayer` renders an edit frame (move grip + 4 corner handles) for the selected `path`/`rect`/region mark, positioned via `denormalizeRect`(`pointsBounds` for pen) so it rides zoom (NFR-3 — live-smoked at 250%). Handles are `<button>`s (so the doc-level deselect/create handlers skip them via `isExempt`; keyboard-reachable).
  - [x] `gestures/useEditGesture.ts` follows the pen/box gesture pattern: draft ref + live preview via the transient store `dragPreview` (no per-pointermove commit), commits ONE `setAnnotationGeometry` on release. The layer renders the dragged mark at `dragPreview.anchor` while in flight.
  - [x] Document-level handlers, phase-gated, `isExempt`. Aborts on `Esc` / `pointercancel` / `blur` WITHOUT committing (preview cleared, mark unchanged).
  - [x] Memo: corner handles free-resize + a move GRIP (a pill above the frame, NOT a border/body drag — cleaner, never fights the textarea; deviation noted). Live preview via dragPreview.
  - [x] Pen: move grip (the "pen movable when selected" request) + bbox corner resize (scale points about the opposite corner; geometry only, width unchanged per Open Q2). 4 gesture tests + 7 layer edit-frame tests green.

- [x] **Task 4 - double-click re-edit + restyle convergence (AC: #5, #6).**
  - [x] Memo: `onDoubleClick` focuses the textarea for re-editing; edits still write through `retextAnnotation`. Comment re-edit is the existing 2.10 behavior (single-click the pin opens the `CommentBubble`, which writes via `retextAnnotation`) — no new path needed; the bubble IS the comment re-edit affordance.
  - [x] Convergence audit (AE-3): every mutation already routes through a store action — `MemoBox`/`CommentBubble` → `retextAnnotation`, quick-box → recolor/restroke/realpha/resize, the new edit gesture → `setAnnotationGeometry`. NO component mutates annotations out of band. 2 memo re-edit tests green.

- [ ] ~~**Task 5 - cross-type unified hit-layer (AC: #4).**~~ **DEFERRED out of 3.1** (2026-06-30 user decision): text-mark editing is out of 3.1, so cross-type overlap disambiguation is low-value now. Fast-follow / fold into Story 3.8. Intent preserved in AC #4 for that story.

- [ ] **Task 6 - close-out + verification.**
  - [x] Cross-model Codex review (AE-6, AP-3): ran `bmad-code-review` via `codex exec` (Codex 0.142.4, a different model) against the story + full diff (`bcbec29..HEAD`). Verdict **Changes Requested**, 0 High / 1 Med / 0 Low. The Med (pen resize: 1-D strokes no-op + edge overscale clips points) is RESOLVED (per-axis `axisScale` + factor-clamp; 4 new tests; live-smoked). AC-1..AC-8 audited Met (AC-2 now fully met post-fix). Report: `.bmad/implementation-artifacts/3-1-code-review-codex.md`.
  - [x] Live smoke on OWN servers (uvicorn 8011 + vite 5191, scratch data dir; user's 8000 untouched, shut down after). Memo: place → frame + 5 handles; move grip +150/+100 EXACT, size preserved; SE resize +80/+60 origin held. Zoom 250%: memo + SE handle scaled ×1.25 EXACT, handle pixel-aligned to the corner (NFR-3). Pen: draw → frame bounds the points; move grip +100/+50 EXACT. Delete (Del) removed the mark + cleared the frame. Empty-memo cleanup on tool-switch still fires. **DPR note:** the new geometry math has ZERO `devicePixelRatio` references (works in CSS px + normalized space, reusing the Epic-2-proven normalize/denormalize that already divide DPR out), so it is DPR-invariant by construction; the 250% zoom pass covers the scale axis. A belt-and-suspenders DPR>=1.25 human pass is still advisable per AE-5.
  - [x] Bumped `server/pyproject.toml` `0.2.1 -> 0.2.2` (verified live `/api/health` → `{"version":"0.2.2"}`); synced `server/uv.lock`. No `/api` change → `docs/API.md` untouched; OpenAPI/schema byte-identical.
  - [x] No `render/` export moved → both `vi.mock("./render")` barrels untouched (AP-2 N/A). `no-raw-values.test.ts` green (handle/frame styles are token-driven; added `--edit-handle-size` to `theme/components.css`).
  - [x] Updated `client/src/annotations/README.md` with the Story 3.1 section.

## Dev Notes

### The command-path mental model (the spine of this story)

AD-7 is the canonical rule: *"every annotation change - create, move, resize, restyle, retext, delete - flows through one path: a client command stack (do/undo) -> store -> dirty flag -> debounced autosave ... No component mutates annotations outside the command path."* That full path is built across Epic 3:

- **3.1 (this story)** = the PATH: one mutation surface (the store actions) + the missing geometry/retext edits + the edit UI. Direct mutations, no stack.
- **3.2** = wraps that surface with `zundo` (the Zustand temporal middleware, the AE-1 / PREP-2 adopt-stable choice) to make it do/undo + binds `Ctrl Z` / `Ctrl Shift Z`. `zundo` is NOT a dependency yet (`client/package.json` confirms): do not add it here.
- **3.4** = adds the dirty flag + single-flight debounced autosave on the same surface; **3.5** = hydrate-on-open.

So in 3.1, "flows through the single client command stack" (the AC wording) means **the store's annotation-mutation actions are the one funnel, and nothing mutates around them.** Commit one store mutation per discrete edit (one per drag, not per `pointermove`) so each is a clean undoable transaction in 3.2.

### Reuse map - what already exists (do NOT rebuild)

- **`store/index.ts`** (244 lines) - the mutation surface: `addAnnotation`, `deleteAnnotation` (group-aware, AR-4), `recolorAnnotation`, `restrokeAnnotation`, `realphaAnnotation`, `retextAnnotation`, `resizeMemoAnnotation` (PRESET-only), the `patchAnnotations(map, ids, now, apply)` combinator (Story 5.0), `selectedId`/`select`/`clearSelection`, `hoveredId`/`setHovered`, the `active*` defaults. ADD move + free-resize here; do not fork a parallel mutation path.
- **`anchor/index.ts`** - `canonicalize`, `normalizeRect`/`denormalizeRect`, `normalizePoint`/`denormalizePoint`, `mergeRects`, `pickPage`, `collectTextRects`, `rectsFromSelection`. Stable + correct across zoom/cross-page/HiDPI (Epic 2 proof). The geometry round-trip is here; ADD the translate/scale helpers here too. Do NOT move math out of `anchor/` (AD-9).
- **`annotations/gestures/`** - `usePenGesture`, `useBoxGesture`, `useMemoPlacement`, `useSelection`, `shared.ts` (`GestureContext`, `isExempt`). The edit gesture follows the SAME draft-refs + live-preview + commit-on-release shape. `useSelection.ts` (338 lines) is the selection seam: it already projects the selected mark to screen, owns the quick-box, group-aware actions, focus, and doc-scoping. Extend it; do not re-implement selection.
- **`annotations/marks.ts`** - `MARK_DESCRIPTORS` (per-tool `{type, kind, quickBox}`) + `quickBoxSpec(anno)`. The dispatch seam (one entry per tool) and the explicit clean seam Story 5.0 left for the cross-type hit-layer.
- **`MemoBox.tsx` / `CommentBubble.tsx`** - the on-page editable surfaces; both already write `body` via `retextAnnotation`. Double-click just needs to route INTO these.
- **The Epic-2 test suites** (`AnnotationInteraction.test.tsx`, `AnnotationLayer.test.tsx`, `useSelection`/gesture/store/anchor tests) - the safety net. Keep them green; new behavior gets new tests.

### Move/resize geometry, per kind (the actual math)

All in normalized space (fractions of the page box), then the store stores the new anchor values:
- **rect** (memo/region/rect-comment): move = add `(dx,dy)` to `{x0,y0,x1,y1}`; resize = move the dragged corner, then `canonicalize`. Clamp to `[0,1]`.
- **path** (pen): move = add `(dx,dy)` to every point; resize = scale every point about the bounding-box anchor corner. `stroke_width` stays scale-1.0 (do not rescale it on resize unless the AC's "scale" is taken to include width - default: leave width unchanged, only geometry scales).
- **text** (highlight/underline/text-comment): NO free move/resize in 3.1 (see below).

Convert a screen-pixel drag delta to a normalized delta with the SAME page box + scale the selection projection uses (`getPagesRef` + `scaleRef` in `useSelection`); divide the client delta by `box * scale`. This is the inverse of `denormalize*`, so reuse those primitives rather than new trig (AP-4).

### Text-mark move scope (recommendation + see Open Question)

The epics AC lists `kind=text` under move/resize as "per the run." A text mark's rects are derived from real glyphs and carry `anchor.text`; free-translating them off the glyphs breaks the re-render-at-exact-coordinates contract (NFR-3) and desyncs `anchor.text`. Story 3.8 (adjust text range) is the proper spatial edit for text marks (re-resolve the run via `rectsFromSelection`/`collectTextRects`). **Recommended scope: 3.1 gives drag-handle move/resize to `path` + `rect` marks only; text marks get restyle + double-click re-edit + delete in 3.1, and range-adjust handles in 3.8.** This matches the user's two explicit folded requests (pen movable, memo corner-resize) and the 3.8 boundary. Confirm before building text-mark handles (Open Question 1).

### Cross-type hit-layer guidance (AC #4, the risky piece)

Today (per `annotations/README.md`): marks paint into per-type groups, the highlight group is an isolated opacity group, recent-wins works WITHIN the highlight group (sorted `created_at`) but NOT across groups (an underline always hit-tests above a highlight on the same run because of DOM group order). The fix: a single transparent hit layer, one element per mark in `created_at` order, `pointer-events:auto`; paint groups go `pointer-events:none`. Keep the comment pin / bubble / memo textarea as their own real controls (they live outside the decorative sheet by design, AD-9). This is the highest regression risk: it must preserve every Story 2.5 selection behavior (hover, ring, group-aware two-page, click-select in cursor + active-tool modes). If it threatens the schedule, it is the one piece that could be a fast-follow PR, but the AC folds it in, so default to shipping it (last, behind a green Task 1-4).

### What must NOT change (regression + boundary guardrails)

- **No contract / anchor-MODEL change.** `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` empty. Geometry edits rewrite anchor VALUES only. No Pydantic edit. (AR-3, AR-5)
- **No zundo / undo-redo / autosave / Bank / convert / range-adjust.** Those are 3.2 / 3.4 / 3.6 / 3.7 / 3.8. Building any here is scope creep.
- **No Epic-4 fidelity work** (column-aware geometry, distinct comment/memo treatment). The memo's transparent visual treatment is 4.3, NOT 3.1's body-drag/resize.
- **Preserve every Epic-2 interaction** (create-on-release, single-`activeTool` FSM + single-click switch, click-select/recolor/delete, arm-time color, pen draw/restroke/alpha, memo place/empty-cleanup, comment pin/bubble/cross-page-group, box region, drag-to-change-tool, right-click place-at-point picker).
- **AD-9 layering** - no upward imports; math stays in `anchor/`, contract in `api/`, view + gestures in `annotations/`.
- **AP-1 document-level handlers**, phase-gated, editable/buttons exempt; **reset drag state on blur** (memory), not only on pointerup.
- **Doc-scope** the new mutations like `useSelection` does (singleton store until 3.4 / AE-4).

### Project Structure Notes

Work stays WITHIN the existing `annotations/` + `anchor/` + `store/` boundaries (AD-9 layers unchanged). New code: anchor helpers (Task 1), store actions (Task 2), an edit-gesture hook under `annotations/gestures/` + handle rendering in the layer / a co-located component (Task 3), double-click wiring (Task 4), the hit-layer in `AnnotationLayer` (Task 5). Co-locate component + scoped style + test per the flat convention; handle/hit-layer styles in `Annotations.css`, token-driven (no raw values).

### Testing standards

- Frontend Vitest + jsdom: `cd client && npm test` (run from `client/`, loads `vite.config.ts` -> jsdom; `npx vitest` from `src/` fails with `document is not defined`). jsdom zeroes `getClientRects`, so geometry is asserted via the existing fake-card + injected `rectReader` pattern; copy it for handle/move/resize tests. Baseline at `bcbec29`: client ~429 tests / server 43, contract byte-clean.
- Backend pytest: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (expect green, no backend change this story).
- **DPR>1 live smoke is mandatory** (AE-5, memory verify-on-hidpi-and-real-host): geometry/placement bugs are invisible at DPR=1 (the Story 2.3 HiDPI highlight-stretch bug). Smoke move/resize/hit-layer at DPR>=1.25 incl. a cross-page mark, on your OWN fresh servers (CLAUDE.md: never reuse the user's running server).
- Cross-model Codex review on the diff (AE-6) - it caught HIGH bugs in 2.2/2.5/2.8/2.10.

### Versioning

PATCH +1 when 3.1 reaches done: `0.2.1 -> 0.2.2`. Single source `server/pyproject.toml [project].version` -> `app/version.py` -> `GET /api/health` -> top-bar badge. Bump once at PR merge, not per commit.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-3.1] - the 6 ACs + the 3 folded deferred-work notes (memo corner-resize priority; route memo/comment retext through the command path; cross-type unified hit-layer); the every-kind move/resize note (path/rect/text).
- [Source: .bmad/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#AD-7] - the one command path; "no component mutates annotations outside" it. #AD-12 - selection model, "move/resize/retext later in 3.1 routes through the command path." #AD-4/#AD-5 (geometry-on-kind), #AD-9 (layering), #AR-7.
- [Source: .bmad/implementation-artifacts/epic-2/epic-2-retro-2026-06-30.md] - AE-1 (zundo is the 3.2 enabler, before 3.2), AE-3 (every Epic-2 client-only edit converges on the 3.1 command path; no new client-only mutation in Epic 3), AE-4 (doc-scope at 3.4), AE-5 (DPR>1 smoke), AE-6 (Codex review), AE-7 (sandbox pytest workaround).
- [Source: .bmad/implementation-artifacts/5-0-structural-refactor.md] - the clean base: `marks.ts` registry, `patchAnnotations` combinator, `gestures/` hooks, the "no command stack yet - 3.2 wraps this seam with zundo" decision, the cross-type hit-layer seam left intentionally.
- [Source: client/src/store/index.ts] - the mutation surface to extend (move/free-resize) + the "Epic 3 folds it in" comments. [client/src/annotations/gestures/useSelection.ts] - the selection seam + projection. [client/src/anchor/index.ts] - the geometry primitives (add translate/scale here). [client/src/annotations/marks.ts] - the descriptor registry. [client/src/annotations/README.md] - exact current per-tool behavior + the paint-group/hit-test layout.
- [Source: CLAUDE.md] - AP-1 document-level handlers, AP-2 render mock-barrel sync, no-raw-values (theme/** only), versioning, "launch your OWN dev servers for live smoke," AD-2 raw pdf.js + custom overlay.
- Memories: `verify-on-hidpi-and-real-host`, `held-key-state-reset-on-blur`, `prefer-stable-solutions`.

## Open Questions

> Saved for the dev/PO; each has a recommended default so work is not blocked.

1. ~~**Text-mark move/resize**~~ **RESOLVED (2026-06-30, user):** 3.1 move/resize = `path` + `rect` ONLY. Text-mark spatial edit (re-resolve the run, rewrite `rects` + `text` together) is Story 3.8. Free-translating text rects was rejected because it desyncs `anchor.text` from the glyphs.
2. ~~**Pen resize semantics**~~ **RESOLVED (implemented):** geometry only — `scalePoints` rescales the points, `stroke_width` is unchanged (the user's chosen scale-1.0 value). `MIN_PEN_SCALE` guards against collapsing a stroke to zero/flipped.
3. ~~**Cross-type hit-layer sequencing**~~ **RESOLVED (2026-06-30, user):** DEFERRED out of 3.1 (fast-follow / fold into 3.8).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story).

### Debug Log References

- Baseline (`bcbec29`): client 464 / 29 files green, server 43 green, contract (`openapi.json` + `schema.d.ts`) byte-clean.
- Post-3.1: client 464 green (the new tests replaced none; counts: anchor 37 (+16), store 28 (+5), useEditGesture 4 (new file), AnnotationLayer 45 (+9)), server 43 green, typecheck + prod build clean, contract diff EMPTY.
- **Pre-existing flake (NOT introduced):** `Reader.test.tsx > zooms on Ctrl+wheel ...` failed ONCE in one full parallel run, passed in isolation (26/26) and on the immediate full rerun (464/464). This story touches zero Reader/render code; it is the Story-5.0-documented test-isolation flake (Story 4.1 de-flakes it). Left as-is.
- Live-smoke read timing: a synchronous DOM read right after a dispatched `pointerup` sees the PRE-re-render DOM (Zustand `set` → React re-render is async). Re-read in a fresh tick to verify committed geometry — confirmed move/resize landed exactly.

### Completion Notes List

**Scope (user-confirmed 2026-06-30):** move/resize limited to `path` + `rect` marks; text-mark spatial edit deferred to Story 3.8 (free-moving a text rect desyncs `anchor.text`). Cross-type hit-layer (AC #4) deferred out of 3.1 (mostly a text-mark overlap concern). Both recorded in the Story block + ACs + Open Questions.

**Deviation 1 — ONE `setAnnotationGeometry(id, anchor, now)` instead of separate `moveAnnotation`/`resizeAnnotationRect`.** The store must not do coordinate math (AD-9: it imports `api/` only, never `anchor/`). So the GESTURE computes the moved/resized anchor with the `anchor/` helpers and hands the finished anchor to one setter. This is simpler than threading dx/dy/corner into the store and keeps all math in `anchor/`. The AC intent (move/resize through the one command path) is met; a kind change is rejected so it can only rewrite VALUES (AC-8).

**Deviation 2 — move via a GRIP, not a body/border drag.** The task sketched a memo body/border-drag move. I used a move grip (a pill centered above the edit frame) for both memo and pen: it never competes with the memo textarea's pointer (typing), reads clearly as "drag to move," and is one consistent affordance across kinds. Corner handles do resize.

**Transient `dragPreview` store field** (sibling of `hoveredId`/`selectedId`): the in-flight move/resize anchor, so the layer previews the drag WITHOUT a per-pointermove commit — the single `setAnnotationGeometry` lands on release (one undoable step for 3.2). It is UI-only; when 3.2 adds zundo, exclude it from the temporal partialize exactly like `selectedId`/`hoveredId`.

**Convergence (AE-3) holds:** audited — retext (memo/comment), recolor/restroke/realpha/resize (quick-box), geometry (edit gesture), delete all go through store actions; no component mutates annotations out of band. The store header + the per-action "Epic 3 folds it in" comments were updated to say 3.1 is the fold and 3.2 adds the undo stack.

**Contract neutral (AC-8):** `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` EMPTY. No Pydantic edit; geometry/retext rewrite anchor/body VALUES only.

**User fixes (2026-06-30, all live-smoked on own servers):**
- **A. Pen no-auto-select.** Removed `select(created.id)` from `usePenGesture` — a finished stroke no longer auto-selects, so the selection quick-box + edit frame do NOT pop after each stroke and the user draws consecutive strokes uninterrupted. Other tools keep auto-select (one-off marks). Click a stroke later to select + edit. Test asserts `selectedId === null` + no quick-box after a pen draw.
- **B. Memo click-away deselects, never double-places.** `useMemoPlacement` now SKIPS placing when a mark is selected — the empty-space click deselects (via `useSelection`) instead of dropping a second memo. Its listener moved to CAPTURE phase (registered at mount, before `useSelection`'s capture clear) so it reads the pre-clear `selectedId`. Test: with a memo selected, an empty-space click keeps the count at 1 and clears selection. Live-smoked: placed + typed memo, clicked away → kept (count 1), no 2nd memo.
- **C. Pen starting on an existing mark creates a new stroke (no select).** CSS: under `.pdf-canvas[data-draw]` (pen armed) the mark hit-surfaces (`.annotation-highlight/-pen/-memo/-comment-pin`) become `pointer-events:none`, so a pointerdown ON an existing mark passes through to the page → a NEW stroke starts and the existing mark is neither hit-tested, pointer-captured, nor click-selected. Live-smoked: `elementFromPoint` on an existing stroke returns `textLayer` (not the path); drawing there made a 2nd stroke with nothing selected. (CSS hit-testing isn't exercised by jsdom → live-smoke is the coverage.)

**Post-review user fixes (2026-06-30, all live-smoked):**
- **D. Memo size chooser removed.** The preset `SizeRow` is gone from BOTH the rail memo flyout (`ToolRail`) + the selection quick-box (`AnnotationInteraction`); descriptor `memo.quickBox.size=false`. A memo now resizes only via the edit-frame corner handles. App/ToolRail `activeMemoSize`/`onPickMemoSize` props dropped. (The store's preset-resize plumbing — `resizeMemoAnnotation`, `MEMO_SIZES`, `selectedMemoSize`, `SizeRow.tsx` — is left unwired/dead, flagged for a later cleanup; free corner-resize via `setAnnotationGeometry` supersedes it.)
- **E. Pen click-select vs drag-draw.** Removed `setPointerCapture(e.target)` from `usePenGesture` (capturing to the mark synthesized a click→select on a drag that started on a stroke — the real cause of the earlier bug) and removed the fix-C `pointer-events:none` CSS. Now: a single CLICK on an idle stroke (pen armed) selects it (the mark's own onClick); a DRAG starting on a stroke creates a NEW stroke and selects nothing. A `suppressClickRef` (reset each pointerdown) swallows the click a scribble-that-drew would otherwise fire, preventing a draw from also selecting. Live-smoked: click-selects, drag-on-stroke makes a 2nd stroke.
- **F. Default memo 20% smaller** → 112×112 square (was 140).
- **G. Remember last memo size.** A memo corner-resize records its new scale-1.0 px size as `activeMemoSize`, so the next placed memo lands at it (last-adjusted-wins; move does not change it). Live-smoked: resized a memo to 162², the next memo placed at 162².
- **H. Memo deselect-by-click now blurs (behave like Esc).** Root cause: clicking empty space cleared `selectedId` (dropping the `--selected` ring) but never blurred the memo textarea, so its `:focus-visible` ring (the SAME 2px ink outline) persisted → the memo still LOOKED selected (black border). Fix: `useSelection`'s outside-click deselect now blurs a focused `.annotation-memo` before clearing, matching the MemoBox Esc handler. Live-smoked: after the click the textarea is blurred, deselected, border back to the yellow accent.
- **I. Pen hover outline shows in SELECTION mode only; suppressed while drawing; selection always outlines.** All mark types keep their hover ring; under `.pdf-canvas[data-draw]` (pen armed) the ring is suppressed so a stroke crossing other marks shows nothing, and `hoveredId` is cleared on pen disarm (no stale ring). For pen strokes the suppression is `.pdf-canvas[data-draw] .annotation-pen--hovered:not(.annotation-pen--selected){stroke:none}` — the `:not(--selected)` is the key: it lets a SELECTED stroke keep its outline even while the pen is armed and the pointer is over it. Without it, the suppression rule (specificity 0,3,0) out-specified `--selected` (0,1,0), so a selected stroke LOST its outline whenever the pointer was on it and regained it off — the inversion the user reported. Net behavior: pen tool mode → no hover outline; selection (cursor) mode → hover outline shows; selected → outline always, pointer on or off. Hover width is its own `--annotation-pen-hover-width` token (was the misnamed `--annotation-pen-selected-width`). Live-smoked on a real PDF, full 4×2 matrix (idle/hover/selected/hover+selected × pen-armed/selection): pen-armed hover = `stroke:none`, selection hover = ink, selected = ink everywhere.

**Cross-model Codex review (AE-6) — done, 1 Med resolved.** Codex 0.142.4 verdict Changes Requested, 1 Med: pen resize (a) no-op'd 1-D (horizontal/vertical) strokes and (b) clipped points flat on an overscale drag instead of clamping the scale factor. Fixed in `useEditGesture.computeAnchor` with a per-axis `axisScale(moving, origin, delta)`: zero-extent axis → scale 1 (resize the other axis), and the factor is derived from the page-clamped moving edge (floored at `MIN_PEN_SCALE`) so shape is preserved on overscale. 4 new `useEditGesture.test.ts` cases (horizontal, vertical, overscale-shape-preserved, no-flip). Live-smoked: a horizontal stroke widened 136→236px on SE-drag (was a no-op pre-fix). Report + resolution: `.bmad/implementation-artifacts/3-1-code-review-codex.md`.

### File List

Modified:
- `client/src/anchor/index.ts` (translate/resize/scale/pointsBounds edit-geometry helpers)
- `client/src/anchor/anchor.test.ts` (16 helper tests)
- `client/src/store/index.ts` (`setAnnotationGeometry` + transient `dragPreview`; header + comment updates)
- `client/src/store/index.test.ts` (5 geometry/dragPreview tests)
- `client/src/annotations/AnnotationLayer.tsx` (preview-aware `effAnchor`, the edit frame + handles, `isEditable`/`editMark`)
- `client/src/annotations/AnnotationLayer.test.tsx` (7 edit-frame + 2 memo re-edit tests)
- `client/src/annotations/AnnotationInteraction.tsx` (wire `useEditGesture`)
- `client/src/annotations/MemoBox.tsx` (double-click → focus textarea)
- `client/src/annotations/Annotations.css` (edit-frame + handle styles, token-driven)
- `client/src/theme/components.css` (`--edit-handle-size` token)
- `client/src/annotations/README.md` (Story 3.1 section)
- `server/pyproject.toml` (version `0.2.1 → 0.2.2`)
- `server/uv.lock` (synced to 0.2.2)

- `client/src/annotations/gestures/usePenGesture.ts` (no auto-select on release — fix A; no setPointerCapture + suppress-click-after-draw for click-select vs drag-draw — fix E)
- `client/src/annotations/gestures/useMemoPlacement.ts` (skip place when a mark is selected → deselect; capture-phase listener — user fix B)
- `client/src/annotations/gestures/useEditGesture.ts` (pen resize per-axis axisScale — review fix; remember memo resize as default — fix G)
- `client/src/annotations/gestures/useSelection.ts` (blur a focused memo on outside-click deselect — fix H)
- `client/src/annotations/marks.ts` + `marks.test.ts` (memo quickBox.size:false — fix D)
- `client/src/ToolRail.tsx` + `ToolRail.test.tsx` (drop memo SizeRow + activeMemoSize/onPickMemoSize props — fix D)
- `client/src/App.tsx` (drop memo-size wiring to ToolRail — fix D)

New:
- `client/src/annotations/gestures/useEditGesture.ts` (the move/resize gesture)
- `client/src/annotations/gestures/useEditGesture.test.ts` (4 gesture tests)

### Change Log

- 2026-06-30: Story 3.1 implemented (Tasks 1-4 + close-out). anchor/ edit transforms + `pointsBounds`; store `setAnnotationGeometry` + transient `dragPreview` (the one move/resize command-path action, AD-7/AE-3, no zundo); `useEditGesture` + the on-page edit frame (move grip + corner handles) for selected pen/rect/region marks with live drag preview and zoom-glue (NFR-3); memo double-click re-edit. Move/resize scoped to pen + rect (text → 3.8); cross-type hit-layer deferred (AC #4). Contract byte-identical; version 0.2.1 → 0.2.2. Client 464 + server 43 green; live-smoked on own servers incl. 250% zoom. Cross-model Codex review pending.
- 2026-06-30/07-01 (post-review user fixes H-I): (H) memo deselect-by-click now blurs the textarea (matches Esc) so it stops showing a black `:focus-visible` ring after deselect; (I) pen hover outline shows in SELECTION (cursor) mode, is suppressed while the pen is armed via `.annotation-pen--hovered:not(.annotation-pen--selected)` under `data-draw`, and a SELECTED stroke always keeps its outline (pointer on or off) — the `:not(--selected)` fixes a CSS-specificity inversion where a selected stroke lost its outline under the pointer. `hoveredId` cleared on pen disarm; hover width is its own `--annotation-pen-hover-width` token. Tests added; both live-smoked (real PDF, full pen-armed x selection matrix). Client 472 green.
- 2026-06-30 (post-review user fixes D-G): removed the preset memo SizeRow chooser (rail flyout + selection quick-box; resize via corner handles only); pen single-click selects an idle stroke while a drag-on-stroke draws a new one (dropped mark-targeted setPointerCapture + the fix-C CSS, added suppress-click-after-draw); default memo 20% smaller (112² square); a memo corner-resize is remembered as the default size for new memos. Tests added/updated; all 4 live-smoked. Client 470 green.
- 2026-06-30 (Codex review fix): pen corner-resize reworked to per-axis `axisScale` — 1-D (horizontal/vertical) strokes now resize on their non-zero axis (were a no-op), and an overscale drag clamps the scale FACTOR (shape preserved) instead of clipping points flat at the page edge. 4 new gesture tests; live-smoked. Resolves the single Med from the cross-model review. Client 469 (468 + flake).
- 2026-06-30 (user fixes A/B/C): (A) pen no longer auto-selects on release (`usePenGesture`) so consecutive strokes draw uninterrupted; (B) memo click-away deselects instead of placing a 2nd box (`useMemoPlacement`, capture-phase + selectedId gate); (C) a pen stroke starting ON an existing mark creates a new stroke instead of selecting it (`Annotations.css` `data-draw` → marks `pointer-events:none`). Tests added/updated; all three live-smoked. Client 465 green.
