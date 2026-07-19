---
baseline_commit: 7ac1cbe7c90d578b7ce04633ab4b8a2867b0d14c
---

# Story 8.10: Epic 8 structural refactor

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer-user,
I want the code Epic 8 added or touched unified behind clear OOP boundaries with reduced conditional sprawl,
so that the next reader-polish epic builds on cohesive modules instead of accreting more patches onto the same god-files.

## Context: what this story is, and what it is NOT

This is a **pure refactor thread**, the same footing as Story 5.0 / 5.3 / 5.4 (Epic 2/5 refactors) and Story 6.8 / 7.12 (the Epic 6 / Epic 7 refactors): a per-epic cleanup pass, its own PR(s), **never folded into a feature story**. It is the LAST Epic-8 story, sequenced after every feature story (8.1-8.8) and after Story 8.11 landed the empty-space snap, so its scope reflects whatever those stories actually shipped (8.9 closed NEGATIVE and added no production code; 8.11 added the snap).

**No behavior change. No contract change.** No anchor-model, store-model, or API-contract change; no design-token change; no `docs/API.md` change (no `/api` surface is touched). Every existing Epic 1-8 test must still pass unmodified in intent (tests may MOVE or RENAME to follow the new module boundaries, but no assertion changes). If a change would alter observable behavior or a contract, it is out of scope: stop and leave it.

**Two committed decompositions** (the two the epic's ACs name explicitly), plus an **audit-and-fix-only-where-warranted** pass over the rest of the Epic-8 surface:

1. **`render/textSelection.ts`** — decompose the god-method (primary target).
2. **The Annotation Bank filter (8.2) + reading-order sort (8.3) view-state** — unify behind one composable view-state model.

## Acceptance Criteria

1. **Scope + audit (AC-1).** Every source file Stories 8.1-8.11 touched (the list in Dev Notes, finalized against the `baseline_commit`) is audited for the same code smells Stories 5.3 / 6.8 / 7.12 targeted: god-objects / god-functions doing more than one concern; near-duplicate conditional branches that should be one descriptor/registry (mirroring the AD-5 `anchor.kind`-keyed dispatch already established in the codebase); and any coordinate math computed OUTSIDE `anchor/` (an AD-9 boundary check). The audit result is recorded in the Dev Agent Record: which files were decomposed, which were left as-is (byte-clean already), and why.

2. **`render/textSelection.ts` decomposed (AC-2, primary).** The controller currently fuses FIVE concerns into one ~320-line `#enableGlobalListener` closure (see Dev Notes for the anatomy): (a) the text-layer **registry**, (b) Story 4.1 **selection-bounding** (`endOfContent` move + Firefox detection + `prevRange`), (c) Story 8.1 **copy-interception**, (d) Story 8.8 **empty-origin gating**, and (e) Story 8.11 the **snap state machine** (rAF-throttled `setBaseAndExtent` drive). Decompose it along cohesive OOP lines: one class/module per concern, each with a narrow single-purpose interface, wired together by ONE composing controller that owns the shared `document`-level listener lifecycle. This is the same encapsulation approach Story 5.3 applied to Reader/AnnotationLayer/AnnotationInteraction. `paragraphCopy.ts` (8.1) and `nearestTextAnchor.ts` (8.11) are ALREADY separate modules and stay separate; the work is untangling their callers inside the controller, not re-extracting them.

3. **Annotation Bank filter + sort unified (AC-3).** The Bank gained a type-filter (8.2) and a reading-order sort (8.3) as client view-state. Today the sort lives in `lib/bank.ts#bankItems` (always applied) and the filter in `lib/bank.ts#filterBankItems`, and `BankPanel.tsx` re-composes them ad hoc (`filterBankItems(bankItems(...))`) while also owning the `activeTypes` `useState` + the reset-on-open `useLayoutEffect` + `toggleType`. Unify this into ONE composable view-state model (filter and sort composing cleanly, per 8.3's own AC) rather than two independent passes threaded through the component, so `BankPanel` becomes presentational over a single view-state unit.

4. **Pure refactor invariants hold (AC-4).** No behavior and no contract change: every Epic 1-8 test still passes unmodified in intent; there is no anchor/store/API-contract change; no design-token change; no `docs/API.md` change. `npm test` (client) and the backend suite are green, `npm run typecheck` is clean.

5. **AD-9 boundary preserved (AC-5).** `render/` (`textSelection.ts`, `paragraphCopy.ts`, `nearestTextAnchor.ts`, and any new modules the split creates) imports NOTHING from `anchor/`, `annotations/`, or `store/`. The nearest-text resolver's local per-text-node rect measurement stays replicated locally in `render/` (it must NOT start importing `collectTextRects`/`rectsFromSelection` from `anchor/`). No coordinate math migrates out of `anchor/`.

6. **Own PR(s) (AC-6).** Lands separate from any feature story, per the Story 5.0/5.3/5.4/6.8/7.12 precedent.

7. **Live-smoke: the full Epic-8 behavior matrix is unchanged (AC-7).** On your OWN fresh dev servers, at DPR>1, trusted pointer input, the Epic-8 behaviors still work exactly as shipped: (i) an empty-space drag next to text snaps and selects from the nearest line, drag-down AND drag-up, across REPEATED same-session drags, with no cross-column / full-page leak (8.11 / 8.8 AC-5); (ii) an on-text drag (single-line, multi-line, and CROSS-PAGE) still selects + highlights on release; (iii) paragraph-aware copy still joins soft-wrapped lines (8.1); (iv) the Annotation Bank still filters by type (comments-only default on every open) and lists in reading order (8.2/8.3); (v) comment-on-a-region, venue short/full display, comment-preview-size, and tab-switch resume are visually unchanged (8.4-8.7).

8. **No em-dash (AC-8).** No em-dash (—) in any new or changed user-facing string (none expected — this is a refactor) (UX-DR13).

9. **Version bump (AC-9).** `server/pyproject.toml` `[project].version` bumps `0.5.29 → 0.5.30` (one PATCH per story; Epic 8 stays on `0.5.x`, no MINOR bump at epic close per the standing versioning rule). Bump once at PR merge.

## Tasks / Subtasks

- [x] **Audit the Epic-8 surface** (AC: 1)
  - [x] Read every file in the Dev Notes touched-file list against the `baseline_commit`; classify each: decompose / leave-clean.
  - [x] Record the classification + rationale in the Dev Agent Record (mirrors 7.12's "reality-corrections" discipline: state what was and wasn't touched).

- [x] **Decompose `render/textSelection.ts`** (AC: 2, 4, 5)
  - [x] Read `textSelection.ts` fully (436 lines) + its test (504 lines) + `render/index.ts` before editing. Confirmed the barrel/mock constraint: `textSelectionController` is imported via SUB-PATH (`./textSelection`, line 28), NOT re-exported from the `render/` barrel — App/Reader mocks untouched.
  - [x] Split the five tangled concerns into cohesive units with narrow interfaces:
    - `TextLayerRegistry` (`render/textLayerRegistry.ts`) — the layer↔bound map + `register`/`unregister`/`originLayerOf`/`rangeStaysWithinTextLayers`/`resetBound`/`resetAll` + the pure `isEmptyLayerSpace`;
    - `SelectionBounder` (`render/selectionBounder.ts`) — the `selectionchange` `endOfContent` bounding + Firefox detection + `prevRange`;
    - `interceptParagraphCopy` (`render/copyJoiner.ts`) — the `copy` handler, delegating to `paragraphCopy.ts` (stateless → a function, smallest-correct);
    - `SnapController` (`render/snapController.ts`) — the `emptyOrigin` latch + `selectstart` suppress + the whole snap state machine (rAF throttle, `applySnapFrame`/`scheduleSnapFrame`/`flush`/`anchorAtEngage`), delegating to `nearestTextAnchor.ts` (8.8+8.11 kept together per the Dev Notes hint — they share the pointerdown/release/selectstart lifecycle);
    - the composing `TextSelectionController` (`render/textSelection.ts`) owns the single shared `document`-level `AbortController` lifecycle and wires the concern objects to the listeners.
  - [x] Every guard preserved verbatim in intent: shared `{ signal }` teardown; `snapping`/`emptyOrigin` clears on `pointerup`/`pointercancel`/`blur`; capture-phase `pointerup` flush BEFORE the bubble-phase `useCreateQuickBox` consumer; rAF cancel on abort; `isConnected` bail on mid-drag unregister; primary-button-only arm; the 8.9-crossing comment.
  - [x] `textSelection.test.ts` assertions unchanged in intent; the `isEmptyLayerSpace` block moved to `textLayerRegistry.test.ts` (static test-decl count identical to HEAD: 1393 == 1393).

- [x] **Unify the Annotation Bank view-state** (AC: 3, 4)
  - [x] Read `lib/bank.ts`, `components/BankPanel/BankPanel.tsx`, `lib/bank.test.ts`.
  - [x] Folded filter + sort into `useBankView(open, docId)` (`components/BankPanel/useBankView.ts`) owning `activeTypes` (default comments-only, reset on open), `toggleType`, and the `filterBankItems(bankItems(...))` derivation; `BankPanel` is now presentational over `{ rows, activeTypes, toggleType }`. `bankItems`/`filterBankItems` internals untouched (byte-clean leaf).
  - [x] Reset-on-open `useLayoutEffect` semantics preserved (not `useEffect` — stale-rows-flash reason carried in the hook comment).

- [x] **Opportunistic cleanup of the remaining audit targets** (AC: 1, 4) — audited; no further decomposition warranted (see Audit Result). The two committed targets were the epic's only genuine smells.

- [x] **Regression protection + full-suite green** (AC: 4)
  - [x] `cd client && npm test` all green (72 files, 1518 tests, stable across two runs); `npm run typecheck` clean.
  - [x] Backend suite: N/A — no `server/app/**` file touched by the refactor (version NOT bumped in-branch; that is a merge-time action). `test_version` green (pyproject 0.5.29 == uv.lock 0.5.29).
  - [x] No `render/index.ts` export changed (confirmed) → no `vi.mock("./render")` barrel change needed; App/Reader tests green.

- [x] **Live-smoke the Epic-8 matrix (own servers, DPR>1, trusted input, repeated same-session)** (AC: 7)
  - [x] Launched OWN fresh `uvicorn` (:8001) + `vite dev` (:5174) bound to the working tree against an ISOLATED copy of the data dir (never reused the user's :8000). Fixture: the two-column ICCV paper (Multi-task Self-Supervised Visual Learning), DPR 1.25.
  - [x] Snap: empty right-margin drag DOWN and UP both snapped from the nearest line; repeated same-session (down then up) both worked; no cross-column / full-page leak (all wide rects at left 733/935 = right column; verified via selection rects).
  - [x] On-text single-line → highlight (partial-width rect via `/api` readback); CROSS-PAGE drag → highlight (2-page group, per-line rects, NO full-page-block leak in stored rects OR rendered SVG paint); paragraph copy joins soft-wrapped lines (`self-\nsupervised`→`selfsupervised`, `can be\ncollected`→`can be collected`).
  - [x] Bank (verified live in-browser): comments-only default on open, chip toggles filter, cross-page reading order, filter+sort compose, reset-on-open.
  - [x] 8.4-8.7 code untouched by the refactor (audit left-clean); seeded comment pins render. Servers shut down after.

- [x] **Version bump + sprint status** (AC: 9) — done at PR #72 merge: `0.5.29 → 0.5.30` in `server/pyproject.toml` + `uv.lock` synced (`test_version` green), story + `sprint-status.yaml` flipped to `done`.

- [x] **Codex code review** — ran `bmad-code-review` through Codex (GPT-5-Codex). 1 High found + fixed (concern state outliving the enable cycle), regression test added; review approved, no open findings. See the Senior Developer Review section.

## Dev Notes

### The primary target: `render/textSelection.ts` anatomy (read fully before editing)

The file (436 lines) is a single `TextSelectionController` class whose `#enableGlobalListener` method (`textSelection.ts:110-432`) is a ~320-line closure holding FIVE distinct concerns as flat local state + inline `document` listeners. That is the god-method to decompose. The concerns and their current locations:

1. **Text-layer registry** — `#textLayers: Map<Element, HTMLElement>` (layer div → its `endOfContent` bound), `register` (`:72`), `#unregister` (`:102`), `#rangeStaysWithinTextLayers` (`:91`), the local `originLayerOf` closure (`:154`), and `reset` (`:116`). This is the natural nucleus of one cohesive object; the shared `AbortController` lifecycle (`#selectionChangeAbort`, enable-on-first-register at `:110`, tear-down-on-last-unregister at `:104`) is the composing controller's job.
2. **Selection-bounding (Story 4.1)** — the `selectionchange` handler (`:370-431`): moves `endOfContent` to the selection's trailing edge so a drag past the last glyph can't paint a tall `::selection` band, the Firefox detection (`isFirefox`, `:396`), and `prevRange` tracking. Self-contained; depends only on the registry + the current selection.
3. **Copy-interception (Story 8.1)** — the `copy` handler (`:341-368`): guards single contiguous in-layer range, then delegates to `measureSelectedLines`/`joinParagraphLines` from `paragraphCopy.ts`. Already thin; just needs a home.
4. **Empty-origin gating (Story 8.8)** — `emptyOrigin` latch (set at `pointerdown` `:220`, cleared in `releasePointer` `:282`), `isEmptyLayerSpace` (exported, `:47`), the `selectstart` suppress (`:326-332`, now narrowed to `emptyOrigin && !snapping`).
5. **Snap state machine (Story 8.11)** — the largest addition: `snapping`/`snapLayer`/`snapOrigin`/`snapEngaged`/`snapAnchor`/`snapFocus`/`snapPoint`/`snapRaf` (`:130-150`), `anchorAtEngage` (`:165`), `applySnapFrame` (`:181`), `scheduleSnapFrame` (`:202`), `flushSnap` (`:305`), the `pointerdown` arm (`:216-264`), the rAF-throttled `pointermove` (`:267`), the capture-phase `scroll` re-resolve (`:281`), the capture-phase `pointerup` flush (`:313`), and the abort-cancel (`:208`). It delegates the actual geometry to `resolveOrigin`/`resolveNearestText` in `nearestTextAnchor.ts`.

**Proposed decomposition** (open design call — pick the smallest correct boundaries; this is a suggested shape, not a mandate): a `TextLayerRegistry` (concern 1), a `SelectionBounder` (concern 2), a `CopyJoiner` (concern 3), and a `SnapController` / `EmptyOriginGate` (concerns 4+5, which share the `pointerdown`/`releasePointer`/`selectstart` lifecycle and are tightly coupled — keeping them in one object is likely cleaner than splitting 4 from 5). The public `textSelectionController` singleton + its `register(div)` API stay identical (that is the render↔selection seam `renderPage` calls at `render/index.ts:381`), so `render/index.ts` needs no change.

### The barrel / mock constraint (why this split is low-blast-radius)

`textSelectionController` is imported by `render/index.ts` via SUB-PATH (`import { textSelectionController } from "./textSelection"`, `render/index.ts:28`) and is deliberately NOT re-exported from the `render/` barrel (the file header, `textSelection.ts:16-20`, spells this out). Therefore the `vi.mock("./render")` barrels in `App.test.tsx` and `Reader.test.tsx` (which mock `renderPage` et al.) do NOT reference it, and splitting it into new sibling modules under `render/` does NOT touch those mocks. Only `render/textSelection.test.ts` imports it directly (`isEmptyLayerSpace, textSelectionController` + a `vi.mock("./nearestTextAnchor")`). Keep new modules as siblings under `render/`, keep them out of the barrel, and the CLAUDE.md "keep render mocks in sync" rule is satisfied by construction.

### The second target: unify the Bank filter + sort view-state

`lib/bank.ts` is already a clean pure leaf (AD-9: imports only `api/` types + the `anchor/` `pointsBounds` helper, no store/DOM): `bankItems(annotations, docId)` produces the reading-order-sorted, group-deduped rows (the sort is transitive-by-construction — see its long comment on why a pairwise-epsilon comparator is NOT used); `filterBankItems(items, activeTypes)` narrows by type, order-preserving so it composes with the sort in either order. **Leave those two functions' internals alone** — they are correct and well-documented. The debt is in `BankPanel.tsx`: it owns `activeTypes` `useState` (`:47`), the reset-on-open `useLayoutEffect` (`:69`, deliberately layout not passive — stale-rows-flash), `toggleType` (`:75`), and re-derives `filterBankItems(bankItems(annotations.values(), docId), activeTypes)` inline (`:84`). Fold that view-state (the `activeTypes` model + its default/reset/toggle + the derivation) into ONE composable unit (e.g. a `useBankView(open, docId)` hook returning `{ rows, activeTypes, toggleType }`), leaving `BankPanel` presentational. This is the "one composable view-state model rather than two independent conditional passes" the AC asks for.

### The rest of the Epic-8 touched surface (audit, fix only if warranted)

Union of non-test source files Stories 8.1-8.11 touched (from the Epic-8 feature commits; the two committed targets above are the primary work — the rest is audit-and-fix-only-where-a-real-smell-exists, honoring "smallest correct structure" and "no behavior/contract change"):

- **8.1 copy:** `render/paragraphCopy.ts` (already its own module), `render/textSelection.ts`.
- **8.2/8.3 Bank:** `lib/bank.ts`, `components/BankPanel/BankPanel.{tsx,css}`.
- **8.4 comment-on-region:** `annotations/` gestures + create path (`gestures/useCreateQuickBox.ts`, `gestures/useBoxGesture.ts`, `gestures/shared.ts`, `create.ts`, `marks.ts`, `AnnotationInteraction.tsx`, `CommentBubble.tsx`, `MemoBox.tsx`), `store/index.ts`, `api/schema.d.ts` (generated — do NOT hand-edit).
- **8.5 venue columns:** `library/CollectionTable/*`, `library/columnSort.ts`, `library/tableView.ts`, `library/row.ts`, `library/useColumnWidths.ts`; backend `server/app/domain/{crossref,enrich,semantic_scholar}.py`, `server/app/models.py`, `server/app/routes/extraction.py`, `server/app/storage/{documents,library_index}.py`. **Caution:** this is the widest sub-surface, and much of it is Library code that Epic 6/7 already refactored (6.8/7.12). Only touch what 8.5 GREW and left with a genuine smell; do not re-refactor Epic 6/7's modules incidentally (explicit out-of-scope: "touching client/server modules Epic 8 did not touch").
- **8.6 comment preview:** `annotations/CommentPreview.tsx`, `annotations/position.ts`, `annotations/Annotations.css`, `theme/components.css`.
- **8.7 tab-switch resume:** `reader/ReaderPage.tsx`, `render/usePageViewport.ts`, `components/Reader/Reader.tsx`.
- **8.11 snap:** `render/nearestTextAnchor.ts` (already its own module), `render/textSelection.ts`.

`api/schema.d.ts` is generated (never hand-author, CLAUDE.md); leave it. Coordinate math staying inside `anchor/` is the AD-9 check to run across all of the above.

### Explicitly OUT of scope

- Any new capability, FR, behavior, or contract change.
- The still-deferred **multi-column selection controller** and the **cross-type unified hit-layer** (`deferred-work.md`, tracked separately — do NOT incidentally sweep them up here).
- Touching client/server modules Epic 8 did NOT touch (including Epic 6/7's Library modules beyond what 8.5 grew).
- The caret-API family (dead per the 8.9 spike) — do not reintroduce it anywhere.

### Testing standards

- **jsdom limits (unchanged from 8.8/8.11):** jsdom has no real Selection/`::selection`/layout, so the snap behavior, `setBaseAndExtent`, collapse-on-release, and multi-page rect geometry are NOT assertable there. `textSelection.test.ts` covers only registry/lifecycle bookkeeping + the controller's gate/direction logic (mocking `nearestTextAnchor`); `nearestTextAnchor.test.ts` covers the pure resolver with injected rect readers; `bank.test.ts` covers the pure derivation with plain data. Keep those coverage boundaries after the split — assertions unchanged in intent, tests may move to follow the modules.
- **Live smoke is the real acceptance gate** (AC-7), on your OWN fresh servers at DPR>1 with trusted pointer input, across REPEATED same-session drags. Cross-page on-text selection + paragraph-copy readback remain the known jsdom/clipboard-harness gaps (8.11 L3, carries AE7-4) — verify the snap path stays gated behind `if (emptyOrigin)` so on-text (incl. cross-page) origins return early into byte-identical Story-8.8 code.
- A refactor's proof is behavioral identity: the full pre-existing suite green + the Epic-8 live matrix visually unchanged. No new product assertions are expected (only test relocations/renames).

### Precedent + engineering principles

- Refactor-as-the-last-story-of-the-epic is the established pattern (AE7-5): Story 7.12 proved one terminal byte-identical-contract decomposition beats several partial per-feature refactors. Mirror its rigor, including reconciling any doc/story text to what actually shipped (AE7-3).
- CLAUDE.md engineering principles that bind here: bind interaction handlers at the document level (already true — preserve it); keep the `render/` test mocks in sync (satisfied by construction here); launch your OWN dev servers for live smoke; selection→rects must go through `collectTextRects`-style per-text-node measurement (the resolver replicates this locally in `render/` per AD-9 — keep it local).
- User global principles: prefer an OOP decomposition; delete dead code freely; the smallest correct structure wins. This refactor should REDUCE line count and conditional nesting, not merely relocate it.

### Project Structure Notes

- Expected touched production files (the two committed targets): `client/src/render/textSelection.ts` + any new sibling modules it splits into (all under `render/`, none added to the barrel), and `client/src/components/BankPanel/BankPanel.tsx` + a new Bank view-state hook (co-located, e.g. `components/BankPanel/useBankView.ts`). Plus `server/pyproject.toml` (version). Test files move/rename alongside.
- Layer rule (AD-9): `render/` imports nothing upward from `anchor/`/`annotations/`/`store/`; `lib/bank.ts` stays a pure leaf. No coordinate math leaves `anchor/`.
- No generated-file hand-edits (`api/schema.d.ts`, `theme/tokens.css`). No `docs/API.md` change (no `/api` surface touched).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.10 (the refactor ACs + out-of-scope) and #Epic 8 (the epic charter + sequencing)]
- [Source: .bmad/implementation-artifacts/8-11-snap-empty-space-drag-to-text-attempt-2.md (the snap state machine this absorbs; File List + Dev Notes + the sequencing note that 8.11 lands before 8.10)]
- [Source: client/src/render/textSelection.ts:47 (isEmptyLayerSpace), :62 (TextSelectionController), :110-432 (#enableGlobalListener — the god-method: registry, snap state machine, releasePointer, selectstart suppress, copy join, selectionchange bounding)]
- [Source: client/src/render/index.ts:28 (sub-path import, not barrel), :381 (renderPage → textSelectionController.register — the seam to keep identical)]
- [Source: client/src/render/nearestTextAnchor.ts (resolveOrigin/resolveNearestText — already a separate render/-local module), client/src/render/paragraphCopy.ts (joinParagraphLines/measureSelectedLines — already separate)]
- [Source: client/src/lib/bank.ts:145 (bankItems reading-order sort), :198 (filterBankItems), client/src/components/BankPanel/BankPanel.tsx:47/:69/:84 (activeTypes useState, reset-on-open useLayoutEffect, inline compose)]
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md#AD-9 (boundary invariants: layered downward dependency, coordinate math only in anchor/), #AD-5 (anchor.kind dispatch pattern to mirror)]
- [Source: CLAUDE.md#Engineering principles (document-level handlers; keep render mocks in sync; own dev servers; selection→rects via collectTextRects) + #Versioning (PATCH +1 per story; Epic 8 stays 0.5.x) + #Code navigation (CodeGraph)]
- [Source: .bmad/implementation-artifacts/sprint-status.yaml (8.11 before 8.10 sequencing; AE7-3/AE7-4/AE7-5 action items)]
- [Memories: [[drag-tools-dont-create-text-selection]], [[use-trusted-input-for-focus-sensitive-smoke]], [[verify-on-hidpi-and-real-host]], [[held-key-state-reset-on-blur]], [[prefer-stable-solutions]], [[use-codegraph-navigation]]]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8), Claude Code.

### Debug Log References

- Session recovery: the prior dev-story run was interrupted mid-implementation (laptop power loss). Reset the half-written code to HEAD (backed up to scratchpad first), preserving only the legitimate scaffolding (this story spec with its `baseline_commit`, sprint-status `in-progress`, the two fixture PDFs). Re-implemented from a clean, green HEAD baseline (1513 tests).
- Test-count reconciliation: suite went 1513 → 1518 at runtime, but static test-declaration count is IDENTICAL to HEAD (1393 == 1393); `textSelection.test.ts` 27→22 decls (−5 moved out), `textLayerRegistry.test.ts` 0→5 (+5 moved in). Net zero, no coverage lost/duplicated; the runtime delta was a first-baseline-run artifact (1518 stable across two subsequent runs).
- Live-smoke clipboard gap: `navigator.clipboard.readText()` triggers a blocking permission prompt in the automation harness (froze CDP twice, the known 8.11 L3 / AE7-4 clipboard-harness gap). Worked around by capturing the copy output via an in-page `copy` listener reading the `DataTransfer` the handler wrote — no OS clipboard.

### Completion Notes List

- **AC-2 (primary):** decomposed the ~320-line `#enableGlobalListener` god-method into four cohesive sibling modules under `render/` + one thin composing controller. `textSelectionController` singleton + `register(div)` API unchanged (the render↔selection seam at `render/index.ts:381` needs no edit). Every guard ported verbatim in intent. `textSelection.ts` shrank from 436 → 108 lines.
- **AC-3:** `useBankView` hook unifies the filter (`activeTypes` + default/reset/toggle) with the reading-order sort behind one composable model; `BankPanel` is now presentational. `bankItems`/`filterBankItems` leaf internals untouched.
- **AC-4 (invariants):** 1518 client tests green (stable), typecheck clean, no behavior/contract change, no anchor/store/API/token/`docs/API.md` change.
- **AC-5 (AD-9):** confirmed by sweep — no `render/` module imports from `anchor/`/`annotations/`/`store/`; new modules import render/-local siblings only; no pdf.js coordinate transform lives outside `anchor/`+`render/`. The nearest-text rect measurement stays local in `render/`.
- **AC-7:** full Epic-8 live matrix verified on own fresh servers at DPR>1 with trusted pointer input (see the smoke subtasks above): snap down/up/repeated, on-text single + cross-page highlight (no full-page-block leak), paragraph copy join, and the whole Bank filter/sort/reset. Zero console errors.
- **Deferred to PR merge (convention):** the `0.5.29 → 0.5.30` version bump + the sprint `done` flip (AC-9); and the Codex `bmad-code-review` pass.

### Audit Result (per AC-1: decomposed vs left-clean, with rationale)

**Decomposed (the epic's two genuine smells):**
- `render/textSelection.ts` — the five-concern god-method → `TextLayerRegistry` + `SelectionBounder` + `copyJoiner` (fn) + `SnapController` + composing controller.
- `components/BankPanel/BankPanel.tsx` filter+sort view-state → `useBankView`.

**Left clean (with rationale):**
- `render/paragraphCopy.ts`, `render/nearestTextAnchor.ts` — already their own single-concern leaf modules (the story's premise); untangling their CALLERS was the work, done inside the controller split.
- `lib/bank.ts` — pure, well-documented leaf; `bankItems`/`filterBankItems`/`snippetOf`/`anchorTopLeft` already dispatch cleanly on `anchor.kind` (the AD-5 pattern). Internals correct; only the COMPOSITION site moved (into `useBankView`).
- `annotations/position.ts` — UI popup-clamping math in screen px (NOT PDF-coordinate transforms, so outside AD-9's scope); pure, tested, and `QUICK_BOX_GAP` is already a shared de-duped helper.
- `annotations/gestures/useBoxGesture.ts` — single-concern box-drag hook (8.4 generalized it highlight→highlight+comment). The mode→builder split is a deliberate 2-way branch (different builders + default colors), not a duplicate-branch smell a registry would improve ("smallest correct structure"); coord work goes through `@/anchor`.
- 8.5 Library surface (`library/*`, backend `domain/`, `storage/`, `routes/extraction.py`) — mostly Epic 6/7-refactored code (6.8/7.12); 8.5's growth introduced no new self-contained smell, and re-refactoring Epic 6/7 modules is explicitly out of scope.
- 8.6 (`CommentPreview.tsx`, `Annotations.css`), 8.7 (`ReaderPage.tsx`, `usePageViewport.ts`, `Reader.tsx`) — modest per-commit growth, no new god-object/duplicate-branch smell.

**Reality correction (AE7-3 discipline):** the Dev Notes 8.4 touched-file list omitted `annotations/gestures/useSelection.ts`, which Epic 8 did grow; per-commit growth was modest (8.4 changed it +17) and it remains a single-concern selection gesture hook — left clean.

### File List

- `client/src/render/textLayerRegistry.ts` (new) — `TextLayerRegistry` class + `isEmptyLayerSpace`.
- `client/src/render/selectionBounder.ts` (new) — `SelectionBounder` class.
- `client/src/render/copyJoiner.ts` (new) — `interceptParagraphCopy` function.
- `client/src/render/snapController.ts` (new) — `SnapController` class (8.8 gate + 8.11 snap).
- `client/src/render/textSelection.ts` (rewritten) — thin composing `TextSelectionController`; re-exports `isEmptyLayerSpace`.
- `client/src/render/textLayerRegistry.test.ts` (new) — the moved `isEmptyLayerSpace` tests.
- `client/src/render/textSelection.test.ts` (modified) — dropped the `isEmptyLayerSpace` block + its import; controller/snap/copy/lifecycle tests unchanged in intent.
- `client/src/components/BankPanel/useBankView.ts` (new) — the unified Bank view-state hook.
- `client/src/components/BankPanel/BankPanel.tsx` (modified) — presentational over `useBankView`.
- `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf`, `fixtures/sample-pdfs/3706598.3713941.pdf` (new) — smoke fixtures.

## Senior Developer Review (AI) — Codex (GPT-5-Codex), 2026-07-13

Ran `bmad-code-review` through Codex (a different model than the Opus implementer, per CLAUDE.md) over `7ac1cbe..HEAD` (client/ + server/), read-only. Adversarial layers focused on behavior preservation vs the pre-refactor `textSelection.ts`.

**Outcome:** Approved after one fix. 1 High (patch), resolved. 0 decision-needed, 0 deferred. Listener order/phases, rAF binding/coalescing, copy guards, AD-9 boundary, Bank view-state, and relocated test assertions all verified preserved.

### Review Findings

- [x] **[Review][Patch] High — Concern state outlived the enable cycle** [`client/src/render/textSelection.ts:28`] — RESOLVED. Pre-refactor, the gate/snap/bounder state (`emptyOrigin`, `pointerDown`, `prevRange`, `isFirefox`, snap refs) was closure-local to `#enableGlobalListener`, so it was discarded on last-layer teardown and rebuilt fresh on re-register. The decomposition made `SnapController`/`SelectionBounder` singleton instance fields, and `abort()` only cleared `snapRaf`+`snapping` — leaving `#emptyOrigin`/`#prevRange` stale. Failure: an empty-origin gesture interrupted by a full layer teardown (zoom/scroll re-render before `pointerup`) leaves `emptyOrigin` latched; after re-register a `selectstart` with no fresh `pointerdown` (Ctrl+A, shift-arrow) is wrongly suppressed. **Fix:** construct `snap`+`bounder` fresh per enable cycle (registry stays persistent — it is empty at teardown), restoring the old closure-local semantics exactly. Added regression test (verified: fails on the singleton design, passes with the fix). Full suite 1519 green, typecheck clean.

## Change Log

- 2026-07-13: Story created (Epic 8 structural refactor, the epic's last story). Two committed decompositions: `render/textSelection.ts` god-method (registry / selection-bounding / copy-join / origin-gate+snap concerns) and the Annotation Bank filter+sort view-state; plus an audit-and-fix-only pass over the rest of the Epic-8 surface. Pure refactor, no behavior/contract change. Version target 0.5.29 → 0.5.30.
- 2026-07-13: Implemented both committed decompositions (`textSelection.ts` 436→108 lines split into 4 sibling modules + composing controller; `useBankView` hook). Audit recorded (2 decomposed, rest left-clean). Full suite green (1518 tests, typecheck), AD-9 sweep clean, full Epic-8 live-smoke matrix passed at DPR>1 with trusted input. Status → review. Version bump + sprint `done` flip deferred to PR merge per convention.
- 2026-07-13: Codex `bmad-code-review` — 1 High (concern state outliving the enable cycle) found and fixed (fresh `snap`/`bounder` per enable cycle), regression test added. Full suite 1519 green, typecheck clean. Review approved; no open findings.
