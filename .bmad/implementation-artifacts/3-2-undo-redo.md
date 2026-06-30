---
baseline_commit: 26c232a9fba1b80fc47a5de9ddac82bd36cf37ca
---

# Story 3.2: Undo / redo

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want undo and redo,
so that I can reverse mistakes freely.

> **The AE-1 enabler story.** Story 3.1 built the command PATH: one mutation surface in `store/index.ts` (`addAnnotation`, `deleteAnnotation`, `recolorAnnotation`, `restrokeAnnotation`, `realphaAnnotation`, `retextAnnotation`, `resizeMemoAnnotation`, `setAnnotationGeometry`) that every edit already routes through, with NO component mutating annotations around it (AD-7, AE-3 — audited done in 3.1). It deliberately added NO do/undo stack and left zundo-aware breadcrumbs in the store (the `dragPreview` doc-comment, the store header). Story 3.2 IS the fold: wrap that one clean surface with **`zundo`** (the Zustand temporal middleware — the AE-1 / Epic-1 PREP-2 adopt-stable decision, resolved in the Epic-2 retro) so the existing actions become do/undo, and bind `Ctrl Z` / `Ctrl Shift Z`. Undo/redo is client-only, in-memory, discarded on reload (AR-7).
>
> **Scope boundary, read first.** 3.2 adds ONLY the temporal stack + the keybindings + the make-one-edit-one-undo-step plumbing. It does NOT add: the dirty flag / debounced autosave (Story 3.4), hydrate-on-open (3.5), the Annotation Bank (3.6), highlight↔comment convert (3.7), text-range adjust (3.8), or any new edit kind. `Del`/`Backspace` delete already exists (Story 2.5 seam, wired in `useSelection`); 3.2 only makes it UNDOABLE. Do not re-implement delete here — that is Story 3.3's polish.
>
> **The principle that shapes the work:** one logical edit = one undo step. The store actions exist; the risk is entirely in how zundo *records* them — a logical create that fires two `set()` calls becomes two undo steps, and per-keystroke retext becomes char-by-char undo. Both must be coalesced (see Dev Notes "One edit, one step").

## Acceptance Criteria

> Faithful to `epics.md` Story 3.2. Restated self-contained so the dev needs only this file.

1. **Undo / redo reverse the command stack.** Given a sequence of creates/edits/deletes, when I press `Ctrl Z` (undo) / `Ctrl Shift Z` (redo), each is reversed / reapplied via the client command stack. The bindings work document-level, phase-gated (`phase === "ready"`), and are exempt while an editable field or button has focus (so `Ctrl Z` inside a memo/comment textarea does the browser's native TEXT undo, not an annotation undo). (FR-16, AR-7, UX-DR15, AP-1)

2. **Client-only, in-memory, discarded on reload.** The undo/redo history lives entirely in the client (zundo temporal store), is never sent to the backend, and is gone after a page reload. No contract change, no new `/api` call. (AR-7)

3. **A quick-box restyle reopen is itself an undoable command.** Reopening a selected mark's quick-box and recoloring / restroking / re-alphaing / resizing it is a single undoable step; undo reverts the style, redo reapplies it. (AR-7) This already routes through the command path (3.1/AE-3); 3.2 only has to ensure each such edit lands as exactly one temporal step.

4. **One logical edit = one undo step (no partial states).** Undo never leaves a half-applied edit on screen:
   - A two-page (grouped) highlight create undoes/redoes as ONE step (both `group_id` siblings together), not one page at a time. (Today the create fires `addAnnotation` per page — `AnnotationInteraction.tsx:189` `created.forEach(addAnnotation)` — which would be two temporal steps; this story must collapse it to one.)
   - A grouped delete (already group-aware in `deleteAnnotation`) undoes as ONE step, restoring every sibling.
   - A move/resize commits one step per drag (the 3.1 `dragPreview` design already commits ONE `setAnnotationGeometry` on release — preserve that; do NOT record per-`pointermove`).
   - Text re-edit (memo/comment typing via `retextAnnotation`) collapses an editing session into a single undo step, not one step per keystroke (see Dev Notes "One edit, one step" for the chosen mechanism).

5. **Transient/UI state is NOT undoable.** `selectedId`, `hoveredId`, `dragPreview`, and the `active*` session defaults (`activeColor`, `activeStrokeWidth`, `activeAlpha`, `activeMemoSize`) are EXCLUDED from the temporal history via zundo `partialize` — undo only ever rewinds the annotation set, never selection/hover/defaults. (Matches the 3.1 store doc-comments that already say "EXCLUDE from the zundo partialize like `selectedId`/`hoveredId`".) After an undo/redo, a `selectedId` that no longer points at a live annotation is cleared so no stale ring shows.

6. **Empty-stack no-ops are safe.** `Ctrl Z` with nothing to undo and `Ctrl Shift Z` with nothing to redo are silent no-ops (no throw, no spurious render). Redo history is cleared when a new edit is made after an undo (standard linear undo semantics — zundo's default).

7. **Re-render fidelity holds across zoom after undo/redo.** A mark restored or reverted by undo/redo re-renders at its exact PDF coordinates across all zoom levels (the marks read from the same store `annotations` Map; undo swaps the Map, the layer re-derives geometry through `anchor/` as always). The canvas never reflows (NFR-1, NFR-3).

8. **Contract + anchor-MODEL neutrality.** No contract change: the `Annotation` shape and the tracked OpenAPI (`server/openapi.json`) + generated TS (`client/src/api/schema.d.ts`) stay byte-identical (`git diff --stat` empty on both). zundo is a client-only state wrapper; no Pydantic edit, no backend change. (AR-3, AR-5, AR-9)

## Tasks / Subtasks

> Land as a SEQUENCE of small PRs (low-risk → high-risk), each suite-green + contract-byte-identical, mirroring the Story 3.1 / 5.0 strategy so a regression is bisectable.

- [x] **Task 1 — adopt zundo + wrap the store with `temporal` (AC: #1, #2, #5, #8).** Lowest risk: pure store wiring, no UI yet.
  - [x] `cd client && npm install zundo@2.3.0` (pin the exact patch per AD-2; peer dep is `zustand ^5.0.0`, satisfied by our `5.0.14`). Confirm `client/package.json` + `package-lock.json` updated; no other dep churn.
  - [x] Wrap the existing `create<AnnotationStore>(...)` with zundo's `temporal(...)` middleware. Configure `partialize` to track ONLY `{ annotations }` — exclude `selectedId`, `hoveredId`, `dragPreview`, `activeColor`, `activeStrokeWidth`, `activeAlpha`, `activeMemoSize`, and every action (functions). The undoable state is the annotation Map alone (AC-5).
  - [x] Set `equality` so a no-op `set` (a guard that returns the same Map, e.g. restroke on a non-pen mark) does NOT push a history entry. The store's `patchAnnotations` already returns a NEW Map only when something changed for the twins, but `setAnnotationGeometry`/`retextAnnotation`/`addAnnotation`/`deleteAnnotation` return the prior `state` object on a no-op — verify each no-op path returns referentially-equal `annotations` so zundo's equality skips it. Use a shallow `Object.is` on the partialized `annotations` reference (zundo default is `Object.is`; an explicit shallow equality on `.annotations` is fine and clearer).
  - [x] Decide & set `limit` (history depth). Recommend a generous cap (e.g. 100) so normal sessions never hit it, bounded so memory can't grow unbounded (each entry holds a Map reference, cheap; the Maps share unchanged Annotation objects). Document the choice.
  - [x] Unit tests in `store/index.test.ts`: after `addAnnotation` then `temporal.getState().undo()`, the annotation is gone; `redo()` restores it. A no-op action (restroke a text mark, setAnnotationGeometry unknown id) pushes NO history entry. `partialize` excludes selection/hover/defaults (undo after `select(id)` + `addAnnotation` does not un-select). Keep the existing 28 store tests green.

- [x] **Task 2 — one logical edit = one undo step (AC: #3, #4).** The correctness core; do BEFORE wiring keys so the behavior is right when the UI lands.
  - [x] **Grouped create = one step.** Replace the per-page `created.forEach(addAnnotation)` (`AnnotationInteraction.tsx:189`) so a multi-mark create lands in ONE `set()`. Add a batched store action `addAnnotations(list: Annotation[])` (one new Map, one `set`) alongside `addAnnotation`, and call it from the create path. Single-mark creates can keep `addAnnotation` (one step already) or route through `addAnnotations([created])` for uniformity — pick one and be consistent. Test: a two-mark grouped create + one `undo()` removes BOTH; `redo()` restores BOTH.
  - [x] **Move/resize = one step per drag.** Verify the 3.1 design holds: `useEditGesture` commits ONE `setAnnotationGeometry` on release (the live drag uses transient `dragPreview`, excluded from history). No change expected — add a regression test asserting one drag = one undo step (one `setAnnotationGeometry`, `undo()` returns the pre-drag anchor).
  - [x] **Text re-edit = one step per session, not per keystroke.** `retextAnnotation` fires on every keystroke into a memo/comment textarea; raw, that is char-by-char undo. Coalesce an editing session into one undo step (see Dev Notes "One edit, one step" for the recommended pause/resume-on-focus mechanism + the fallback). Test the chosen mechanism (e.g. with the temporal store paused, N retext calls add 0 history entries; on resume+commit, exactly 1).
  - [x] **Restyle reopen = one step** (AC #3): a quick-box recolor/restroke/realpha/resize is already one `set`; add a test that one such edit = one undo step and `undo()` restores the prior style.

- [x] **Task 3 — `Ctrl Z` / `Ctrl Shift Z` keybindings (AC: #1, #5, #6).**
  - [x] Add a NEW document-level `keydown` handler for undo/redo. It MUST be its own handler, not folded into `useSelection`'s key handler — that one early-returns on `e.ctrlKey` (`useSelection.ts:182`) AND is gated on `selectedAnno`, but undo must work with nothing selected. Phase-gate it (`phase === "ready"`), and exempt editable/buttons via the shared `isExempt` (so `Ctrl Z` in a textarea is native text undo). Where it lives: a small `gestures/useUndoRedo.ts` hook (mirrors the other gesture hooks) consumed by `AnnotationInteraction`, OR an effect in `AnnotationInteraction` — match the existing pattern. (Document-level, phase-gated, `isExempt` = the standing AP-1 convention; CLAUDE.md "bind interaction handlers at the document level".)
  - [x] Bindings: `Ctrl Z` (and `Cmd Z` on macOS — `e.metaKey`) → `temporal.getState().undo()`; `Ctrl Shift Z` (and `Cmd Shift Z`) → `redo()`. Also accept `Ctrl Y` for redo (common Windows alt) — optional, confirm in Open Questions. `e.preventDefault()` on a handled chord so the browser's own history navigation/undo doesn't also fire. Empty stack = silent no-op (AC #6).
  - [x] After undo/redo, reconcile selection: if `selectedId` no longer exists in the new `annotations` Map, `clearSelection()` (AC #5) so no stale ring/quick-box shows. (Subscribe to the main store, or read `annotations.has(selectedId)` right after the undo call.)
  - [x] Reset any held-key/transient state on `blur`/`visibilitychange` per the standing memory — though undo/redo is a discrete chord (no held state), keep the handler clean. (Memory: `held-key-state-reset-on-blur` — N/A for a non-held chord, note it.)
  - [x] Tests in `AnnotationInteraction.test.tsx` (or the new hook's test): dispatch `Ctrl Z` → store loses the last create; `Ctrl Shift Z` → restored; chord inside a focused textarea does NOT trigger annotation undo (isExempt); empty-stack chord is a no-op.

- [x] **Task 4 — close-out + verification.**
  - [x] Keep the `render/` mock barrels in sync IF (and only if) a new `render/` export is added — this story adds none, so `vi.mock("./render")` barrels in `App.test.tsx` / `Reader.test.tsx` are untouched (AP-2 N/A; confirm).
  - [x] Cross-model Codex review (AE-6, AP-3): run `bmad-code-review` via `codex exec` against the story + full diff (`26c232a..HEAD`). Resolve High/Med before done. (AE-7 sandbox-pytest workaround: `UV_CACHE_DIR=/tmp/uv-cache`; backend is untouched so the frontend suite is the gate.)
  - [x] **Live smoke on your OWN fresh servers** (uvicorn + vite dev on alternate ports; never reuse the user's running server — CLAUDE.md). Smoke the full matrix: create highlight/pen/memo/comment/region → `Ctrl Z` removes each → `Ctrl Shift Z` restores each. Move/resize a mark → one `Ctrl Z` returns it to the pre-drag spot. Recolor → undo reverts color. Type into a memo, then `Ctrl Z` (textarea focused) does native text-undo; click away, then `Ctrl Z` undoes the whole memo edit as one step. **Cross-page highlight (DPR ≥ 1.25): create → ONE `Ctrl Z` removes BOTH pages** (AC #4, the highest-risk path; AE-5 + memory `verify-on-hidpi-and-real-host` — jsdom can't see cross-page geometry). Empty-stack `Ctrl Z`/`Ctrl Shift Z` = nothing happens. Reload → history gone (AC #2).
  - [x] Bump `server/pyproject.toml` `0.2.3 → 0.2.4` (single source; verify live `/api/health` → `{"version":"0.2.4"}`); sync `server/uv.lock` if needed. No `/api` change → `docs/API.md` untouched; OpenAPI/schema byte-identical (`git diff --stat` empty on both).
  - [x] Update `client/src/annotations/README.md` (and the store header comment) with the Story 3.2 undo/redo section: zundo wraps the store, partialize set, one-edit-one-step rules, the keybindings.

## Dev Notes

### The command-path mental model (where 3.2 sits)

AD-7 is the canonical rule: *"every annotation change — create, move, resize, restyle, retext, delete — flows through one path: a client command stack (do/undo) → store → dirty flag → debounced autosave ... Undo/redo is client-only, in-memory, discarded on reload. No component mutates annotations outside the command path."* Built across Epic 3:

- **3.1 (done)** = the PATH: one mutation surface (the store actions) + the geometry/retext edits + edit UI. Direct mutations, NO stack.
- **3.2 (this story)** = wraps that surface with `zundo` to make it do/undo + binds `Ctrl Z` / `Ctrl Shift Z`. NO autosave, NO persistence.
- **3.3** = makes `Del`/`Backspace` delete a first-class undoable command (already deletes via the path + already group-aware; 3.2 already makes it undoable, 3.3 is the polish/AC pass).
- **3.4** = dirty flag + single-flight debounced autosave on the same surface; **3.5** = hydrate-on-open.

So in 3.2, the store ACTIONS do not change shape — zundo observes the `annotations` Map and records each transition. The whole job is (a) make zundo record exactly the right granularity (one logical edit = one step), (b) bind the keys, (c) exclude transient state.

### zundo integration (the adopt-stable choice, AP-4 / AE-1)

`zundo` 2.3.0 is the Zustand temporal middleware. Peer dep `zustand ^4.3.0 || ^5.0.0` — compatible with our `zustand 5.0.14`. It fits AR-7 exactly: client-only, in-memory, discarded on reload. Do NOT hand-roll a command stack (PREP-2 resolved to zundo in the Epic-2 retro).

Shape (illustrative — confirm exact API against the installed 2.3.0):

```ts
import { temporal } from "zundo";
export const useAnnotationStore = create<AnnotationStore>()(
  temporal(
    (set, get) => ({ /* the existing store body, unchanged */ }),
    {
      partialize: (s) => ({ annotations: s.annotations }), // ONLY the undoable slice
      limit: 100,
      equality: (a, b) => a.annotations === b.annotations,  // skip no-op sets
    },
  ),
);
```

- Imperative API: `useAnnotationStore.temporal.getState().undo() / redo() / clear() / pause() / resume()`. (`temporal` is a vanilla store hung off the main hook.) `pastStates` / `futureStates` arrays expose depth for empty-stack checks / tests.
- `partialize` is the AC-5 guard: track `{ annotations }` only. With `zustand`'s curried `create<T>()(...)` form, keep the existing generic typing — note the store currently uses `create<AnnotationStore>((set,get)=>({...}))` (non-curried). Switching to the curried `create<AnnotationStore>()(temporal(...))` form is required for the middleware; adjust the signature accordingly and keep the body identical.
- The `annotations` value is a `Map`. zundo stores the Map REFERENCE per history entry; every store action already builds a NEW Map on a real change and returns the SAME `state`/Map on a no-op, so reference-equality recording is correct AND cheap (unchanged `Annotation` objects are shared across entries — no deep clone). This is exactly why the 3.1 actions return `state` (not a fresh Map) on their no-op branches; preserve that.

### One edit, one step (the correctness core — AC #4)

zundo records one history entry per `set()` that changes the partialized state. Three places break "one logical edit = one step":

1. **Grouped create fires N sets.** `AnnotationInteraction.tsx:189` does `created.forEach(addAnnotation)` — a two-page highlight = two `addAnnotation` calls = two `set()`s = two undo steps. **Fix: a batched `addAnnotations(list)` store action that adds all in ONE `set()`**, called from the create path. This is the cleanest (vs. trying to coalesce via zundo timing). Single-mark creates stay one step either way.

2. **Per-keystroke retext.** Typing into a memo/comment calls `retextAnnotation` per keystroke → one step per character. **Recommended fix: pause/resume the temporal stack around an editing SESSION** — on textarea focus call `temporal.getState().pause()`, on blur/commit `resume()` and write one final `retextAnnotation` (or let the resume capture the net change). This yields one undo step per editing session and is robust. *Alternative:* zundo's `handleSet` with a debounce wrapper (group rapid sets within ~400ms) — simpler to wire but coalesces ANY rapid distinct edits, so it's a worse fit. **Default to pause/resume-on-focus.** Confirm in Open Questions; either way TEST it (paused → 0 entries; resume+commit → 1).

3. **Per-`pointermove` geometry — already solved in 3.1.** The move/resize gesture uses the transient `dragPreview` (excluded from history) and commits ONE `setAnnotationGeometry` on release. Do not regress this; just add a test.

### Keybindings (AC #1, #6 — AP-1 document-level)

- A NEW document-level handler. Do NOT reuse `useSelection`'s key handler: it early-returns on `e.ctrlKey` (`useSelection.ts:182`) and is gated on a current selection; undo must work with nothing selected and IS a Ctrl chord.
- Phase-gate (`phase === "ready"`), `isExempt(e.target)` (so `Ctrl Z` in a memo/comment textarea is native TEXT undo, not annotation undo — this is the right UX and falls out of the existing `isExempt` covering TEXTAREA/INPUT).
- `Ctrl Z` / `Cmd Z` → undo; `Ctrl Shift Z` / `Cmd Shift Z` → redo; `e.preventDefault()` on handled chords. Empty stack → no-op (guard on `pastStates.length` / `futureStates.length`, or just call undo/redo which no-op internally).
- Selection reconcile after undo/redo: if `selectedId` is no longer in `annotations`, `clearSelection()` (AC #5).

### Reuse map — what already exists (do NOT rebuild)

- **`store/index.ts`** (284 lines) — the mutation surface to WRAP, unchanged in shape. The doc-comments already name the zundo partialize exclusions (`selectedId`/`hoveredId`/`dragPreview`). Add `addAnnotations` (batch) here; wrap with `temporal`.
- **`annotations/gestures/shared.ts`** — `isExempt` (editable/button skip) + `GestureContext`. The undo/redo handler reuses `isExempt`.
- **`annotations/gestures/useSelection.ts`** — owns selection + the Del/Backspace delete (already group-aware via `deleteAnnotation`) + the empty-space deselect. 3.2 does NOT touch delete; it only makes the existing delete undoable (free, once zundo wraps the store). Reconcile `selectedId` after undo if it points at a removed mark.
- **`annotations/gestures/useEditGesture.ts`** — the move/resize gesture: ONE `setAnnotationGeometry` on release (transient `dragPreview` excluded). Already one-step-per-drag; preserve.
- **`annotations/AnnotationInteraction.tsx`** — the create path (`addAnnotation` call sites at :189, :290, :461, :477) and the document-level handler host. Batch the grouped create (:189) and add the undo/redo handler here (or a new `useUndoRedo` hook it consumes).
- **`annotations/create.ts`** — builds the entities (grouped two-page highlight shares one `group_id`). No change; the grouping already exists, 3.2 just commits the group atomically.

### What must NOT change (regression + boundary guardrails)

- **No contract / anchor-MODEL change.** `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` empty. zundo is client state only; no Pydantic edit, no backend change.
- **No autosave / persistence / Bank / convert / range-adjust.** Those are 3.4 / 3.5 / 3.6 / 3.7 / 3.8. Building any here is scope creep.
- **No new edit kind.** 3.2 adds the stack + keys only; the editable mutations are exactly the 3.1 set.
- **Preserve every Epic-2/3.1 interaction** (create-on-release, single-`activeTool` FSM + single-click switch, click-select/recolor/delete, arm-time color, pen draw/restroke/alpha, memo place/empty-cleanup + corner-resize, comment pin/bubble/cross-page-group, box region, drag-to-change-tool, the 3.1 edit frame move/resize + memo double-click re-edit).
- **AD-9 layering** — no upward imports; the store still imports `api/` types only. zundo wraps the store within `store/`.
- **AP-1 document-level handlers**, phase-gated, editable/buttons exempt.
- **Singleton store / doc-scope** — the store is still a singleton until 3.4 / AE-4 (doc-scope on persistence). zundo's history is the singleton's history; that is acceptable for 3.2 (in-memory, discarded on reload). Do NOT add doc-scoping here.

### Project Structure Notes

Work stays WITHIN `store/` (zundo wrap + `addAnnotations`) and `annotations/` (the undo/redo handler + the batched-create call). New optional file: `annotations/gestures/useUndoRedo.ts` + its test (mirrors the flat co-located convention). No new layer, no `anchor/` change, no `api/`/server change.

### Testing standards

- Frontend Vitest + jsdom: `cd client && npm test` (run from `client/`, loads `vite.config.ts` → jsdom; `npx vitest` from `src/` fails with `document is not defined`). jsdom zeroes `getClientRects`, so geometry uses the existing fake-card + injected `rectReader` pattern. **Crucially, undo/redo logic is store-level and fully testable in jsdom** (no geometry needed) — push the bulk of coverage into `store/index.test.ts` (temporal undo/redo, partialize, no-op equality, batch create) where it is deterministic.
- The temporal store is reachable in tests via `useAnnotationStore.temporal.getState()`. Reset it between tests (`temporal.getState().clear()` + reset the main store) so history doesn't leak across cases — add to the existing test setup/`beforeEach` if the store is shared.
- Backend pytest: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (expect green; no backend change this story).
- **DPR>1 cross-page live smoke is mandatory** (AE-5, memory `verify-on-hidpi-and-real-host`): the one-step grouped-create-undo (AC #4) is the highest-risk path and jsdom can't see cross-page geometry. Smoke a two-page highlight create + single `Ctrl Z` removing BOTH pages at DPR ≥ 1.25 on your OWN fresh servers (CLAUDE.md: never reuse the user's running server).
- Cross-model Codex review on the diff (AE-6) — caught HIGH bugs in 2.2/2.5/2.8/2.10 and a Med in 3.1.

### Versioning

PATCH +1 when 3.2 reaches done: `0.2.3 → 0.2.4`. Single source `server/pyproject.toml [project].version` → `app/version.py` → `GET /api/health` → top-bar badge. Bump once at PR merge, not per commit.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-3.2] — the 3 ACs (Ctrl Z/Ctrl Shift Z reverse via the command stack; client-only/in-memory/discarded on reload; quick-box restyle reopen is an undoable command). FR-16, AR-7, UX-DR15.
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md#AD-7] — the one command path; "Undo/redo is client-only, in-memory, discarded on reload"; "No component mutates annotations outside the command path." #AD-12 — selection decoupled from the command stack (select/clear is plain store state). #AD-9 (layering). The AR-7 row: "Annotation mutation — only via the client command stack, incl. restyle."
- [Source: .bmad/implementation-artifacts/epic-2/epic-2-retro-2026-06-30.md] — AE-1 [critical, before 3.2]: adopt `zundo` for the single client command stack (AR-7), done when 3.2 undo/redo runs on zundo, in-memory, discarded on reload. The PREP-2 → zundo resolution. AE-3 (every Epic-2 client-only edit converges on the 3.1 command path), AE-5 (DPR>1 smoke), AE-6 (Codex review), AE-7 (sandbox pytest workaround).
- [Source: .bmad/implementation-artifacts/3-1-edit-annotations-command-path.md] — the command PATH this story wraps: `setAnnotationGeometry` + transient `dragPreview` (one move/resize step per drag, exclude dragPreview from partialize), the convergence audit (no component mutates around the store), the "3.2 wraps this surface with zundo; do not pre-build 3.2" boundary.
- [Source: client/src/store/index.ts] — the mutation surface to wrap; the doc-comments already naming the zundo partialize exclusions (`selectedId`/`hoveredId`/`dragPreview`) and the no-op-returns-`state` pattern that makes reference-equality recording correct. [client/src/annotations/AnnotationInteraction.tsx:189] — `created.forEach(addAnnotation)`, the grouped-create-fires-N-sets path to batch. [client/src/annotations/gestures/useSelection.ts:182] — the existing key handler early-returns on `ctrlKey` (why undo needs its own handler) + the existing Del/Backspace delete to make undoable. [client/src/annotations/gestures/shared.ts:44] — `isExempt`.
- [Source: CLAUDE.md] — AP-1 document-level handlers (phase-gated, editable/buttons exempt), AP-2 render mock-barrel sync (N/A this story), AD-2 pin exact patches (zundo@2.3.0), versioning, "launch your OWN dev servers for live smoke," AE-7 Codex-sandbox pytest workaround.
- Memories: `prefer-stable-solutions` (adopt zundo, don't hand-roll), `verify-on-hidpi-and-real-host` (cross-page undo at DPR>1), `held-key-state-reset-on-blur` (N/A for a discrete chord, but keep the handler clean).
- zundo 2.3.0: npm `zundo` (peer `zustand ^4.3.0 || ^5.0.0`); imperative API `useAnnotationStore.temporal.getState().{undo,redo,clear,pause,resume}` + `pastStates`/`futureStates`; options `partialize`, `limit`, `equality`, `handleSet`. Confirm exact signatures against the installed package (or context7 `zundo` docs) before wiring.

## Open Questions

> Saved for the dev/PO; each has a recommended default so work is not blocked.

1. **Text re-edit coalescing mechanism.** Recommended default: **pause/resume the temporal store on memo/comment textarea focus/blur** so an editing session is one undo step (vs. a `handleSet` debounce that would also coalesce unrelated rapid edits). Confirm before building; either way, one editing session must = one undo step (AC #4).
2. **Redo key alternatives.** `Ctrl Shift Z` / `Cmd Shift Z` are required (UX-DR15). Recommended default: ALSO accept `Ctrl Y` (Windows-common redo). Drop it if the PO prefers a single redo chord.
3. **History `limit`.** Recommended default: 100 entries (cheap — shared Annotation objects across Map snapshots). Confirm; lower it only if a memory concern surfaces.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
