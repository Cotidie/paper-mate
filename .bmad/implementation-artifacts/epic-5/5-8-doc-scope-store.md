---
baseline_commit: 8d431acc632558c5825aef71055279571bfbaef8
---

# Story 5.8: Doc-scope the annotation store (retire the cross-doc autosave guard)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the annotation store to own `(docId, annotations)` as one atomic unit,
so that a doc switch swaps both together and autosave can bind to the store's own `docId` instead of a defensive generation-counter guard.

> Correct-course 2026-07-02 (`sprint-change-proposal-2026-07-02.md`), closing action items **AE-4 / AE3-3**. Today the store holds `annotations` without owning which doc they belong to, so `useAutosave` leans on a `generationRef` counter to stop one doc's marks flushing onto another across a doc switch (the Story 3.4 HIGH Codex finding). Make ownership atomic instead. This is a **client-only developer refactor**: no new FR, no backend change, no API-contract change.

## Acceptance Criteria

1. **AC-1: Atomic ownership.** The store owns `(docId, annotations)` atomically. Opening or switching a doc sets both in ONE store update (hydrate-on-open replaces both together). There is no window where `annotations` belong to one doc while `docId` reads another. (AR-6)
2. **AC-2: Autosave binds to `store.docId`.** A flush targets the doc the store currently owns: the PUT's target doc-id AND its snapshot are both read live from the store at flush time, so they are always a consistent (doc, its-own-marks) pair. `useAutosave` no longer takes a `docId` parameter. (AR-6, AR-7)
3. **AC-3: `generationRef` deleted.** The `useAutosave` `generationRef` cross-doc guard (and its three `.then`/`.catch`/`.finally` staleness checks) is **removed, not left as a redundant belt-and-braces check.** Single-flight is preserved by structure, not by a counter. (AR-7)
4. **AC-4: Single-flight preserved across a mid-flight switch.** No two PUTs are ever concurrently in flight. A PUT started for doc A that is still in flight when the store switches to doc B must NOT clear the in-flight flag while B's own PUT is genuinely in flight, and must NOT write A's marks to B. (AR-7, H6) This is the load-bearing invariant, see Dev Notes "Trap 1".
5. **AC-5: Hydrate-on-open still is the autosave baseline.** Opening a doc restores its saved marks and that restored set is NEVER PUT back (it is the autosave baseline, not a fresh change); `Ctrl+Z` immediately after open cannot remove restored marks (undo floor preserved). No regression to Story 3.5 AC-4. (AR-6, AR-7)
6. **AC-6: Behavior- and contract-identical.** `server/openapi.json` and `client/src/api/schema.d.ts` stay **byte-identical** (no backend/contract touch). Client + server test suites stay green (with the autosave/store tests updated to drive `docId` through the store, per Tasks). It is live-smoked across a doc open+reopen at DPR>1: open doc A, annotate, confirm saved, reopen doc B (see "Smoke plan" for how a switch is reached today), confirm A's marks never appear on B and B restores only its own. (AE-5, AR-6)

## Tasks / Subtasks

- [x] **Task 1: Store owns `(docId, annotations)` atomically (AC-1)**
  - [x] Add `docId: string | null` to the `AnnotationStore` interface (place it beside `annotations`, near the top of the interface). Initial value `null` in the store body (beside `annotations: new Map()` at `store/index.ts:317`).
  - [x] Replace the `hydrate(annotations)` action (declared at `store/index.ts:265`, implemented at `:489`) with `openDoc(docId: string, annotations: Annotation[])` that sets BOTH `docId` and `annotations` in the same `set()` and clears the same transient UI fields it clears today (`selectedId`, `multiSelectedIds`, `hoveredId`, `hidden`, `dragPreview`, `groupDragPreview`, `flashId`). One update, no torn window.
  - [x] Rename the free function `hydrateStore(annotations)` (`store/index.ts:532`) → `openDoc(docId, annotations)`: call the store action, then `useAnnotationStore.temporal.getState().clear()` (unchanged: the loaded set is the undo floor). Update its doc comment.
  - [x] Confirm `partialize` stays `(s) => ({ annotations: s.annotations })`, `docId` MUST be excluded from zundo (undo/redo must never revert which doc is open). No change needed, but verify.
  - [x] Update `store/README.md` and the store-header comment where they describe `hydrate`/`hydrateStore` to describe `openDoc` and the atomic `(docId, annotations)` ownership.
- [x] **Task 2: Autosave binds to `store.docId`, delete `generationRef` (AC-2, AC-3, AC-4)**
  - [x] Change `useAutosave` signature to take NO parameter: `useAutosave(): { status: SaveStatus }` (`hooks/useAutosave.ts:31`).
  - [x] Read `docId` from the store reactively: `const docId = useAnnotationStore((s) => s.docId)`. Keep `const annotations = useAnnotationStore((s) => s.annotations)`. The `if (!docId) return` no-op guard stays (now gating on `null`, not `""`).
  - [x] `flush` reads BOTH target and snapshot live from the store: `const { docId: target, all } = useAnnotationStore.getState();` then `putAnnotations(target, all())`. Drop the `forDocId` parameter (it becomes redundant with the live read).
  - [x] **Delete `generationRef`** (declaration at `:40`) and all three staleness checks in `.then`/`.catch`/`.finally` (`:66`, `:74`, `:79`), plus the `const gen = generationRef.current` capture (`:108`) and the `+= 1` bump in the cleanup (`:94`).
  - [x] In the docId-change effect (`:88`), **remove the `inFlightRef.current = false` reset** (`:91`) so a switch never strands an in-flight PUT (Trap 1). KEEP `mountedRef.current = false`, `dirtyRef.current = false`, `setStatus("idle")`, and `clearTimers()` in the cleanup. Update the effect's comment to explain the continuous-single-flight rationale (Dev Notes) instead of the generation bump.
  - [x] Verify the baseline gate (`mountedRef`, `:101`) still makes the FIRST annotations value under a new `docId` non-dirty (AC-5), and that later changes mark dirty + debounce.
- [x] **Task 3: Wire App to the doc-scoped store (AC-1, AC-2)**
  - [x] `App.tsx`: in `handleFile` (`:245`), replace `hydrateStore(restored)` (`:262`) with `openDoc(opened.doc_id, restored)`. Ordering stays: `uploadDoc → getAnnotations → openDoc(id, restored) → setDoc(opened)` (hydrate before `setDoc`, AC-5). Update the import (`:8`).
  - [x] `App.tsx`: change `const saveStatus = useAutosave(doc?.doc_id ?? "")` (`:120`) to `const saveStatus = useAutosave()`. App's `doc` React state stays for the VIEW only (filename, page_count, `BankPanel docId`, Reader, PDF url), autosave no longer reads it.
- [x] **Task 4: Update tests to drive `docId` through the store (AC-3, AC-4, AC-6)**
  - [x] `hooks/useAutosave.test.ts`: the hook no longer takes a param. Replace every `renderHook(({ docId }) => useAutosave(docId))` + `rerender({ docId })` (`:156`, `:179`) with `renderHook(() => useAutosave())` and switch docs by calling the store `openDoc(docId, [])` inside `act(...)`. The empty-`docId` test (`:171`) drives `openDoc("", ...)`/no-open.
  - [x] `hooks/useAutosave.test.ts:179`, the "stale in-flight PUT cannot corrupt the new doc" test is the pin for AC-4. Keep the SCENARIO (doc-A PUT held in flight, switch to doc-B via `openDoc`, add doc-B mark, resolve stale doc-A PUT, then a further doc-B change). Assert the NEW guarantee: exactly the PUTs `("doc-A", …)` then `("doc-B", …)` in order, the stale doc-A resolve fires NO extra PUT and does NOT let a second concurrent doc-B PUT start, and a doc-B change while B's PUT is genuinely in flight coalesces to one follow-up PUT. Re-derive expected call order under the continuous-single-flight model (Dev Notes), do NOT assume the old per-doc timing.
  - [x] `store/index.test.ts`: update `hydrate`/`hydrateStore` cases to `openDoc(docId, annotations)`; assert `docId` and `annotations` both land in one call and that `docId` is NOT reverted by an undo (`temporal.undo()`), and transient fields are cleared.
  - [x] `App.test.tsx`: the autosave-on-open tests (`:815` baseline-no-PUT, `:851` change-after-open, `:897` error) drive through `handleFile`. Expect them green unchanged if the wiring is correct; if any asserts on the hook param, update to the store-driven path. Do NOT weaken the AC-5 baseline assertion (open with a restored set → no PUT).
  - [x] Check the other `useAutosave` referencers surfaced in the blast radius (`annotations/AnnotationLayer.test.tsx`, `components/SaveIndicator/SaveIndicator.tsx`), SaveIndicator only consumes `status` (unaffected); fix any test that constructs the hook with a param.
- [x] **Task 5: Verify green + contract identity, then live-smoke (AC-6)**
  - [x] `cd client && npm run typecheck && npm test` green.
  - [x] `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green (unchanged; run on host per CLAUDE.md sandbox note).
  - [x] Regenerate-and-diff the contract to PROVE byte-identity: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`; `git diff --exit-code server/openapi.json client/src/api/schema.d.ts` must show NO change (this refactor touches no Pydantic model).
  - [x] Live smoke at DPR>1 per "Smoke plan" (own dev servers, not user's, CLAUDE.md).

## Dev Notes

### What exists today (read before touching anything)

**`client/src/store/index.ts`**, Zustand store wrapped by zundo `temporal`. State: `annotations: Map<id, Annotation>` + assorted transient UI fields (`selectedId`, `multiSelectedIds`, `hoveredId`, `hidden`, `dragPreview`, `groupDragPreview`, `flashId`) + per-tool defaults (`activeColors`, `activeStrokeWidth`, `activeAlpha`, `activeMemoSize`). **The store does NOT own a `docId` today**, that is the whole gap.
- `hydrate(annotations)` action (`:489`): a LOAD (not a user edit). Rebuilds the Map keyed by `id` and clears the transient UI fields. Does NOT set a docId.
- `hydrateStore(annotations)` free function (`:532`): calls `hydrate` then `temporal.getState().clear()` so the loaded set is the undo floor (Story 3.5 AC-4). This is the ONLY wholesale set path.
- `partialize: (s) => ({ annotations })` (`:508`), zundo tracks ONLY `annotations`. Every other field (and any new `docId`) is excluded from undo. Keep it that way.

**`client/src/hooks/useAutosave.ts`**, the dirty-flag, debounced (800ms), single-flight autosave scheduler (Story 3.4, AR-7/H6). A PASSIVE observer: reads the store, calls `putAnnotations`, adds no mutation path. Today it takes `docId: string` as a PARAM (App passes `doc?.doc_id ?? ""`). Scheduler refs: `mountedRef` (baseline gate), `dirtyRef`, `inFlightRef` (single-flight), `debounceTimer`, `settleTimer`, and `generationRef` (the guard we are deleting). `flush(forDocId, gen)` PUTs `useAnnotationStore.getState().all()` to `forDocId`; its `.then`/`.catch`/`.finally` each bail if `generationRef.current !== gen`.

**`client/src/App.tsx`**, `doc: Doc | null` React state. `handleFile` (`:245`): `uploadDoc → getAnnotations → hydrateStore(restored) → setDoc(opened)`. `useAutosave(doc?.doc_id ?? "")` at `:120`; `saveStatus.status` drives the top-bar `SaveIndicator` (`:304`) and the error `Toast` (`:278`).

### Why the `generationRef` exists: and why atomic ownership alone is NOT enough (READ THIS)

The `generationRef` guarded **three** distinct vectors on a mid-flight doc switch (see the comment block at `useAutosave.ts:14-21`):
1. **Data vector**, a stale doc-A response re-scheduling a flush that writes A's snapshot to the wrong doc.
2. **Status vector**, a stale doc-A `.then`/`.catch` setting `"saved"`/`"error"` over doc-B's live status.
3. **Single-flight-flag vector**, a stale doc-A `.finally` clearing `inFlightRef` **while doc-B's own PUT is genuinely in flight**, letting a second concurrent doc-B PUT start → two PUTs racing → last-write-wins can persist a stale snapshot.

**Trap 1 (the important one): making `(docId, annotations)` atomic and reading the target live at flush time fixes vectors 1 and 2, but NOT vector 3.** Vector 3 is about the shared `inFlightRef`, not about the data. If you just delete `generationRef` and keep the current "reset `inFlightRef = false` on every docId change" behavior, vector 3 REGRESSES: doc-A's in-flight PUT, on resolving after the switch, runs `.finally` and clears `inFlightRef` while doc-B's PUT is in flight. This is exactly the class of subtle async bug that shipped before. **AC-4 exists to force you to preserve single-flight structurally.**

### Recommended design: continuous single-flight scheduler (smallest structure that lets the guard die)

Bind autosave to `store.docId` and make the scheduler **continuous across a doc switch** instead of resetting its in-flight tracking:

- `flush` reads `{ docId: target, all } = useAnnotationStore.getState()` and PUTs `all()` to `target`. Target + snapshot are always a consistent pair (atomic store), so **A's marks can only ever be PUT to A** (at whatever flush ran while `store.docId === A`). Vectors 1 and 2 gone by construction.
- On a docId change, reset `mountedRef` (re-arm the baseline so B's hydrated set is not dirty, AC-5), reset `dirtyRef`, `clearTimers()`, `setStatus("idle")`, but **do NOT reset `inFlightRef`.** An A-PUT genuinely in flight stays tracked, so B cannot start a second concurrent PUT. When A's PUT resolves, `.finally` correctly clears `inFlightRef` (there is exactly one PUT in flight app-wide at any instant); a dirty-B then flushes for real, reading the store live (→ B → B). Single-flight holds with no counter.
- This makes the guarantee **global single-flight** (≤1 PUT in flight app-wide), which is a *strengthening* of AR-7's "single-flight per doc" (≤1 per doc), not a violation, it can never fire overlapping PUTs and last-edit-wins still holds. The only behavioral change is timing on a mid-flight switch (a doc-B edit coalesces behind an in-flight doc-A PUT rather than racing it), which is strictly safer and is unreachable through today's UI anyway.
- Known edge (note, don't fix): if an A-PUT hangs forever (network stall), `inFlightRef` stays set and blocks B's saves too. Same failure mode as a hung PUT within one doc today; acceptable for a single-user localhost app.

**Alternative (only if you must preserve the exact old per-doc timing):** mount `useAutosave` inside a tiny component keyed by `store.docId` (`<AutosaveController key={docId} />`), giving each doc private scheduler refs so a stale continuation touches its own orphaned refs and never B's. This deletes the guard too, but adds a component + lifts `status` up to App (a rare stale-status write across a switch is then cosmetic). Prefer the continuous scheduler above unless per-doc timing is explicitly required.

### Trap 2: a live in-app doc switch does NOT exist today

`setDoc(null)` is never called and there is no close/library/"open another" affordance, `EmptyDropzone` renders only while `!doc`. So the **mid-flight cross-doc race (AC-4) is reachable only in the `useAutosave` unit test, not through the live UI.** Do not hunt for a switch button. The unit test at `useAutosave.test.ts:179` is the real guard for AC-4; the live smoke covers AC-1/AC-5 via reopen (below). When in-app switching lands in Phase 2 (Library page), this refactor makes it correct by construction.

### Smoke plan (AE-5, DPR>1)

Launch your OWN `uvicorn` + `vite dev` (CLAUDE.md: never reuse the user's servers). At DPR>1:
1. Open doc A, add a highlight, wait for the SaveIndicator to reach "saved".
2. Reopen doc B, since there is no in-app switch, reach a second doc by RELOADING the page and opening a different PDF (`fixtures/sample-pdfs/` has candidates). A fresh load gives a fresh store, so this proves AC-1/AC-5 (B hydrates only its own marks; A's marks are intact on disk and never appear on B).
3. Reopen doc A → its highlight restores; `Ctrl+Z` does not remove it (undo floor).
The in-flight race (AC-4) is covered by the unit test, not this smoke.

### Project Structure Notes

- Pure client-side change, all under `client/src/`. Touched: `store/index.ts` (+ `store/README.md`), `hooks/useAutosave.ts`, `App.tsx`, and the four test files in Task 4. NO new files, NO backend change, NO Pydantic/contract change (`server/` untouched → `openapi.json`/`schema.d.ts` byte-identical, AC-6).
- Naming: prefer `openDoc` for both the store action and the free function (the action sets state atomically; the free function additionally clears zundo history), mirrors the existing `hydrate`/`hydrateStore` split, renamed for the doc-scoped meaning. Follow CLAUDE.md: delete the old names, don't leave `hydrate`/`hydrateStore` aliases behind.
- Keep the `render/` test-mock-barrel convention in mind (CLAUDE.md), though this story adds no `render/` export, so the `App.test`/`Reader.test` `vi.mock("@/render")` barrels do not change.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 5.8: Doc-scope the annotation store], story + the three Given/Then ACs.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-02.md], the correct-course that created this story (AE-4 ≡ AE3-3); note it uses the pre-renumber key `5-6-doc-scope-store` (now `5-8`).
- [Source: .bmad/planning-artifacts/epics.md#Additional Requirements], AR-6 (ownership: backend is source of truth, client is a hydrated working copy), AR-7 (one command stack → dirty flag → debounced single-flight autosave; backend is a dumb full-overwrite store), AR-12 (store keys by `id`).
- [Source: client/src/hooks/useAutosave.ts:14-21], the `generationRef` rationale comment enumerating the three vectors this story retires.
- [Source: client/src/store/index.ts:489,:532], the `hydrate` action and `hydrateStore` free function being generalized to `openDoc`.
- [Source: client/src/App.tsx:120,:245-270], the `useAutosave` call site and the hydrate-before-`setDoc` open ordering (Story 3.5 AC-4) that must be preserved.
- [Source: client/src/hooks/useAutosave.test.ts:156,:179], the baseline-reset and stale-in-flight (Codex HIGH) tests that pin AC-4/AC-5 and must be re-driven through the store.
- [Source: CLAUDE.md], contract-types regen flow, backend-test sandbox note, "launch your OWN dev servers for smoke", document-level handler + render-mock conventions.

## Dev Agent Record

### Agent Model Used

Sonnet 5 xHigh (bmad-dev-story).

### Debug Log References

- `cd client && npm run typecheck` — clean.
- `cd client && npm test -- --run` — 42 files, 844 tests passed.
- `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` — 72 passed.
- Contract regen: `uv run python -m app.export_openapi` + `npm run gen:api`, then `git diff --exit-code server/openapi.json client/src/api/schema.d.ts` — exit 0, no diff (AC-6 byte-identity proven).
- Live smoke (own `uvicorn --port 8123` + `vite --port 5183`, `PAPER_MATE_API_TARGET`/`PAPER_MATE_DATA` pointed at an isolated scratch dir, Chrome DevTools MCP at viewport `1280x900x2`): opened doc A (`09-regularization.pdf`), dragged a multi-line cross-viewport highlight, confirmed the PUT fired to doc A's id and the mark persisted on disk. Reloaded (confirmed Trap 2: no in-app switch, fresh S0) and opened doc B (`outlined-sample.pdf`) — distinct doc-id, empty restored set, no PUT, doc A's mark absent from doc B and still intact on disk. Reloaded and reopened doc A — highlight restored, `Ctrl+Z` did not remove it (undo floor, AC-5). Killed the scratch servers/tab afterward.

### Completion Notes List

- Store: added `docId: string | null` (default `null`, excluded from the zundo `partialize`) and replaced the `hydrate` action + `hydrateStore` free function with a single `openDoc` pair (store action `openDoc(docId, annotations)` sets both atomically; free function `openDoc` calls it then clears zundo history), matching the story's "delete the old names, don't leave aliases" guidance.
- Autosave: `useAutosave()` now takes no parameter, reads `docId`/`annotations` reactively, and `flush()` reads `{ docId, all }` live from the store at flush time. `generationRef` and its three staleness checks are gone. Implemented the continuous single-flight design from Dev Notes: the docId-change effect resets `mountedRef`/`dirtyRef`/`status`/timers but deliberately leaves `inFlightRef` untouched, so an in-flight PUT for the old doc keeps blocking a concurrent PUT for the new doc until it resolves (AC-4, Trap 1).
- App: `handleFile` calls `openDoc(opened.doc_id, restored)` in place of `hydrateStore(restored)`; `useAutosave()` is called with no argument. Ordering (`uploadDoc → getAnnotations → openDoc → setDoc`) preserved.
- Tests: `useAutosave.test.ts` rewritten around the no-arg hook + store-driven `openDoc` doc switches; the AC-4 stale-in-flight test is re-derived for the continuous single-flight model (3 PUTs total: doc-A, then doc-B coalesced after A resolves, then doc-B's own follow-up after a further B edit while B's PUT is in flight — not the old 2-independent-timers shape). `store/index.test.ts`'s hydrate-on-open describe block now asserts atomic `openDoc(docId, annotations)`, and that `docId` survives `temporal.undo()`. `App.test.tsx` needed only a `docId: null` addition to the existing per-test store reset (the autosave-on-open/save-failure tests already passed unchanged, confirming the wiring). `AnnotationLayer.test.tsx`/`SaveIndicator.tsx` needed no changes (neither constructs the hook with a param).
- AC-6 byte-identity and the full DPR>1 doc-switch smoke are recorded above (Debug Log References).

### File List

- `client/src/store/index.ts`
- `client/src/store/index.test.ts`
- `client/src/store/README.md`
- `client/src/hooks/useAutosave.ts`
- `client/src/hooks/useAutosave.test.ts`
- `client/src/App.tsx`
- `client/src/App.test.tsx`
- `client/src/api/client.ts`
- `.bmad/implementation-artifacts/5-8-doc-scope-store.md`
- `.bmad/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-07-03: Story implemented end-to-end (Tasks 1-5) via `bmad-dev-story`. Store now owns `(docId, annotations)` atomically via a renamed `openDoc` action + free function (retiring `hydrate`/`hydrateStore`); `useAutosave()` takes no parameter and binds its PUT target to `store.docId` read live at flush time; `generationRef` and its three staleness checks are deleted, replaced by a continuous (app-wide) single-flight scheduler that never resets `inFlightRef` on a doc switch. Client suite green (844/844), backend suite green (72/72), contract byte-identical (no diff), live-smoked at DPR>1 across a doc A -> doc B -> doc A reopen cycle (own dev servers). Status: ready-for-dev -> review.
- 2026-07-03: Cross-model Codex code review (`bmad-code-review` methodology, via `codex exec` against the `baseline_commit..HEAD` diff). 0 High, 1 Medium, 1 Low, 4 dismissed. Both real findings fixed:
  - **Medium** (`useAutosave.ts`'s docId-change effect had no returned cleanup): moving the story task's "keep `clearTimers()` in the cleanup" instruction into the effect BODY instead of a returned closure meant `clearTimers()` ran on every docId change (fine) but NOT on a true component unmount (regression) — a debounce/settle timer scheduled just before an unmount could survive it and later call `flush()`/`setStatus` against a dead component. Fixed by moving `clearTimers()` back into a returned cleanup function (mirrors the pre-refactor structure, minus the deleted `generationRef` bump). Verified by temporarily reverting the fix and confirming the new regression test fails without it, then restoring. Regression test added: `useAutosave.test.ts` "unmounting with a pending debounce timer does not fire a stray PUT after unmount".
  - **Low** (`useAutosave.test.ts`'s AC-4 stale-in-flight test used `expect.anything()` for PUT payloads): call-count/target-doc assertions alone wouldn't catch a regression that PUTs doc-B with doc-A's stale snapshot — the exact "must NOT write A's marks to B" guarantee the test claims to pin. Fixed: payload assertions now check the actual annotation ids (`b1` only on the 2nd call, `b1`+`b2` on the 3rd; never `a1`).
  - Full suite re-verified green (845/845 frontend — the new regression test adds one —, typecheck clean; backend unaffected, no re-run needed for a client-only fix). Status: review -> done.
