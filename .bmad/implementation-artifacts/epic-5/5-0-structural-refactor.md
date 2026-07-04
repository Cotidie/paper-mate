---
baseline_commit: b45880fab7b8daf36c33b6d7ed3fde86005e7efa
---

# Story 5.0: Codebase structural refactor (data contracts + conditional/FSM unification + src split)

Status: done

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

- [x] **Task 1 — Data contracts (AC: #2).** Lowest risk; sets the types the registry consumes.
  - [x] Consolidate the five `Build*Options` interfaces in `create.ts` into one discriminated "create request" per tool (or a single tagged union), each carrying only its tool's fields; keep `newId`/`now` injection (deterministic tests). → `CreateBase` (now/newId/color) + `TextCreateRequest` (type/body) + `PenCreateRequest` (strokeWidth/alpha); memo/region/comment use `CreateBase` directly.
  - [x] ~~Replace the `activeColor`/… fields + setters in `store/index.ts` with one object~~ Consolidate the `active*Ref` mirrors in `AnnotationInteraction.tsx` into one `defaultsRef` object. **Store/App/ToolRail public `active*` API kept (Option 1, user decision):** consolidating the store-public fields forces rewriting direct assertions in `store/index.test.ts`, which the "tests change by import-path only" guardrail forbids. Store-public-API consolidation deferred out of 5.0 (Story 5.2 reshapes that surface per-tool anyway). See Completion Notes.
  - [x] Route bare point/rect literals through the existing `anchor/` `Point`/`Rect` helpers; no new geometry math (adopt-stable, AP-4). → merged the three identical `{page_index, rect}` placements (`MemoPlacement`/`CommentPinPlacement`/`RegionPlacement`) into one `RectPlacement`; placements/strokes keep the contract `Rect`/`Point` types; no new math.
  - [x] Suite green, contract byte-identical, typecheck clean. PR 1. → 415 client tests green (unchanged), typecheck clean, `git diff --stat` on openapi.json + schema.d.ts empty.
- [x] **Task 2 — Per-kind/per-tool descriptor registry (AC: #1).**
  - [x] Define a descriptor interface keyed on `anchor.kind` + `type`; one entry per tool. → `annotations/marks.ts`: `MARK_DESCRIPTORS: Record<AnnotationTool, MarkDescriptor>` (`{ type, kind, quickBox }`), AD-9-clean (imports only `api/` + `tools.ts`). `quickBoxSpec(anno)` is the single source for the selection quick-box's rows + aria-label + bubble routing.
  - [x] Route the consolidatable sites through the registry / a shared helper:
    - **store mutation twins** → one `patchAnnotations(map, ids, now, apply)` combinator (recolor/restroke/realpha/resizeMemo); `retext` (single-id early-return) + `delete` (group-gather) keep their distinct shapes. The five near-twin guard-then-map `set()` blocks are gone.
    - **`AnnotationInteraction` per-tool quick-box branches** → `quickBoxSpec(selectedAnno)` drives the rows (`strokeWidth`/`alpha`/`size`), the aria-label, and the comment→bubble exclusion. The inline `isPenSelected`/`type === "comment"` booleans are gone (`isMemoSelected` kept: the focus effect needs it).
    - **`AnnotationLayer` 5 render funcs** → the copy-pasted hover/selected/`cls` preamble is extracted to `markState(a)` + a pure `markClass(classList, modifierRoot, hovered, selected)`. Class strings byte-identical.
  - [x] **Scope calls (behavior-byte-identical bar wins over AC-1's letter; story permits "final shape is the dev's call" + "leave a clean seam, don't implement"):**
    - `create.ts` build dispatch NOT forced behind the registry: the five builders have heterogeneous inputs (`PageSelection[]` → `Annotation[]` vs `PenStroke`/`RectPlacement` → one `Annotation`); a uniform `build()` would need an input union + return normalization = MORE indirection, not less. Task 1 already consolidated their shared CONTRACTS, which is the real win.
    - `AnnotationLayer` opacity-group DOM containers + kind/type group filters KEPT: they encode COMPOSITING (the isolated highlight opacity group) + the comment DUAL-render (a text comment paints in the fill group AND the pin group), not a clean (kind,type)→render partition. Collapsing them into one render table would change paint behavior. `marks.ts` is the clean seam for the future cross-type hit-layer (deferred-work) without restructuring the DOM.
  - [x] Each store action's SHAPE stays a direct mutation (no command stack — zundo is Epic 3 Story 3.2; 5.0 leaves one clean seam, AE-1/AE-3).
  - [x] Suite green (422: 415 baseline unchanged + 7 new `marks.test.ts`), contract byte-identical, typecheck clean. PR 2.
- [x] **Task 3 — Overlay state consolidation (AC: #3).** Highest behavioral risk; done after the registry.
  - [x] **REINTERPRETED per user decision (OOP/encapsulation, not an async reducer).** The literal AC ("fold the pen draft + box draft + comment candidate into ONE `useReducer`") is NOT achievable behavior-byte-identically: those drafts are read+mutated SYNCHRONOUSLY inside document-level handlers (AP-1), and a `useReducer` dispatch is async/batched. The user chose the OOP/encapsulation answer: each gesture becomes a cohesive HOOK that owns its synchronous draft refs + transitions (a hook is React's idiomatic "object": private state + constructor params + public interface). This consolidates the islands while preserving the sync-read contract.
  - [x] `machine.ts` kept as the create-picker control reducer (the one genuine FSM; converting it to a class would break `machine.test.ts` assertions → forbidden by the bar). The pen/box drafts, comment candidate, and selection-box state moved into `usePenGesture`/`useBoxGesture`/`useMemoPlacement`/`useSelection`, each owning its own synchronous refs + effects.
  - [x] Single Esc/dismiss path: the create-picker dismiss is one `dismiss()` in the component; the selection Esc/dismiss now lives in ONE place inside `useSelection`. (The two overlays are orthogonal — picker vs selection — so each has its own one-place dismiss; no behavior change, and 5.4 can layer Esc onto these seams.) Layered Esc NOT implemented (that is 5.4).
  - [x] Suite green, contract byte-identical. (Landed across the gesture/selection extraction commits.)
- [x] **Task 4 — src module split (AC: #4).**
  - [x] `AnnotationInteraction.tsx` split into per-gesture hooks (`gestures/usePenGesture`/`useBoxGesture`/`useMemoPlacement`/`useSelection`) + `gestures/shared.ts` (`GestureContext` + `isExempt`) + a thinner composition component (1186 → 637 lines). `AnnotationLayer.tsx` split: `MemoBox.tsx` + `CommentBubble.tsx` extracted (557 → 386 lines). `annotations/` kept as the feature boundary; `gestures/` added as the hooks subdir.
  - [x] **Scope call:** the layer's 5 render funcs + opacity-group DOM containers KEPT in the shell (they encode compositing + comment dual-render, not a clean dispatch — see Task 2 scope call). CSS kept as the shared `Annotations.css` (splitting per-component is cosmetic and risks `no-raw-values`; global stylesheet is unchanged). Component+test stay co-located by the flat convention.
  - [x] No `render/` export moved → both `vi.mock("./render")` barrels untouched (AP-2 N/A). `no-raw-values.test.ts` re-run green (no CSS moved).
  - [x] Suite green (429), contract byte-identical, typecheck + build clean. (Landed across the extraction commits.)
- [x] **Task 5 — Close-out.**
  - [x] Cross-model Codex review (AP-3): ran `bmad-code-review` via `codex exec` (Codex 0.142.4, a different model) against the story + the full diff (`b45880f..HEAD`). Verdict **Changes Requested**, 0 High / 1 Med / 0 Low. The one Med (committed `uv.lock` still at `0.1.10` after the version bump) is RESOLVED (`79c8ec4`). AC-1..AC-4 all audited Met (under the approved scope decisions); behavior + contract neutrality confirmed. Report: `.bmad/implementation-artifacts/5-0-code-review-codex.md`.
  - [x] Updated `annotations/README.md` with the new module map + the descriptor pattern (Story 5.0 section).
  - [x] Bumped `server/pyproject.toml` version `0.2.0 → 0.2.1` (verified live: `/api/health` → `{"version":"0.2.1"}`). No `/api` change → `docs/API.md` untouched; `openapi.json` left byte-identical (its `info.version` was already stale at `0.1.10` pre-story — a pre-existing artifact-staleness, out of scope for a contract-neutral refactor).
  - [x] Confirmatory live smoke (own servers on 8011/5191, never the user's 8000): loaded a PDF (23 pages rendered), drew a pen stroke (real pointer events → `usePenGesture` → mark created), selection quick-box opened ("Pen actions" via the descriptor), recolored (default → green via `patchAnnotations`), Del-deleted. All correct. Servers shut down after.

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
- [Source: .bmad/implementation-artifacts/epic-2/epic-2-retro-2026-06-30.md] — AE-2 (do 5.0 before 3.1), AE-3 (Epic-2 edits converge on the 3.1 command path; 5.0 makes that seam clean), the "conditional sprawl" recurring-problem entry.
- [Source: CLAUDE.md#Engineering-principles] — AD-9 layering, AP-2 render mock-barrel sync, `no-raw-values` (raw values only in `theme/**`), AD-3 contract generated never hand-authored.
- [Source: CLAUDE.md#Versioning] — PATCH +1 per story (`0.2.0 → 0.2.1`).
- Architecture ARs: AD-3 (Pydantic → OpenAPI → generated TS, never shadow), AD-5 (geometry-on-kind / style-on-type = the dispatch key), AD-9 (layer boundaries), AD-11 (one FSM, the "design the state machine once" principle / Epic-1 PREP-3).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story).

### Debug Log References

- Baseline (commit `b45880f`): client 415 tests / 27 files green; server 43 tests green; contract (`openapi.json` + `schema.d.ts`) byte-clean.
- Observed flake (NOT introduced by this story): `Reader.test.tsx > zooms on Ctrl+wheel even when the pointer is off the canvas` failed once in a full parallel run, passed in isolation (26/26) and in 2/2 subsequent full runs. Pre-existing test-isolation sensitivity in that wheel test; this story touches zero Reader/render code and the annotations document-listener set is unchanged. Left as-is (out of scope for a refactor).
- Note: run the client suite as `npm test` from `client/` (loads `vite.config.ts` → jsdom). `npx vitest run <paths>` from `client/src` runs WITHOUT the config → `document is not defined` false failures.

### Completion Notes List

**AC-2 scope decision (user, Option 1 — "internal-only, keep public API"):** AC-2 ("replace the `active*` fields in `store/index.ts` with one defaults object") directly conflicts with the story guardrail "tests change by import-path only, never by assertion" — `store/index.test.ts` asserts on `getState().activeColor` etc. directly, and `active*` is also threaded App → ToolRail → ToolFlyout as props (~73 test reads across 4 files). Per the user's decision, the store/App/ToolRail public `active*` API is KEPT as-is (zero test-assertion changes), and the defaults-object consolidation is applied INTERNALLY only: the create-request contracts in `create.ts` and the `active*Ref` mirrors in `AnnotationInteraction.tsx`. The store-public-API + props consolidation is deferred out of 5.0; Story 5.2 (per-tool color) reshapes that surface anyway, so deferring avoids double churn. Net: AC-2's contract-consolidation intent is met; its store-shape clause is consciously deferred.

**Task 1 (PR 1) — Data contracts.** `create.ts`: five `Build*Options` interfaces → `CreateBase` (now/newId/color) + `TextCreateRequest`/`PenCreateRequest` extensions; three identical `{page_index, rect}` placements → one `RectPlacement`. Builder bodies byte-identical (same `Annotation` shape). `AnnotationInteraction.tsx`: four `active*Ref` scalar mirrors → one `defaultsRef` object (same values, same per-render refresh). No behavior/contract change. Verified: typecheck clean, 415 client tests green (unchanged), contract diff empty.

**Task 2 (PR 2) — Descriptor registry + dedup.** Added `annotations/marks.ts` (`MARK_DESCRIPTORS` + `quickBoxSpec`) as the single per-mark dispatch source. `store/index.ts`: five guard-then-map twins → one `patchAnnotations` combinator (recolor/restroke/realpha/resizeMemo; retext+delete keep distinct shapes). `AnnotationInteraction.tsx`: quick-box rows + aria-label + bubble-exclusion now read `quickBoxSpec`. `AnnotationLayer.tsx`: 5 render-func preambles → `markState` + `markClass` (class strings byte-identical). create-build registry + layer opacity-group DOM intentionally NOT collapsed (see Tasks/Subtasks scope calls). Verified: typecheck clean, 422 client tests green (415 unchanged + 7 new), contract diff empty.

**Task 3 scope decision (user, OOP/encapsulation over async reducer).** When asked how to scope the overlay FSM given that gesture buffers are read synchronously in document handlers (AP-1) — which an async `useReducer` cannot preserve byte-identically — the user chose the OOP/encapsulation answer: encapsulate each gesture as a cohesive hook owning its synchronous state, rather than forcing the drafts into a reducer. So Task 3 + Task 4 merged into a per-gesture/per-component extraction. `machine.ts` stays the create-picker control reducer (the one true FSM; classifying it would break `machine.test.ts`).

**Tasks 3+4 (PRs 3-6) — module split.** `gestures/shared.ts` (`GestureContext`, `isExempt`), `gestures/usePenGesture.ts`, `gestures/useBoxGesture.ts`, `gestures/useMemoPlacement.ts`, `gestures/useSelection.ts` — each gesture lifted VERBATIM into a cohesive hook owning its synchronous refs + document handlers. `MemoBox.tsx` + `CommentBubble.tsx` extracted from the layer. Result: `AnnotationInteraction.tsx` 1186 → 637, `AnnotationLayer.tsx` 557 → 386. The component is now the composition core (create-on-release + the cursor-mode picker machine + previews); the layer is the render shell (opacity groups + dual-render kept deliberately). Verified per commit: typecheck clean, suite green (429), contract byte-identical, no existing test modified.

**Task 5 — close-out + verification.** README module-map section added; version `0.2.0 → 0.2.1`. Full matrix green: backend 43, client 429, `no-raw-values` 44, typecheck clean, prod build clean, contract diff empty. **Live smoke** (own servers 8011/5191, user's 8000 untouched): PDF rendered (23 pages); pen-stroke via real pointer events created a mark and opened the "Pen actions" selection box (the descriptor + `usePenGesture` + `useSelection` live); recolor (→ green, `patchAnnotations`) and Del-delete both worked. **Recommended next step:** run `/code-review` (or `bmad-code-review` via Codex) with a DIFFERENT LLM for the cross-model review (AP-3) — not run inline since same-model review defeats the purpose.

**Observed pre-existing flake (not introduced):** `Reader.test.tsx` Ctrl+wheel test failed once in one full parallel run, passed in isolation + every rerun; this story touches zero Reader/render code. Left as-is.

### File List

Modified:
- `client/src/annotations/create.ts` (Task 1 contract consolidation)
- `client/src/annotations/AnnotationInteraction.tsx` (Task 1 `defaultsRef`; Task 2 `quickBoxSpec`; Tasks 3-4 gesture/selection extraction → 637 lines)
- `client/src/store/index.ts` (Task 2 `patchAnnotations` combinator)
- `client/src/annotations/AnnotationLayer.tsx` (Task 2 `markState`/`markClass`; Task 4 sub-component extraction → 386 lines)
- `client/src/annotations/README.md` (Task 5 module map)
- `server/pyproject.toml` (Task 5 version `0.2.0 → 0.2.1`)

New:
- `client/src/annotations/marks.ts` + `marks.test.ts` (descriptor registry + tests)
- `client/src/annotations/gestures/shared.ts` (`GestureContext` + `isExempt`)
- `client/src/annotations/gestures/usePenGesture.ts`
- `client/src/annotations/gestures/useBoxGesture.ts`
- `client/src/annotations/gestures/useMemoPlacement.ts`
- `client/src/annotations/gestures/useSelection.ts`
- `client/src/annotations/MemoBox.tsx`
- `client/src/annotations/CommentBubble.tsx`

### Change Log

- Task 1 (PR 1, `f11724f`): consolidate create-request data contracts + active-default refs. No behavior/contract change. 2026-06-30.
- Task 2 (PR 2, `fb7e20f`): descriptor registry (`marks.ts`) + store twin combinator (`patchAnnotations`) + layer render-preamble dedup (`markState`/`markClass`); quick-box reads the registry. No behavior/contract change. 2026-06-30.
- Tasks 3-4 (PRs, `76d4268` / `ab5f00e` / `616d057`): extract pen/box/memo gestures + `useSelection` hook + `MemoBox`/`CommentBubble`; `AnnotationInteraction` 1186 → 637, `AnnotationLayer` 557 → 386. No behavior/contract change. 2026-06-30.
- Task 5: README module map; version `0.2.0 → 0.2.1`; full verification matrix + live smoke. 2026-06-30.
- Review fix (`79c8ec4`): cross-model Codex review (Changes Requested, 1 Med) → synced `server/uv.lock` to `0.2.1`. 2026-06-30.
- Follow-up fix (`8dfc772`, BEHAVIOR CHANGE): two PRE-EXISTING bugs surfaced in DPR>1 live testing (the picker/comment handlers were unchanged by the refactor, verified against `b45880f`). The Comment/Memo place-at-point picker was on an empty-area double-click, which a dense PDF's full-page text layer made unreachable (double-click selected a word → H/U/C picker; a picked Comment anchored to the word, not the click). Rebound the picker to RIGHT-CLICK (contextmenu, preventDefault + clear selection + present at point); text-drag still pops H/U/C. 3 double-click tests → right-click + 1 native-menu-suppression test; README updated. Live-smoked at DPR 1.25. **Scope note:** the "behavior byte-identical" bar applies to the refactor commits (`f11724f`..`1de1185`); this commit is an intentional, user-approved behavior fix folded onto the branch (user decision), isolated in its own commit.
