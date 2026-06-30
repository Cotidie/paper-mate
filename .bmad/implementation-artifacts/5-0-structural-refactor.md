# Story 5.0: Codebase structural refactor (data contracts + conditional/FSM unification + src split)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the annotation code unified behind data contracts, a per-tool descriptor/FSM, and a clean module split,
so that adding a tool or an edit is one registration, not edits across five `if` chains, and the codebase has a clear modular structure for Epic 3's command path to build on.

> **Enabler, pulled to the Epic-2/Epic-3 boundary (Epic 2 retro AE-2).** Tracked under Epic 5 for grouping, but sequenced BEFORE Story 3.1 so the command path lands on a clean base, not on the current sprawl (which would then have to be unwound). **No behavior change, no contract change.** Its own PR(s); never folded into a feature story.

## Acceptance Criteria

> The defining bar for ALL of these: **behavior and contract are unchanged.** Client + server suites stay green, the tracked OpenAPI contract (`server/openapi.json` + `client/src/api/schema.d.ts`) is byte-identical, `no-raw-values.test.ts` stays green. A test may change ONLY by import path, never by assertion — if an assertion must change to pass, that is a behavior change: STOP.

1. **Per-kind/per-tool dispatch replaces the conditional sprawl.** The repeated "branch by annotation kind/type" decision in `AnnotationLayer` (6 group filters + 5 `render*` funcs), `AnnotationInteraction` (the `pointerup` create chain + per-tool quick-box branches), `create.ts` (5 near-twin `build*`), and `store` (5 near-twin mutation `set()` blocks) is unified behind ONE descriptor/registry keyed on `anchor.kind` + `type` (AD-5 as the dispatch key). Adding a tool becomes registering one descriptor entry, not editing five chains. (AR-9, AD-5)
2. **Recurring loose shapes become typed data contracts.** The create-options twins (`BuildOptions`/`BuildPenOptions`/`BuildMemoOptions`/`BuildCommentPinOptions`/region) consolidate into one "create request" contract per tool; the `active*` / `setActive*` / `*Ref` scalar fans (color, stroke-width, alpha, memo-size) become one "active-tool defaults" object; bare `{x,y}` / rect literals route through shared `Point`/`Rect` helpers. Any data class **wraps or derives the generated `Annotation` type, never shadows or replaces it** (AD-3). (AR-3)
3. **The fragmented interaction state consolidates into one FSM.** The overlay lifecycle that today lives as separate `useState`/`useRef`/`useEffect` islands in `AnnotationInteraction` (`selectionBoxOpen`, the pen draft, the box draft, the comment-click candidate, the Esc/dismiss logic) plus the standalone `machine.ts` reducer collapses into ONE explicit state machine with named states + transitions (extends `machine.ts`, AD-11/PREP-3). Each behavior becomes a transition in one place, not several cooperating effects. (AD-11)
4. **The oversized modules split cleanly.** `AnnotationInteraction.tsx` (1186 lines) and `AnnotationLayer.tsx` (557 lines) split into feature-scoped modules / hooks (e.g. `useBoxGesture`, `usePenGesture`, `useMemoPlacement`; per-mark renderers) within the `annotations/` feature boundary; co-locate component + scoped CSS + tests; shared logic in `hooks/`/`utils/`. AD-9 layering preserved (math in `anchor/`, contract in `api/`, view in `annotations/`, no upward deps). If any `render/` export moves, BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) are updated in the same change; `no-raw-values.test.ts` re-run after any CSS move. (AR-9, CLAUDE.md engineering principles)

## Tasks / Subtasks

> Land as a SEQUENCE of independent PRs (one per thread), each suite-green + contract-byte-identical, so a regression is bisectable and review stays small. Order is low-risk → high-risk.

- [ ] **Task 1 — Data contracts (AC: #2).** Lowest risk; sets the types the registry consumes.
  - [ ] Consolidate the five `Build*Options` interfaces in `create.ts` into one discriminated "create request" per tool (or a single tagged union), each carrying only its tool's fields; keep `newId`/`now` injection (deterministic tests).
  - [ ] Replace the `activeColor`/`activeStrokeWidth`/`activeAlpha`/`activeMemoSize` scalar fields + their `setActive*` setters in `store/index.ts` with one "active-tool defaults" object (shape only; do NOT make it per-tool — that is Story 5.2). Update the `active*Ref` mirrors in `AnnotationInteraction.tsx` to read the one object.
  - [ ] Route bare point/rect literals through the existing `anchor/` `Point`/`Rect` helpers; no new geometry math (adopt-stable, AP-4).
  - [ ] Suite green, contract byte-identical, typecheck clean. PR 1.
- [ ] **Task 2 — Per-kind/per-tool descriptor registry (AC: #1).**
  - [ ] Define a descriptor interface keyed on `anchor.kind` + `type` (e.g. `{ kind, type, build, render, quickBoxRows, hitSelector }`); one entry per tool.
  - [ ] Route `create.ts` (the 5 `build*`), `AnnotationLayer` (the 6 group filters + 5 `render*`), the `store` mutation twins (`recolor`/`restroke`/`realpha`/`retext`/`resize`/`retype`/`delete` guard-then-map blocks), and `AnnotationInteraction`'s `pointerup` create branch through the registry. Delete the now-dead twins.
  - [ ] Keep each store action's SHAPE a direct mutation (do NOT wrap in a command stack — zundo/commands are Epic 3 Story 3.2; 5.0 only consolidates, so 3.1/3.2 can wrap one clean seam, AE-1/AE-3).
  - [ ] Suite green, contract byte-identical. PR 2.
- [ ] **Task 3 — Overlay FSM consolidation (AC: #3).** Highest behavioral risk; do after the registry.
  - [ ] Extend `machine.ts` to own the full overlay lifecycle (armed → annotating → pending → selected → editing → dismissed, plus pen-draft and memo/comment edit sub-states).
  - [ ] Migrate the `AnnotationInteraction` state islands (`selectionBoxOpen`, `penDraftRef`/`penPreview`, `boxDrawingRef`/`boxPreview`, `commentDownRef`, dismiss/Esc effects) into named transitions. Preserve EVERY current behavior exactly (see "What must NOT change").
  - [ ] Do NOT implement layered Esc (that is Story 5.4) — only make the single Esc/dismiss path live in one place so 5.4 can later layer it. No behavior change to Esc in this story.
  - [ ] Suite green, contract byte-identical. PR 3.
- [ ] **Task 4 — src module split (AC: #4).** Mechanical move after logic is unified.
  - [ ] Split `AnnotationInteraction.tsx` into per-gesture hooks (`useBoxGesture`/`usePenGesture`/`useMemoPlacement`/`useSelection`) + a thin composition component; split `AnnotationLayer.tsx` into per-mark renderer modules + a thin layer shell. Keep `annotations/` as the feature boundary; add `hooks/`/`utils/` as needed.
  - [ ] Co-locate scoped CSS + tests with their modules; update import paths only.
  - [ ] If any `render/` export moves: update BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (AP-2). Re-run `no-raw-values.test.ts` after CSS moves.
  - [ ] Suite green, contract byte-identical, typecheck + build clean. PR 4.
- [ ] **Task 5 — Close-out.**
  - [ ] Cross-model Codex review per thread (AP-3).
  - [ ] Update `annotations/README.md` with the new module map + the descriptor pattern.
  - [ ] Bump `server/pyproject.toml` version `0.2.0 → 0.2.1` (PATCH per story, CLAUDE.md#Versioning). No `/api` change → `docs/API.md` untouched.

## Dev Notes

### Why this story exists (the sprawl, with evidence)

The same "branch by annotation kind/type" decision is re-implemented across the annotation pipeline; each tool story (highlight → underline → pen → memo → comment → region) added one more arm to every chain. Concrete current state (measured 2026-06-30):

- **`annotations/AnnotationInteraction.tsx` = 1186 lines.** Holds: the `pointerup` create chain (`pen`/`memo` early-return → `comment` pin/picker → cursor picker → highlight/underline via `createTextTool`), the per-gesture refs (`penDraftRef`, `boxDrawingRef`/`boxStartRef`, `commentDownRef`), the `active*`/`setActive*`/`active*Ref` fans (color, stroke-width, alpha, memo-size — four parallel triplets, lines ~106-166), and several `useState`/`useRef` islands (`selectionBoxOpen`, `penPreview`, `boxPreview`) plus the `overlayReducer`.
- **`annotations/AnnotationLayer.tsx` = 557 lines.** Six group filters (`textMarks`→`highlightMarks`/`underlineMarks`, `penMarks`, `memoMarks`, `regionMarks`, `commentMarks`, lines 272-293) feeding five render funcs (`renderRegion`/`renderMark`/`renderPen`/`renderMemo`/`renderComment`, lines 314-443). ⚠️ No direct unit-test file on `AnnotationLayer` the symbol itself, but `AnnotationLayer.test.tsx` (604 lines) drives it through render.
- **`annotations/create.ts` = 214 lines.** Five near-twin builders (`buildAnnotations`, `buildPenAnnotation`, `buildMemoAnnotation`, `buildCommentPin`, `buildRegionAnnotation`), each assembling the SAME `Annotation` shape with per-type field deltas, behind five parallel `Build*Options` interfaces.
- **`store/index.ts` = 233 lines.** Five near-twin mutation blocks with the identical guard-then-map shape (`recolorAnnotation`, `restrokeAnnotation`, `realphaAnnotation`, `retextAnnotation`, `resizeMemoAnnotation`) + `retypeRegion` + `deleteAnnotation`, and four `setActive*` setters.

Adding the next tool/edit touches all four files. The registry (AC-1) + data contracts (AC-2) make it one descriptor entry; the FSM (AC-3) makes interaction state one machine; the split (AC-4) makes the files legible.

### Reuse map — what already exists (do NOT rebuild)

- `anchor/` — `normalizeRect`/`denormalizeRect`/`normalizePoint`/`denormalizePoint`/`rectsFromSelection`/`collectTextRects`/`pickPage`/`mergeRects`. The geometry layer is stable and correct (NFR-3, cross-page, HiDPI all proven in Epic 2). **Do NOT touch the math or move it out of `anchor/` (AD-9).** The refactor reorganizes the VIEW + STATE layers, not the coordinate layer.
- `machine.ts` (`overlayReducer`, `initialOverlayState`, `AnnotationTool`) — extend it for the FSM, do not replace it.
- `tools.ts` (`ActiveTool`/`AnnotationTool`/`isAnnotationTool`) — the zero-import leaf from Story 2.4; keep it the single tool-union home.
- The generated `Annotation` type (`api/schema.d.ts`) — wrap/derive, never shadow (AD-3).
- The existing test suites (`AnnotationInteraction.test.tsx` 1419 lines, `AnnotationLayer.test.tsx` 604, `create.test.ts` 182, `machine.test.ts`) — these ARE the refactor's safety net. Keep them green; change ONLY import paths.

### What must NOT change (regression guardrails)

- **No behavior change.** Every Epic-2 interaction stays byte-identical: highlight/underline create-on-release + recolor (2.3/2.5), the single `activeTool` FSM + single-click switch (2.4), click-select/recolor/delete (2.5), arm-time color (2.6), pen draw/restroke/alpha (2.8/2.13), memo place/resize/empty-cleanup (2.9), comment pin/bubble/cross-page-group (2.10), box region (2.11), drag-to-change-tool picker (2.12). The 2.3 re-pop fix (`removeAllRanges` on disarm-while-pending) and the 2.10 doc-scoped comment-group ops must survive.
- **No contract change.** `Annotation` shape, the `style`/`body`/`anchor.kind` discriminator, the OpenAPI/`schema.d.ts` — byte-identical (`git diff --stat` empty on both). No Pydantic edit.
- **No feature creep.** This story sets up seams; it does NOT implement the features that ride them: per-tool color (Story 5.2), custom color slots (5.2), layered Esc (5.4), the zundo command stack (Epic 3 Story 3.2). Building any of those here is out of scope — the registry/FSM/contracts must be behavior-neutral.
- **AD-9 layering preserved** — no upward imports (`anchor`/`api` never import `annotations`; `render` never imports annotations).
- **AP-2 mock-barrel sync** — if any `render/` export moves in the split, update both `vi.mock("./render")` barrels in the same change.
- **Tests change by import path only.** If an assertion must change to stay green, the refactor altered behavior: stop and reassess.

### Sequencing & PR strategy

Four independent PRs (Tasks 1-4), low-risk → high-risk, each suite-green + contract-identical. Rationale: a 1186-line file refactored in one PR is unreviewable and an un-bisectable regression risk. Land data contracts first (mechanical), then the registry (deletes the twins), then the FSM (the behavioral core), then the file split (mechanical move). The Codex cross-model review (AP-3) runs per PR.

### Project Structure Notes

- Target structure follows feature-based React conventions (deferred-work cites https://github.com/alan2207/bulletproof-react) WITHIN the existing `annotations/` boundary: small focused files (one concern each), co-located component + scoped CSS + test, shared logic in named `hooks/`/`utils/`. The AD-9 layer split (`render/`, `anchor/`, `annotations/`, `store/`, `api/`) is unchanged — this restructures WITHIN `annotations/`, it does not re-cut the layers.
- Candidate split: `annotations/gestures/` (`useBoxGesture`, `usePenGesture`, `useMemoPlacement`, `useTextSelection`), `annotations/marks/` (per-kind renderer + descriptor), `annotations/overlay/` (the FSM + quick-box shell). Final shape is the dev's call; the AC bar is "small, focused, one concern, co-located, AD-9-clean."
- Possible conflict: the cross-type unified hit-layer (deferred-work, Story 2.7 follow-up) and per-tool color (5.2) both touch this surface. 5.0 should leave a clean seam for them, not implement them. Coordinate, do not absorb.

### Testing standards

- Frontend Vitest + jsdom: the existing suites are the safety net; run `cd client && npm test` continuously and keep all green WITHOUT rewriting assertions. jsdom zeroes `getClientRects`, so geometry is asserted via the existing fake-card + injected `rectReader` pattern — unchanged by this story.
- Backend pytest: no model/contract change; run `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` to confirm 38 green. (See Story 2.4/2.10 verification notes for the Codex-sandbox `UV_CACHE_DIR=/tmp/uv-cache` workaround — Epic-2 action AE-7.)
- Contract guard: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` must be EMPTY after every PR.
- This is a pure refactor, so NO new DPR>1 live smoke is strictly required (no geometry/paint change). A single confirmatory live smoke after Task 4 (load a PDF, create one of each mark, recolor/delete, zoom) is cheap insurance that the move broke nothing.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-5.0] — the 4 ACs + the "before 3.1" sequencing note.
- [Source: .bmad/implementation-artifacts/deferred-work.md] — three refactor items that ARE this story: "lean on data classes / abstracted types"; "unify conditional logic + FSM-isolated state" (the registry + per-tool-descriptor candidate, the `active*` fans, the FSM consolidation — with exact file paths); "src folder and module structural refactoring" (the bulletproof-react split + guardrails).
- [Source: .bmad/implementation-artifacts/epic-2-retro-2026-06-30.md] — AE-2 (do 5.0 before 3.1), AE-3 (Epic-2 edits converge on the 3.1 command path; 5.0 makes that seam clean), the "conditional sprawl" recurring-problem entry.
- [Source: CLAUDE.md#Engineering-principles] — AD-9 layering, AP-2 render mock-barrel sync, `no-raw-values` (raw values only in `theme/**`), AD-3 contract generated never hand-authored.
- [Source: CLAUDE.md#Versioning] — PATCH +1 per story (`0.2.0 → 0.2.1`).
- Architecture ARs: AD-3 (Pydantic → OpenAPI → generated TS, never shadow), AD-5 (geometry-on-kind / style-on-type = the dispatch key), AD-9 (layer boundaries), AD-11 (one FSM, the "design the state machine once" principle / Epic-1 PREP-3).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
