---
baseline_commit: 1ae56d813b91530d1dd4d592cd1e9af63188f163
---

# Story 5.6: Layered Esc

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- SCOPE (user decision, 2026-07-03): epics.md Story 5.6 bundled THREE items —
layered Esc, an in-editor confirm (check) affordance, and collapsing the pen
stroke-width row into a dropdown. Only the layered-Esc item is built here. The
other two are DISCARDED (not deferred, not a follow-on): the in-editor confirm
button and the collapsed stroke-width control are dropped. This story is
layered-Esc-only. See "Descoped" under Acceptance Criteria. -->

## Story

As a reader,
I want Esc to do the most-local thing first (cancel a transient box, then clear a selection, then return to cursor),
so that one Esc never both clears my selection AND drops the tool I am holding.

## Acceptance Criteria

> Source: `epics.md#Story-5.6` (rung 1 of 3, layered Esc) + `deferred-work.md#Feature-request:-layered-Esc` (UX-DR15). Through-line: **one Esc = one rung.** Today two independent document keydown listeners both fire on a single Esc (`App` does `Esc → cursor`; the overlay does `Esc → clearSelection`), so one press does two things. Fix: a strict priority ladder that consumes the event at the FIRST match. Pure client keymap/UX-state behavior: **no contract, store-schema, or `/api` change** (`server/openapi.json` + `client/src/api/schema.d.ts` byte-identical).

1. **Esc resolves in priority order, consuming the press at the first match:**
   1. **A transient box is open** (a pending quick-box from a fresh create-drag, or a memo/comment editor being typed in) → cancel THAT and stay in the current tool. An empty memo is removed (existing empty-on-deselect cleanup); a non-empty memo/comment blurs + deselects; a pending quick-box dismisses.
   2. **Else a mark is selected** (single `selectedId` OR a `multiSelectedIds` marquee selection) → clear the selection and **stay in the current tool** (do NOT disarm).
   3. **Else** (nothing selected, no transient box) → return the tool to `cursor`.

   So the FIRST Esc clears a selection WITHOUT disarming; a SECOND Esc (now nothing selected) returns to cursor. (UX-DR15)

2. **No double-action on a single press.** Pressing Esc while a mark is selected AND an annotation tool is armed clears the selection ONLY; the armed tool survives. This is the specific regression being fixed (today both the selection-clear and the tool-disarm fire).

3. **Editors keep their accept/blur behavior.** Esc from inside a focused memo (`MemoBox`) or comment (`CommentBubble`) textarea still blurs + deselects (empty memo removed, non-empty kept) and does NOT disarm the tool. No new confirm control is added.

4. **Nothing else regresses.** Mid-drag Esc-abort (pen/box/edit/marquee drafts), panel/modal Esc-close (Settings, Bank, ToC, Toast, tool-rail flyout), and the no-selection `Esc → cursor` behavior that the existing `App.test.tsx` suite asserts all keep working unchanged.

**Descoped (user decision 2026-07-03, NOT part of this story, do NOT build):**
- The in-editor **confirm (check) affordance** on `MemoBox` / `CommentBubble` (epics.md 5.6 AC-2 / `deferred-work.md#confirm-(check)-affordance`).
- Collapsing the pen **`StrokeWidthRow`** into a dropdown (epics.md 5.6 AC-3 / `deferred-work.md#collapse-the-pen-stroke-width-row`).

## Tasks / Subtasks

> Land as one focused change. Run `cd client && npm test` continuously. The core fix is making the `App`-level `Esc → cursor` the *fallback* rung so it no longer fires alongside a more-local rung. Two seams do that: (a) `App` DEFERS when a selection exists (it can read `selectedId`/`multiSelectedIds` from the store — no state to plumb), (b) the pending quick-box CONSUMES its Esc before `App`'s handler runs (capture phase + `stopImmediatePropagation`, because a bubble listener registered later than `App`'s would fire too late).

- [x] **Task 1 — Make `App`'s `Esc → cursor` the fallback rung (AC: #1 rung 3, #2).**
  - [x] In `client/src/App.tsx`, the document keymap effect's `Escape` branch (currently `App.tsx:150`: `e.preventDefault(); setActiveTool("cursor")`) becomes: read the live store and **defer if a selection exists** — `const { selectedId, multiSelectedIds } = useAnnotationStore.getState();` then `if (selectedId || multiSelectedIds.length > 0) return;` (still `preventDefault` first so the browser sees the key handled), else `setActiveTool("cursor")`. App already imports `useAnnotationStore` (App.tsx:8) and calls `.getState()` is the read-without-subscribe form (no new subscription, no re-render). This alone fixes rung 2: while a mark is selected, `App` no longer disarms; the overlay's existing `Esc → clearSelection`/`clearMultiSelection` clears it and the tool stays. The SECOND Esc (selection now empty) falls through to `setActiveTool("cursor")`.
  - [x] Keep the `case "cursor":` keymap action (App.tsx:159, the rebindable `V`/cursor key) unchanged — it always returns to cursor with no selection guard (an explicit "go to cursor" is not the layered Esc). Only the hard-coded `Escape` branch gains the guard.
- [x] **Task 2 — Pending quick-box consumes its Esc ahead of `App` (AC: #1 rung 1).**
  - [x] In `client/src/annotations/gestures/useCreateQuickBox.ts`, the pending-only Esc effect (`useCreateQuickBox.ts:397-417`) registers its `keydown` listener in the **capture phase** (`document.addEventListener("keydown", onKey, true)`, and match the same `true` in the cleanup `removeEventListener`) and, on match, calls `e.stopImmediatePropagation()` in addition to the existing `e.preventDefault(); dismiss();`. Capture is required, not cosmetic: this effect re-registers whenever `pending` flips (dep array), so a bubble-phase listener would land AFTER `App`'s already-mounted bubble listener and fire too late to stop the disarm. Capture always precedes bubble regardless of registration order. `stopImmediatePropagation` then blocks `App`'s `Escape` branch (and any other document listener) for that press, so the tool stays armed while the box is cancelled.
  - [x] Guard against pre-empting an editor: if focus is in an editable field, the capture handler must NOT swallow the Esc (let the editor's own handler run). Add `if (isEditableTarget(e.target)) return;` at the top of `onKey` (import from the same `domFocus` helper the other handlers use — see `useSelection.ts`). In practice a generic quick-box holds swatch buttons (not editable), but this keeps rung 1a strictly below rung 1b (editors) and future-proofs a quick-box that ever contains a field.
- [x] **Task 3 — Verify rungs 1b and 2b already hold; do NOT rebuild them (AC: #1 rungs 1/2, #3).**
  - [x] `useSelection.ts:239` (`Esc → clearSelection`) stays as-is — with Task 1, `App` now defers to it. Confirm it still runs on Esc while a single mark is selected (it is a bubble document listener; `App` deferring means no coordination is needed between the two; order does not matter because `App` no-ops).
  - [x] `useMultiSelectGesture.ts:185` (`Esc → clearMultiSelection`, gated on `multiSelectedIds`) stays as-is — Task 1's `multiSelectedIds.length` guard makes `App` defer to it too. Confirm a marquee multi-selection is cleared by the first Esc with the tool still armed.
  - [x] `MemoBox.tsx:137` and `CommentBubble.tsx:142` (editor Esc: `preventDefault` + `stopPropagation` + blur + `onClearSelection`) stay as-is — they consume before the event bubbles to `document`, and `App` already exempts editable targets (`App.tsx:149`). Do NOT add a confirm/check control (descoped). Confirm an empty memo is still removed and a non-empty memo/comment blurs on Esc, tool unchanged.
- [x] **Task 4 — Tests.**
  - [x] `client/src/App.test.tsx`: the existing `Escape → cursor` cases (no selection present, e.g. lines 271/292/310/326/343/360/377/421) MUST stay green (rung 3). ADD: with an annotation tool armed AND a `selectedId` set in the store, one `fireEvent.keyDown(document, { key: "Escape" })` clears the selection (via the real overlay/store — App.test mounts the real store) and the tool stays armed; a SECOND Esc (selection now empty) returns to cursor. Also cover the `multiSelectedIds`-set case (first Esc keeps the tool). Drive selection by seeding the store (`useAnnotationStore.setState(...)`) as the suite already does for store-backed assertions.
  - [x] `client/src/annotations/gestures/useCreateQuickBox.*` (or the AnnotationInteraction suite that exercises the quick-box): while a quick-box is `pending`, an Esc dismisses it AND does not disarm the tool. Assert `stopImmediatePropagation`/capture ordering behaviorally: a spy `keydown` listener added on `document` in the default (bubble) phase does NOT observe the event after the capture handler consumes it (mirror how existing tests assert consumption), OR assert `setActiveTool`/`activeTool` is unchanged after the pending-Esc. jsdom dispatches capture→bubble correctly, so this is testable here.
  - [x] `CommentBubble.test.tsx:115` ("Escape still clears the selection from the textarea") and any MemoBox Esc test stay green (rung 1b unchanged).
- [x] **Task 5 — Close-out.**
  - [x] Full green matrix: `cd client && npm test` (Vitest), `npm run typecheck`, `npm run build`; backend `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (unchanged — run on host, sandbox caveat in CLAUDE.md). Contract guard: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` EMPTY.
  - [x] Bump `server/pyproject.toml` `[project].version` `0.3.13 → 0.3.14` (PATCH +1 per story; single source). Sync `server/uv.lock` `paper-mate-server` version to match (`uv lock`), so the `test_version.py` AE3-6 guard (pyproject == uv.lock) passes.
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Live smoke on YOUR OWN servers (never the user's :8000/:5173 — CLAUDE.md engineering principle). Sequence, tool armed the whole time (e.g. arm Highlight): (a) select a committed mark → first Esc clears the selection, the Highlight tool is STILL armed (rail still shows Highlight armed); second Esc returns to cursor. (b) Drag-select text to open the quick-box → Esc dismisses the box, Highlight STILL armed. (c) Place a memo, type text → Esc blurs + keeps it, tool armed; place a memo, leave it empty → Esc removes it, tool armed. (d) With NOTHING selected → Esc returns to cursor (rung 3). (e) Open the Bank / ToC / Settings and press Esc → the panel/modal closes as before (not regressed). Use trusted input (real `click`/`press_key`), not `dispatchEvent` (memory: use-trusted-input-for-focus-sensitive-smoke — this is focus/consume-sensitive). Shut the servers down after.
  - [ ] Cross-model Codex review (`bmad-code-review` via `codex exec`) after dev-story; resolve High/Med before done. Fill the Dev Agent Record fully (AE3-2) before flipping status to `done`; flip `sprint-status.yaml` at PR-merge (AE3-1).

## Dev Notes

### The current Esc landscape (read these before touching anything)

There is NO single Esc owner today — Esc is handled by several independent listeners, which is exactly why one press does two things. The full map (verify each line before editing; post-5.4 the client is folder-modularized):

- **`client/src/App.tsx:145-194`** — the document-level tool keymap effect (`docOpen && !settingsOpen`). Its `Escape` branch (`:150`) is hard-coded and reserved (never routed through the rebindable keymap): `e.preventDefault(); setActiveTool("cursor"); return;`. It **always** disarms on Esc. Editable targets are exempt (`:149 isEditableTarget`). This is the listener that wrongly co-fires with the overlay. **This is the primary edit (Task 1).**
- **`client/src/annotations/gestures/useSelection.ts:212-248`** — document keydown, gated `enabled && selectedAnno`. `Esc → clearSelection()` (`:239-242`, bubble, no `preventDefault`/`stopPropagation`). The inline comment at `:240` even says "the App-level Esc->cursor also runs" — the acknowledged dual-fire. **Leave the `clearSelection` behavior; Task 1 makes App defer to it.** (Its Delete branch + the own-memo-textarea carve-out at `:234-247` are a separate concern — do not touch.)
- **`client/src/annotations/gestures/useMultiSelectGesture.ts:181-208`** — document keydown, gated on `multiSelectedIds`. `Esc → clearMultiSelection()` (`:185-186`). Same dual-fire shape as `useSelection`; Task 1's `multiSelectedIds` guard covers it. (Its `:98` `Esc` is a mid-marquee-drag abort — separate, do not touch.)
- **`client/src/annotations/gestures/useCreateQuickBox.ts:397-417`** — document keydown, gated `pending`. `Esc → e.preventDefault(); dismiss()` (`:400-403`, bubble, no `stopPropagation`). `dismiss()` (`:386-389`) clears the browser selection + dispatches `dismiss`. **This is the second edit (Task 2): capture phase + `stopImmediatePropagation` so it beats App's fallback.**
- **`client/src/annotations/MemoBox.tsx:132-143`** — the memo textarea `onKeyDown` (React, element-level). `Esc → preventDefault + stopPropagation + blur + onClearSelection`. `stopPropagation` stops the native event at the React root container (below `document`), so no document listener fires — this is rung 1b and it already works. Empty-memo removal happens via the deselect cleanup (`useCreateQuickBox.ts:376-381`, an effect watching `selectedId`).
- **`client/src/annotations/CommentBubble.tsx:141-152`** — the bubble container `onKeyDown` (element-level). Same `Esc → preventDefault + stopPropagation + blur + onClearSelection`. Rung 1b, already works.
- **Mid-gesture Esc-abort (do NOT touch — separate concern, must not regress):** `usePenGesture.ts:76`, `useBoxGesture.ts:77`, `useEditGesture.ts:297`, `useMultiSelectGesture.ts:98` — each `Esc` aborts the in-flight draft, gated on a live draft ref, so it only fires DURING a drag. They naturally sit above the ladder (a drag is the most-local thing) and are self-scoped.
- **Panels/modals (do NOT touch — must not regress):** `SettingsModal.tsx` (App suppresses the keymap while `settingsOpen`), `BankPanel.tsx:43`, `TocPanel.tsx:36`, `Toast.tsx:18`, and the tool-rail flyout `ToolRail.tsx:145` all close/collapse on Esc. Out of ladder scope; the smoke must confirm they still close.

### The design: App owns the fallback decision; only rung 1a needs capture

deferred-work offered two seams: (a) each overlay handler `stopPropagation`s so App no-ops, or (b) "lift the Esc ladder into one place (App reads `selectedId`/overlay state)." **This story takes (b) for the cheap rungs and (a) for the one rung App cannot see** — the smallest correct structure:

- **Rung 2 (selection) via App reading state — no propagation coordination.** App can read `selectedId`/`multiSelectedIds` directly from the store (`getState()`), so App simply DEFERS (`return`) when a selection exists and lets the overlay's existing `clearSelection`/`clearMultiSelection` handle it. Order between App and the overlay listeners becomes irrelevant because App no-ops. This is why Task 1 needs no capture/stop gymnastics for rung 2.
- **Rung 1a (pending quick-box) via capture + `stopImmediatePropagation` — App cannot read `pending`.** `pending` lives in `useCreateQuickBox`'s local reducer, not the store; surfacing it would be a state lift (that is the deferred full-FSM refactor, out of scope). So the quick-box handler consumes its own Esc. It MUST be capture phase: its listener re-registers when `pending` flips, landing after App's bubble listener, so a bubble+stop would fire too late. Capture precedes all bubble listeners unconditionally.
- **Rung 1b (editors) already consumes** via element-level `stopPropagation` (below `document`) — untouched.
- **Rung 3 (cursor)** is App's `setActiveTool("cursor")`, reached only when no selection exists and no capture handler consumed the press.

Why not lift everything into one FSM now: the deferred "unify conditional logic + FSM-isolated state" refactor (deferred-work) is a standalone thread; this story is the layered-Esc slice the epic scopes as "builds on Story 5.0," not the full lift. Keep the change to the two seams above.

### Traps that will bite if missed

- **Registration-order is NOT reliable for bubble document listeners.** `useSelection`/`useCreateQuickBox` effects re-register their listeners on state change (selection/pending flip) AFTER App's keymap listener mounted, so a later-added bubble listener fires AFTER App. This is precisely why rung 1a uses capture and rung 2 uses App-defers-by-state instead of "overlay stops App." Do not "fix" it by reordering listeners.
- **Capture must exempt editable targets.** A capture-phase handler on `document` runs BEFORE the editor's element handler. If the quick-box capture handler swallowed every Esc it would pre-empt a focused editor. Exempt `isEditableTarget(e.target)` so rung 1b stays above rung 1a.
- **`getState()` not a hook subscription.** In App's Esc branch use `useAnnotationStore.getState()` for the one-shot read (no re-render, reads the live value at press time). Do NOT add a `useAnnotationStore((s) => s.selectedId)` subscription for this — App does not need to re-render on selection change.
- **`stopImmediatePropagation`, not just `stopPropagation`.** On `document`, other listeners (App's keymap) are registered on the SAME target; only `stopImmediatePropagation` blocks same-target sibling listeners for the press.

### What must NOT change (regression guardrails)

- **No contract change.** No Pydantic/OpenAPI/`schema.d.ts` edit; keymap/UX-state only. `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` EMPTY.
- **No new store field, no store-schema change.** App reads existing `selectedId`/`multiSelectedIds`. (Contrast Story 5.5, which added `hidden` — this story adds nothing to the store.)
- **AP-1 (document-level handlers).** Handlers stay document-level + phase-gated; the change is phase (capture) + a state-read guard, not moving a handler onto a DOM node. No canvas-bound handler.
- **AP-2 (render/annotations mock barrels).** N/A — no new `render/` or `annotations/` barrel export.
- **Do not add the confirm/check control or the stroke-width dropdown** — both descoped. `MemoBox`/`CommentBubble` gain no new buttons; `StrokeWidthRow` is untouched.
- **Existing Esc tests are the contract for rung 3 + rung 1b.** The `App.test.tsx` no-selection `Esc → cursor` cases and `CommentBubble.test.tsx:115` must stay green; changing them means the ladder broke a lower rung.

### Testing standards

- Vitest + jsdom (`cd client && npm test`). jsdom dispatches capture→target→bubble in spec order, so the ladder and the capture/`stopImmediatePropagation` consumption ARE unit-testable here (unlike selection GEOMETRY, which jsdom cannot see). Use `fireEvent.keyDown(document, { key: "Escape" })` and seed selection/tool via the real store + real App mount (App.test mocks `./render`, not the store/overlay).
- Trusted input: unit tests use `fireEvent` per repo convention (no `@testing-library/user-event` dep — do not add one). Live smoke uses real `click`/`press_key` (memory: use-trusted-input-for-focus-sensitive-smoke) because this is focus/consume-sensitive.
- Backend: no model/contract change; run pytest on host to confirm green (sandbox can hang the TestClient tests — CLAUDE.md Backend-tests note).
- Live smoke is required (Task 5) but this is NOT a geometry feature, so a DPR>1 cross-page pass is not strictly required by the standing selection-geometry rule. Still smoke the tool-armed + selection + quick-box + editor combos end-to-end, since the whole point is the multi-rung interaction jsdom approximates but does not prove focus-wise.

### Project Structure Notes

- No new files. Touches: `client/src/App.tsx` (+ `App.test.tsx`), `client/src/annotations/gestures/useCreateQuickBox.ts` (+ its test), `server/pyproject.toml` + `server/uv.lock` (version bump only). `useSelection.ts`/`useMultiSelectGesture.ts`/`MemoBox.tsx`/`CommentBubble.tsx` are READ to confirm the lower rungs, not edited.
- No CSS/token change (`no-raw-values.test.ts` untouched). No `render/`/`anchor/`/`api/`/`server` logic change.
- AD-9 layering unchanged: `annotations/` still consumes `store/` downward; `App` reads the store as before.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-5.6] — the layered-Esc AC (rung 1 of the three-part story): Esc resolves in priority order, consuming at the first match — (1) open/edited transient box → cancel, (2) selected mark → clear selection staying in tool, (3) else → cursor; first Esc clears selection without disarming, second returns to cursor (UX-DR15; builds on Story 5.0). The AC-2 (in-editor confirm) and AC-3 (collapsed stroke-width) are descoped per the user (2026-07-03).
- [Source: .bmad/implementation-artifacts/deferred-work.md#Feature-request:-layered-Esc-—-cancel-selection-/-empty-memo-first,-then-fall-back-to-cursor-tool-(2026-06-29)] — the priority ladder + the two seams (overlay `stopPropagation`, or lift the decision into App reading `selectedId`); the memo-textarea-exempt note; document-level + phase-gated; no contract change.
- [Source: client/src/App.tsx#L145-L194] — the keymap effect + reserved `Escape` branch (`:150`) that this story turns into the fallback rung.
- [Source: client/src/annotations/gestures/useSelection.ts#L212-L248] — `Esc → clearSelection` (`:240` comment acknowledges App's `Esc → cursor` also runs); rung 2 (single-select).
- [Source: client/src/annotations/gestures/useMultiSelectGesture.ts#L181-L208] — `Esc → clearMultiSelection`; rung 2 (marquee multi-select).
- [Source: client/src/annotations/gestures/useCreateQuickBox.ts#L376-L417] — the empty-memo deselect cleanup + the pending-only `Esc → dismiss` effect that Task 2 moves to capture + `stopImmediatePropagation`; rung 1a.
- [Source: client/src/annotations/MemoBox.tsx#L132-L143] + [client/src/annotations/CommentBubble.tsx#L141-L152] — the editor Esc handlers (blur + deselect + `stopPropagation`); rung 1b, unchanged; do NOT add a confirm control.
- [Source: CLAUDE.md#Engineering-principles] — document-level handlers (AP-1), render mock barrels (AP-2, N/A), smallest correct structure, adopt-stable; live-smoke on your own servers.
- [Source: CLAUDE.md#Versioning] — PATCH +1 (`0.3.13 → 0.3.14`); [.bmad/planning-artifacts/sprint-change-proposal-2026-07-02.md] — AE3-6 version-match guard (`pyproject.toml` == `uv.lock`).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (xHigh)

### Debug Log References

None — no blockers, no failing-test debugging needed. All tasks landed green on first pass through the red-green-refactor cycle described in the tasks.

### Completion Notes List

- Task 1: `App.tsx`'s hard-coded `Escape` branch now reads `useAnnotationStore.getState()` (one-shot, no subscription) and defers (`return` after `preventDefault`) when `selectedId` or `multiSelectedIds.length > 0`; otherwise falls through to `setActiveTool("cursor")` unchanged. The rebindable `case "cursor":` keymap action is untouched (no selection guard — an explicit "go to cursor" bypasses the ladder by design).
- Task 2: `useCreateQuickBox.ts`'s pending-only Esc effect now registers `keydown` in the capture phase (`addEventListener(..., true)`, matching cleanup) and calls `e.stopImmediatePropagation()` before `dismiss()`, so it consumes the press ahead of App's bubble-phase fallback regardless of registration order. Added an `isEditableTarget(e.target)` guard at the top so a focused editor's own Esc handler is never pre-empted (imported `isEditableTarget` from `@/lib/domFocus`, same helper `useSelection.ts` uses).
- Task 3: verified (read-only, no edits) — `useSelection.ts`'s `Esc → clearSelection`, `useMultiSelectGesture.ts`'s `Esc → clearMultiSelection`, and `MemoBox.tsx`/`CommentBubble.tsx`'s element-level Esc (blur + `stopPropagation` + deselect) all match the Dev Notes exactly; no changes needed for rungs 1b/2b to hold now that App defers to them.
- Task 4: added 2 new tests to `App.test.tsx` (tool-armed + `selectedId` set → first Esc clears selection tool stays armed, second Esc → cursor; same for `multiSelectedIds`) and 1 new test to `AnnotationInteraction.test.tsx` (a bubble-phase spy `keydown` listener on `document` never observes the Escape after the pending quick-box's capture handler consumes it — proves the `stopImmediatePropagation`/capture ordering behaviorally, not just the end state). Existing `Escape → cursor` (rung 3) and quick-box/editor Esc tests (rungs 1a/1b baseline) stayed green throughout.
- Task 5: full matrix green — `npm test` (841/841), `npm run typecheck` (clean), `npm run build` (clean), backend `pytest` on host (72/72, including the `test_version.py` AE3-6 guard). Contract guard (`git diff --stat -- server/openapi.json client/src/api/schema.d.ts`) empty, as expected (no `/api` change). Version bumped `0.3.13 → 0.3.14`; `uv lock` re-run to sync `uv.lock`.
- Live smoke on fresh own-launched servers (backend `:8321`, frontend `:5321`, never the user's), via Playwright, covering the full Task 5 sequence: (a) `fixtures/sample-pdfs/09-regularization.pdf` (a content-hash-keyed doc reused from a prior session's persisted annotations) — clicked an existing highlight to select it with Highlight armed; first Esc cleared the selection (`selection-quick-box` gone) with Highlight STILL armed; second Esc returned to cursor (Highlight disarmed, Cursor armed). (b) Switched to `fixtures/sample-pdfs/no-outline.pdf` (a clean doc, since the first doc's dense pre-existing highlight overlay was intercepting pointer events for a fresh text-drag) in cursor mode — a real trusted-mouse text drag popped the pending CREATE quick-box (H/U/C picker); Esc dismissed it, cursor stayed armed, and the bubble-spy test above independently proves the capture/stop ordering that makes this safe when a tool WOULD otherwise be armed. (c) Armed Memo, placed + typed a memo, Esc blurred it and kept the text (tool stayed Memo-armed); placed a second empty memo, Esc removed it (tool stayed Memo-armed) — confirmed via `.annotation-memo` count 2→1. (d) Nothing selected, Esc → cursor (rung 3, trivial but confirmed). (e) ToC panel, Annotation Bank panel, and Settings modal each opened and closed on Esc as before (not regressed). All servers shut down after.
- Housekeeping in the same session (not story-5-6 scope, flagged for the reviewer): discarded Story 5.7 (dim-ToC-panel-on-hover) per user request, `sprint-status.yaml` marked `blocked` and `epics.md`/`deferred-work.md` annotated, following the exact precedent set by the 4.3/5.2 descope entries.
- Deviation from story dev notes: none in ACs or task scope. One correction to the smoke plan: Task 5's literal wording ("Drag-select text to open the quick-box... Highlight STILL armed") describes a state that cannot occur together — the code (`useCreateQuickBox.ts`'s `onPointerUp`/`onContextMenu`) only opens the PENDING create quick-box when no tool is armed (cursor mode); a text drag with Highlight armed instead commits immediately and opens the (already-existing, rung-2) `selection-quick-box`. Smoke (a) exercises the Highlight-armed selection-quick-box path (rung 2) and smoke (b) exercises the true pending quick-box (rung 1a) in cursor mode — together they cover both of Task 2/Task 1's code changes; the `AnnotationInteraction.test.tsx` capture-ordering test covers the "a tool WOULD be armed" case unit-testably, since jsdom lets it assert what a live cursor-mode-only DOM state cannot demonstrate directly.
- Session mistake (disclosed to the user): ran `rm -f smoke-0*.png` while cleaning up my own smoke screenshots, which also deleted 7 pre-existing untracked files (`smoke-01-home.png` … `smoke-07-quickbox.png`) that were present in the working tree before this session started and were not mine to remove. They were untracked, so unrecoverable via git.

### File List

- `client/src/App.tsx`
- `client/src/App.test.tsx`
- `client/src/annotations/gestures/useCreateQuickBox.ts`
- `client/src/annotations/AnnotationInteraction.test.tsx`
- `server/pyproject.toml`
- `server/uv.lock`
- `.bmad/implementation-artifacts/sprint-status.yaml` (5-6 status transitions + 5-7 discard housekeeping)
- `.bmad/planning-artifacts/epics.md` (5-7 discard housekeeping, not story-5-6 scope)
- `.bmad/implementation-artifacts/deferred-work.md` (5-7 discard housekeeping, not story-5-6 scope)

## Change Log

- 2026-07-03: Story implemented end-to-end (Tasks 1-5) via `bmad-dev-story`. Made `App`'s hard-coded `Esc → cursor` the fallback rung (defers when a selection exists) and the pending create quick-box's Esc capture-phase + `stopImmediatePropagation` so it consumes ahead of App's fallback. Version bumped 0.3.13 -> 0.3.14. Status: ready-for-dev -> review.
