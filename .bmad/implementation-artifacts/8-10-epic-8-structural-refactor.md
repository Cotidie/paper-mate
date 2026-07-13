---
baseline_commit: 7ac1cbe7c90d578b7ce04633ab4b8a2867b0d14c
---

# Story 8.10: Epic 8 structural refactor

Status: in-progress

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

- [ ] **Audit the Epic-8 surface** (AC: 1)
  - [ ] Read every file in the Dev Notes touched-file list against the `baseline_commit`; classify each: decompose / leave-clean.
  - [ ] Record the classification + rationale in the Dev Agent Record (mirrors 7.12's "reality-corrections" discipline: state what was and wasn't touched).

- [ ] **Decompose `render/textSelection.ts`** (AC: 2, 4, 5)
  - [ ] Read `textSelection.ts` fully (436 lines) + its test (504 lines) + `render/index.ts` before editing. Confirm the barrel/mock constraint (below): `textSelectionController` is imported by `render/index.ts` via SUB-PATH (`./textSelection`, line 28), NOT re-exported from the `render/` barrel, so `renderPage` mock barrels (`App.test.tsx`, `Reader.test.tsx`) do NOT reference it and the split won't break them. Only `render/textSelection.test.ts` targets it directly.
  - [ ] Split the five tangled concerns into cohesive units with narrow interfaces (proposed shape in Dev Notes; the exact module boundaries are an open design call — pick the smallest correct decomposition):
    - a **text-layer registry** owning the `#textLayers` map + `register`/`unregister`/`originLayerOf`/`#rangeStaysWithinTextLayers`/`reset`;
    - a **selection-bounder** (Story 4.1): the `selectionchange` `endOfContent` bounding + Firefox detection + `prevRange`;
    - a **copy-joiner** (Story 8.1): the `copy` handler, delegating to `paragraphCopy.ts`;
    - an **origin-gate / snap controller** (Story 8.8 + 8.11): the `emptyOrigin` latch, `selectstart` suppress, and the whole `snap*` state machine (rAF throttle, `applySnapFrame`/`scheduleSnapFrame`/`flushSnap`/`anchorAtEngage`), delegating anchor resolution to `nearestTextAnchor.ts`;
    - one **composing controller** that owns the single shared `document`-level `AbortController` lifecycle (enable-on-first-register, tear-down-on-last-unregister) and wires the concern objects to the listeners.
  - [ ] Preserve every guard verbatim in intent: the shared `{ signal }` teardown; the `snapping`/`emptyOrigin` clears on `pointerup`/`pointercancel`/window `blur`; the capture-phase `pointerup` flush BEFORE the bubble-phase `useCreateQuickBox` consumer; the rAF cancel on abort; the `isConnected` bail on a mid-drag layer unregister; the primary-button-only arm; the in-code comment recording the deliberate crossing of 8.9's per-move guard.
  - [ ] Keep `textSelection.test.ts` assertions unchanged in intent; tests may move/rename to follow the new modules.

- [ ] **Unify the Annotation Bank view-state** (AC: 3, 4)
  - [ ] Read `lib/bank.ts` (200), `components/BankPanel/BankPanel.tsx` (174), `lib/bank.test.ts` (407).
  - [ ] Fold filter + sort into one composable view-state unit (a `useBankView` hook or an equivalent model) that owns `activeTypes` (default = comments-only, reset on the open transition), `toggleType`, and the derivation `filterBankItems(bankItems(...))`, so `BankPanel` renders over that model rather than re-composing the two passes inline. Keep `bankItems`/`filterBankItems` as pure leaf functions (they already are — the change is where they COMPOSE, not their internals).
  - [ ] Preserve the reset-on-open `useLayoutEffect` semantics (not `useEffect` — the header comment explains the stale-rows-flash reason).

- [ ] **Opportunistic cleanup of the remaining audit targets** (AC: 1, 4) — only where a real smell exists; a byte-clean file is left alone.

- [ ] **Regression protection + full-suite green** (AC: 4)
  - [ ] `cd client && npm test` all green; `npm run typecheck` clean.
  - [ ] Backend suite green (run it yourself per the CLAUDE.md Sandbox note): `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` — only if a `server/app/**` file was actually touched by the refactor.
  - [ ] If any `render/index.ts` export changed, update BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (CLAUDE.md engineering principle). Expected: no barrel change, since `textSelectionController` is not a barrel export.

- [ ] **Live-smoke the Epic-8 matrix (own servers, DPR>1, trusted input, repeated same-session)** (AC: 7)
  - [ ] Launch your OWN fresh `uvicorn` (:8000) + `vite dev` (:5173) bound to your working tree — never reuse a user-launched/Docker server (CLAUDE.md). Fixture: `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf` (two-column, the 8.8/8.11 smoke fixture).
  - [ ] Snap: empty right-margin drag DOWN and UP snaps from the nearest line; repeated same-session (the caret lesson); no cross-column / full-page leak on a cross-column gutter drag (verify rect widths via `/api/docs/{id}/annotations`, as 8.11 did).
  - [ ] On-text single-line, multi-line, and CROSS-PAGE drags still select + highlight; paragraph copy still joins soft-wrapped lines.
  - [ ] Bank: comments-only default on open, toggle chips filter, rows in reading order, filter+sort compose.
  - [ ] Spot-check 8.4 (comment on a boxed region), 8.5 (venue short/full), 8.6 (comment preview size), 8.7 (tab-switch resume) are visually unchanged. Shut the servers down after.

- [ ] **Version bump + sprint status** (AC: 9)
  - [ ] `0.5.29 → 0.5.30` in `server/pyproject.toml` (verify `uv.lock` stays consistent — `server/tests/test_version.py` asserts it). Flip `8-10-epic-8-structural-refactor` to `done` in `sprint-status.yaml` at PR merge.

- [ ] **Codex code review** — run `bmad-code-review` through Codex after dev-story (CLAUDE.md), resolve High/Med before done.

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### Audit Result (per AC-1: decomposed vs left-clean, with rationale)

### File List

## Change Log

- 2026-07-13: Story created (Epic 8 structural refactor, the epic's last story). Two committed decompositions: `render/textSelection.ts` god-method (registry / selection-bounding / copy-join / origin-gate+snap concerns) and the Annotation Bank filter+sort view-state; plus an audit-and-fix-only pass over the rest of the Epic-8 surface. Pure refactor, no behavior/contract change. Version target 0.5.29 → 0.5.30.
