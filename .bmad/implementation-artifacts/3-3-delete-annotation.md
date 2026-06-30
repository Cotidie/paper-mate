---
baseline_commit: 969abfef092eedf011ea873594305d31ac6ff50f
---

# Story 3.3: Delete annotation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to delete a mark,
so that I can remove ones I no longer want.

> **The polish / AC pass, not a rebuild.** Story 2.5 built the client delete seed (`deleteAnnotation` in the store, group-aware) and wired `Del`/`Backspace` + a quick-box Trash button in `useSelection`. Story 3.1 made `deleteAnnotation` part of the one command surface (AD-7). Story 3.2 wrapped that surface with `zundo`, so a delete is ALREADY undoable for free (the store builds a new `annotations` Map; zundo records it; undo restores the exact prior Map including every group sibling). So the store/command plumbing for this story is DONE. What remains is: (a) a faithful AC pass confirming delete works through the path from every affordance and undoes exactly, and (b) one deliberate behavior change requested for this story (below).
>
> **The requested deviation from `epics.md` (read first).** The epic AC and UX-DR14/DR15 list the delete key as `Del`/`Backspace`. For this story we support **`Del` ONLY**. `Backspace` is dropped as a delete trigger because it is a high-frequency text-editing key (cursor-back / delete-char): a user editing a memo or comment body, or with a stray selection, can hit `Backspace` expecting text behavior and instead destroy a whole annotation. `Del` is the unambiguous "remove this object" key. This narrows an existing behavior; it is not additive. (The Trash buttons already advertise "Delete (Del)" only, so the UI copy is already consistent with Del-only.)
>
> **Scope boundary.** This story changes ONLY the delete trigger surface (drop the `Backspace` branch + its tests/docs) and adds the AC-pass coverage. It does NOT add: the dirty flag / autosave (3.4), hydrate-on-open (3.5), the Annotation Bank (3.6), convert (3.7), range-adjust (3.8), or any store/contract change. `deleteAnnotation` in `store/index.ts` is NOT modified.

## Acceptance Criteria

> Faithful to `epics.md` Story 3.3, restated self-contained, with the `Del`-only deviation made explicit. The dev needs only this file.

1. **`Del` deletes the selected mark via the command path.** Given a selected annotation, when I press `Del` (the `Delete` key), it is removed through the single client command surface (`store.deleteAnnotation`) and leaves the canvas. Document-level, phase-gated (`phase === "ready"`), and exempt when an editable field or button has focus (so `Del` inside a memo/comment textarea is native text behavior, never an annotation delete) and on any modifier chord (`Ctrl`/`Alt`/`Meta`). (FR-17, AR-7, UX-DR15, AP-1)

2. **`Backspace` does NOT delete an annotation (the deviation).** Given a selected annotation, when I press `Backspace`, the annotation is NOT removed. `Backspace` is left entirely to the browser / text fields so it stays safe for text editing. This is the one intentional narrowing versus the epic's `Del`/`Backspace`. (Deviation, this story)

3. **Delete is undoable and restores exactly.** Given a deleted annotation, when I press `Ctrl Z`, it is restored exactly (same id, anchor, style, body, and all `group_id` siblings), because delete already flows through the zundo-wrapped command surface from Story 3.2. Redo re-deletes. (FR-17, AR-7)

4. **Delete is group-aware.** Given a multi-mark (grouped) annotation, for example a two-page highlight sharing one `group_id`, when I delete it, every sibling is removed together as ONE undoable step, and one undo restores all of them. (AR-4; already implemented in `store.deleteAnnotation`, this AC only asserts it.)

5. **Every delete affordance routes through the same path.** The `Del` key (selected mark), the selection quick-box Trash button (`deleteSelected`), and the comment bubble Trash button all call `store.deleteAnnotation`, so all three are group-aware, clear the selection, and are undoable. No affordance mutates the annotation set outside the command path. (AR-7, AD-7)

6. **Selection is reconciled on delete.** Deleting the selected mark clears `selectedId` (the store already nulls it when the deleted id was selected), so no stale selection ring or quick-box lingers. After a delete-then-undo that restores the mark, it returns un-selected (selection is not part of the undoable partialize; AC-5 of 3.2). (AD-12)

7. **Contract + anchor-model neutrality.** No contract change and no store-shape change: `server/openapi.json` and `client/src/api/schema.d.ts` stay byte-identical (`git diff --stat` empty on both), and `store/index.ts` `deleteAnnotation` is unchanged. This story edits only the trigger surface in `annotations/` plus tests/docs. (AR-3, AR-5, AR-9)

## Tasks / Subtasks

- [ ] **Task 1: Make delete `Del`-only (AC: #1, #2).**
  - [ ] In `client/src/annotations/gestures/useSelection.ts`, the selection key handler (the `useEffect` gated on `enabled && selectedAnno`): change the delete branch from `if (e.key === "Delete" || e.key === "Backspace")` to `if (e.key === "Delete")` only. Keep the existing guards intact (the handler already early-returns on `e.ctrlKey || e.altKey || e.metaKey || isExempt(e.target)` before this branch, and `Esc` clears the selection). `Backspace` now falls through to no annotation action.
  - [ ] Keep `e.preventDefault()` on the handled `Del` so a stray `Del` does not also do anything browser-side; leave `Backspace` un-prevented (it must reach text fields normally; the `isExempt` early-return already lets a focused textarea handle its own keys).
  - [ ] Confirm the Trash tooltips still read "Delete (Del)" (`CommentBubble.tsx:112`, `AnnotationInteraction.tsx:631`) so UI copy matches; they already do, so no copy change is expected. (No em-dash in any UI string; these use parentheses already.)

- [ ] **Task 2: Update tests for the Del-only behavior (AC: #1, #2, #3, #4).**
  - [ ] In `client/src/annotations/AnnotationInteraction.test.tsx`, INVERT the existing test at ~line 904 ("Backspace also deletes the selected mark"): rename it to assert `Backspace` does NOT delete (the mark is still present after a `Backspace` keydown on `document`). Keep the `Delete`-key delete test (~line 897) passing.
  - [ ] Add a regression test: `Del` deletes, then a `Ctrl Z` (via the `useUndoRedo` path, or assert through `useAnnotationStore.temporal.getState().undo()` at the store level) restores the mark exactly. The store-level undo assertion is the deterministic one (jsdom-safe); a component-level `Ctrl Z` test is optional on top.
  - [ ] Add (or confirm) a grouped-delete test: two annotations sharing a `group_id`, delete one, both gone; one undo restores both. This can live in `store/index.test.ts` (deterministic, no geometry) since `deleteAnnotation` is the group-aware unit.
  - [ ] Verify the `Ctrl`-chord-`Delete`-is-a-no-op test (~line 960) and the `isExempt` textarea test (~line 946) still pass unchanged (the modifier and editable guards are untouched).

- [ ] **Task 3: Docs + version + close-out (AC: #7).**
  - [ ] Update `client/src/annotations/README.md` (the `useSelection` bullet around line 91) to say `Del` deletes (drop the `Backspace` mention), noting the deliberate narrowing so a future reader does not "fix" it back.
  - [ ] Bump `server/pyproject.toml` `[project].version` `0.2.4 -> 0.2.5` (single source -> `app/version.py` -> `GET /api/health` -> top-bar badge; bump once at PR merge, not per commit). Sync `server/uv.lock` if needed. No `/api` change, so `docs/API.md`, `server/openapi.json`, and `client/src/api/schema.d.ts` stay byte-identical (`git diff --stat` empty on the contract files).
  - [ ] Keep the `render/` mock barrels in sync ONLY if a new `render/` export is added; this story adds none, so `vi.mock("./render")` in `App.test.tsx` / `Reader.test.tsx` is untouched (confirm).
  - [ ] Cross-model Codex review (AE-6) on the diff (`969abfe..HEAD`); resolve High/Med before done. (AE-7 sandbox-pytest workaround: `UV_CACHE_DIR=/tmp/uv-cache`; backend is untouched, so the frontend suite is the gate.)
  - [ ] **Live smoke on your OWN fresh servers** (uvicorn + vite dev on alternate ports; never reuse the user's running server, per CLAUDE.md). Matrix: select a highlight / underline / pen / memo / comment, press `Del` -> it is removed; `Ctrl Z` -> restored exactly; press `Backspace` on a selected mark -> NOT removed; focus a memo textarea and press `Backspace` -> normal text editing, no annotation delete; the quick-box Trash and the comment-bubble Trash both delete + undo. **Cross-page (grouped) highlight at DPR >= 1.25: `Del` removes BOTH pages, one `Ctrl Z` restores BOTH** (the highest-risk path; jsdom cannot see cross-page geometry, memory `verify-on-hidpi-and-real-host`).

## Dev Notes

### Where this story sits (the command-path mental model)

AD-7: every annotation change (create, move, resize, restyle, retext, delete) flows through one path, a client command stack (do/undo) over the store, with no component mutating annotations outside it. Built across Epic 3:

- **2.5 (done)** seeded a client-only delete (`deleteAnnotation`) + the `Del`/`Backspace` keys + Trash button.
- **3.1 (done)** folded `deleteAnnotation` into the one mutation surface (the convergence audit).
- **3.2 (done)** wrapped that surface with `zundo`, so delete became undoable for free.
- **3.3 (this story)** is the AC/polish pass plus the `Del`-only narrowing. NO store change.

So the store action does not change. The work is entirely on the trigger surface (one `||` branch in `useSelection`) plus tests and docs.

### What already exists, do NOT rebuild

- **`client/src/store/index.ts:224` `deleteAnnotation(id)`** is the unit. It: looks up the target (returns the SAME `state` on an unknown id, so a no-op pushes no zundo history); gathers the id plus every sibling sharing a non-null `group_id` (AR-4); builds a NEW `annotations` Map without them; and nulls `selectedId` if the deleted set contained it. New-Map-on-change + same-state-on-no-op is exactly what makes zundo record a real delete as one step and skip a no-op. Do not touch it.
- **`client/src/annotations/gestures/useSelection.ts`** owns: `deleteSelected` (the quick-box Trash callback, line ~171, calls `deleteAnnotation(selectedAnno.id)`); the selection key handler (line ~177) whose guard order is `e.ctrlKey || e.altKey || e.metaKey || isExempt(e.target)` early-return, then `Escape` clears selection, then the `Delete`/`Backspace` delete branch (line ~188, the ONE line to change); and the empty-space-deselect pointerdown. This is the single file with a code change.
- **`client/src/annotations/AnnotationLayer.tsx:367`** renders the comment bubble's Trash -> `deleteAnnotation(a.id)`. Already on the path; no change.
- **`client/src/annotations/AnnotationInteraction.tsx:632`** renders the selection quick-box Trash -> `deleteSelected`. Already on the path; no change. (Tooltips at `:631` and `CommentBubble.tsx:112` already say "Delete (Del)".)
- **`useUndoRedo` (gestures/useUndoRedo.ts, Story 3.2)** already binds `Ctrl Z` / `Ctrl Shift Z` over the temporal store and reconciles `selectedId` after an undo. A restored delete rides this with no change.

### The Del-only change, precisely

The only production code edit is in `useSelection.ts`:

```ts
// before (2.5):
if (e.key === "Delete" || e.key === "Backspace") {
  e.preventDefault();
  deleteAnnotation(selectedAnno.id);
}
// after (3.3): Del only — Backspace is left to text editing.
if (e.key === "Delete") {
  e.preventDefault();
  deleteAnnotation(selectedAnno.id);
}
```

The surrounding guards already make this safe: the handler is only live while a current-doc mark is selected (`enabled && selectedAnno`), it early-returns on any modifier chord and on editable/button targets (`isExempt`), and a focused memo/comment textarea is exempt, so `Del` there does native text behavior. After this change, `Backspace` simply has no annotation effect at the document level.

### What must NOT change (guardrails)

- **No store / command-surface change.** `deleteAnnotation` stays byte-identical; this story does not re-implement delete or its grouping/undo (3.1/3.2 own those).
- **No contract or anchor-model change.** `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical. No backend touch.
- **No new feature.** No autosave (3.4), persistence (3.5), Bank (3.6), convert (3.7), range-adjust (3.8).
- **Preserve every Epic-2 / 3.1 / 3.2 interaction:** create-on-release, single-`activeTool` FSM, click-select / recolor / restyle, arm-time color, pen draw / restroke / alpha, memo place / empty-cleanup / corner-resize, comment pin / bubble / cross-page group, box region, drag-to-change-tool, the 3.1 edit-frame move/resize + double-click re-edit, and 3.2 undo/redo.
- **AP-1 document-level handlers**, phase-gated, editable/buttons exempt. **AD-9 layering** (no upward imports; the store imports `api/` types only).

### Project Structure Notes

The change is confined to `client/src/annotations/gestures/useSelection.ts` (one branch), its test in `AnnotationInteraction.test.tsx`, an optional grouped-delete test in `store/index.test.ts`, and `client/src/annotations/README.md`. No new file, no new layer, no `anchor/` / `api/` / server change.

### Testing standards

- Frontend Vitest + jsdom: run from `client/` (`npm test`); `npx vitest` from `src/` fails with `document is not defined`. jsdom zeroes `getClientRects`, so any geometry uses the existing fake-card + injected `rectReader` pattern, but delete/undo logic is store-level and fully deterministic in jsdom: push grouped-delete + delete-undo coverage into `store/index.test.ts`.
- The temporal store is reachable via `useAnnotationStore.temporal.getState()`; reset it in `beforeEach` (`temporal.getState().clear()` + reset the main store) so history does not leak across cases.
- Backend pytest: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (expect green; no backend change this story).
- **DPR >= 1.25 cross-page live smoke is mandatory** for the grouped delete + single-undo (jsdom cannot see cross-page geometry; memory `verify-on-hidpi-and-real-host`), on your OWN fresh servers (CLAUDE.md: never reuse the user's running server).
- Cross-model Codex review on the diff (AE-6).

### Versioning

PATCH +1 when 3.3 reaches done: `0.2.4 -> 0.2.5`. Single source `server/pyproject.toml [project].version` -> `app/version.py` -> `GET /api/health` -> top-bar badge. Bump once at PR merge, not per commit.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-3.3] the 2 ACs (`Del`/`Backspace` removes via the command path and leaves the canvas; undo restores exactly). FR-17, AR-7, UX-DR15. This story deviates to `Del`-only per the user request; see ACs #1-#2.
- [Source: .bmad/planning-artifacts/epics.md#UX-DR14] / #UX-DR15 the keyboard map lists `Del`/`Backspace` delete; this story narrows to `Del`.
- [Source: .bmad/planning-artifacts/epics.md#Story-2.5] the click-select + client delete seed this story polishes ("this delete path is the seed Epic 3's Story 3.3 reuses").
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md#AD-7] the one command path; "no component mutates annotations outside the command path." #AD-12 selection decoupled from the command stack. #AD-9 layering. The AR-4 group rule (siblings act together). The AR-7 row (annotation mutation only via the client command stack).
- [Source: .bmad/implementation-artifacts/3-2-undo-redo.md] 3.2 made delete undoable: "`Del`/`Backspace` delete already exists (Story 2.5 seam, wired in `useSelection`); 3.2 only makes it UNDOABLE ... that is Story 3.3's polish." The zundo wrap, partialize (selection excluded), and one-edit-one-step rules the restored delete rides.
- [Source: client/src/store/index.ts:224] `deleteAnnotation` (group-aware, no-op returns `state`, nulls `selectedId`). [client/src/annotations/gestures/useSelection.ts:188] the `Delete`/`Backspace` branch to narrow + `deleteSelected` (Trash). [client/src/annotations/AnnotationLayer.tsx:367] comment-bubble Trash. [client/src/annotations/AnnotationInteraction.tsx:632] quick-box Trash. [client/src/annotations/AnnotationInteraction.test.tsx:904] the "Backspace also deletes" test to invert.
- [Source: CLAUDE.md] AP-1 document-level handlers (phase-gated, editable/buttons exempt); no em-dash in user-facing strings; AD-2 pinned deps; versioning; "launch your OWN dev servers for live smoke"; AE-6 Codex review; AE-7 sandbox-pytest workaround.
- Memories: `verify-on-hidpi-and-real-host` (cross-page grouped delete + undo at DPR > 1), `held-key-state-reset-on-blur` (N/A for a discrete `Del`, but keep the handler clean), `prefer-stable-solutions` (no rebuild; reuse the existing path).

## Open Questions

> Each has a recommended default so work is not blocked.

1. **Drop `Backspace` entirely, or keep it only when NOT in a text field?** Recommended default (this story's premise): drop `Backspace` as a delete trigger entirely, so it is never surprising. The `isExempt` guard already shields text fields, but a stray `Backspace` outside a field with a mark selected would still delete under the old code; Del-only removes that footgun. Confirm; if the PO wants `Backspace` retained outside text fields, scope it back in behind the existing `isExempt` guard.
2. **Any non-keyboard delete affordance to add (for example a context-menu "Delete")?** Recommended default: no, out of scope; the `Del` key + the two Trash buttons cover it. Revisit if UX asks.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
