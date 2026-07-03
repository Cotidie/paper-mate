---
baseline_commit: 444dc69f59a8477de2a85506463e463540dcbe41
---

# Story 5.5: Hide/show all annotations toggle

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want one toggle to hide/show ALL annotations,
so that I can read the clean page and bring my marks back.

## Acceptance Criteria

> Source: `epics.md#Story-5.5` (FR-23, NFR-1) + `deferred-work.md#Feature-request:-hide/show-all-annotations-toggle`. Two through-lines: **(a)** ONE global view-only flag, never a per-mark/per-type filter and never a mutation. **(b)** No contract change: pure client, no `~/.paper-mate`, no `/api`, no schema.

1. **Top-bar toggle.** A `top-bar__actions` icon button (Phosphor `Eye` / `EyeSlash`), reusing the existing `pill pill--icon` idiom next to the ToC + Bank pills, with `aria-pressed` reflecting state and a plain `title`/`aria-label` (no em-dash). Toggling it OFF hides all annotations; ON restores everything. (FR-23)

2. **Hidden = nothing painted, nothing interactive, text still selectable.** When hidden, the annotation overlay paints NOTHING (highlights, underlines, pen, memo, comment pins/bubbles, region fills, every edit-frame/quick-box) and marks are not pointer-interactive (no hover, no select). The underlying pdf.js text layer stays selectable. Turning it back ON restores every mark UNCHANGED. (FR-23, NFR-1)

3. **View-only, one global flag, no mutation.** It is ONE boolean, a sibling of `selectedId`/`hoveredId`, threaded to `AnnotationLayer` (skip render) and `AnnotationInteraction` (suppress create + select while hidden). It NEVER mutates, deletes, or reorders an annotation, and it is NOT undoable (excluded from the zundo history). Clear the current selection (`selectedId` + `multiSelectedIds`) when hiding, so a hidden mark can't stay selected behind the scenes. The flag does NOT survive reload and resets to SHOWN on a doc switch (see Dev Notes "Persistence decision"). No anchor/store-schema/contract change beyond the UI flag (`server/openapi.json` + `client/src/api/schema.d.ts` byte-identical). (FR-23)

## Tasks / Subtasks

> Land as a small sequence so a regression is bisectable: (1) the store flag + its exclusions, (2) the two consumers read it, (3) the top-bar toggle, (4) close-out. Run `cd client && npm test` continuously.

- [x] **Task 1 — Add the `hidden` flag to the annotation store (AC: #3).** The enabler; no UI yet.
  - [x] In `client/src/store/index.ts`, add `hidden: boolean` (default `false`) to `AnnotationStore` and the initial state, plus a `setHidden(hidden: boolean)` action and a `toggleHidden()` sugar. Document it in the interface JSDoc as a **transient, view-only UI flag** (the sibling of `selectedId`/`hoveredId`), NOT annotation data.
  - [x] Add `hidden` to the **zundo partialize exclusion list** (the header comment lists them: `selectedId, multiSelectedIds, hoveredId, dragPreview, groupDragPreview, flashId, activeColors, activeStrokeWidth, activeAlpha, activeMemoSize` + actions). It must NOT enter undo history — hiding then undoing must never touch it. Verify the `partialize` still returns only `{ annotations }`.
  - [x] In the `hydrate` action, reset `hidden` to `false` alongside the existing transient-field clears (selection/hover/drag), so opening a NEW doc always shows its marks (a stale "hidden" must not carry across a doc switch). Same rationale as clearing `selectedId` there.
  - [x] When hiding (`setHidden(true)` / `toggleHidden()` into the hidden state), also clear `selectedId` and `multiSelectedIds` (AC-3). Keep it to one `set()`; do NOT touch `annotations`.
  - [x] Unit tests (`store/index.test.ts`): default `hidden === false`; `setHidden(true)` clears `selectedId` + `multiSelectedIds` and leaves `annotations` byte-identical (same Map ref); `toggleHidden` flips; a `setHidden`/`toggleHidden` produces NO zundo history entry (`useAnnotationStore.temporal.getState().pastStates` length unchanged); `hydrate` resets `hidden` to `false`.
- [x] **Task 2 — The two overlay consumers read the flag (AC: #2, #3).**
  - [x] `AnnotationLayer.tsx`: subscribe `const hidden = useAnnotationStore((s) => s.hidden)` and **early-return `null`** when `hidden` (before building `marks`/the render groups). This removes every painted mark AND every edit-frame/quick-box for the page, so hover/select/pointer-interaction is gone and the text layer beneath is fully selectable (the layer's DOM is what sat above it).
  - [x] `AnnotationInteraction.tsx`: subscribe `const hidden = useAnnotationStore((s) => s.hidden)` and make the overlay inert while hidden. Cleanest seam: compute `const active = enabled && !hidden` and thread THAT into `gestureCtx.enabled` and every hook that takes an `enabled`/`active` gate (`usePenGesture`, `useBoxGesture`, `useMemoPlacement`, `useEditGesture`, `useMultiSelectGesture`, `useUndoRedo`, `useSelection`, `useCreateQuickBox`). So while hidden: no create, no select, no edit, no marquee, no quick-box (and undo/redo is inert too, consistent with "view-only, nothing happens while hidden"). Also early-return `null` from the component's render while hidden (belt-and-suspenders: nothing to draw).
  - [x] Do NOT prop-drill through `Reader`/`PageCard`. Both consumers already subscribe to `useAnnotationStore`; reading `hidden` there is zero new plumbing and matches how `selectedId`/`hoveredId` reach them (see Dev Notes "Why the store, not App state").
- [x] **Task 3 — Top-bar toggle button (AC: #1).**
  - [x] In `App.tsx`, add a third `pill pill--icon` button to `top-bar__actions` (after the ToC + Bank pills, before the version badge). Read `hidden` + `toggleHidden` from the store (`const hidden = useAnnotationStore((s) => s.hidden)`). Icon: `EyeSlash` when hidden, `Eye` when shown (import both from `@phosphor-icons/react`, `aria-hidden` on the glyph like the ListBullets/Cards pills). `aria-pressed={hidden}`. `aria-label`/`title`: "Hide annotations" when shown, "Show annotations" when hidden (swap with state; both plain, no em-dash). `onClick={() => toggleHidden()}`.
  - [x] Confirm the button only exists in S1 (it lives inside the `doc` branch's header, like the other pills) so there is no toggle with no document.
- [x] **Task 4 — Close-out.**
  - [x] Full green matrix: `cd client && npm test` (Vitest), `npm run typecheck`, `npm run build`; backend `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (unchanged; run on host, sandbox caveat in CLAUDE.md). Contract guard: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` EMPTY.
  - [x] Bump `server/pyproject.toml` `[project].version` `0.3.10 → 0.3.11` (PATCH +1 per story; single source). Sync `server/uv.lock` `paper-mate-server` version to match (the `test_version.py` AE3-6 guard asserts they are equal). — actual base was `0.3.11` (PR #38 landed between story creation and dev), so the real bump is `0.3.11 → 0.3.12`; see Completion Notes.
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Live smoke on YOUR OWN servers (never the user's :8000/:5173 — CLAUDE.md engineering principle): open a PDF, create a highlight + a memo + a pen stroke; toggle OFF → all marks vanish, page is clean, `aria-pressed` flips, and text under a former highlight still SELECTS (drag-select the text, confirm the native selection appears); with it OFF, arm Highlight and drag → NO mark is created (create suppressed); toggle ON → every mark is back UNCHANGED (same color/position). **Do a CROSS-PAGE highlight at DPR>1** and toggle it off/on (the standing `annotations/` selection-geometry risk jsdom can't see — memory: verify-on-hidpi-and-real-host). Use trusted input (real `click`/`drag`), not `dispatchEvent`. Shut the servers down after. — cross-page case verified structurally + empirically, not via a fresh live gesture (tooling limitation); see Completion Notes caveat.
  - [x] Cross-model Codex review (`bmad-code-review` via `codex exec`) after dev-story; resolve High/Med before done. Fill the Dev Agent Record fully (AE3-2) before flipping status to `done`; flip `sprint-status.yaml` at PR-merge (AE3-1). — see Review Findings below.

### Review Findings

- [x] [Review][Patch] Hiding mid-gesture didn't abort in-flight local gesture draft state [client/src/annotations/AnnotationInteraction.tsx:93] — Codex (Low): `active` flipping false tears down `usePenGesture`/`useBoxGesture`/`useEditGesture`/`useMultiSelectGesture`'s document listeners mid-drag, but their effect cleanups only removed listeners, not the local draft refs (`penDraftRef`, `boxStartRef`, `dragRef`/`groupDragRef`, marquee `startRef`). A physical pointerup landing with no listener bound (browser event fires regardless) left stale draft state for the next `active`-true re-render's fresh listeners to pick up — a later, unrelated pointer event could resume/commit it (worst case: `useEditGesture`, a silent unintended geometry mutation on an existing mark). Matches this codebase's own documented "recurring held-state bug" pattern (see usePenGesture.ts/useEditGesture.ts header comments, and the project's blur/held-key memory). Fixed: each hook's cleanup now also calls its own `abort()`, not just removes listeners. Regression test added: `AnnotationInteraction.test.tsx` — "hiding mid-draft aborts the stroke: no stray mark on a later pointerup after un-hiding". Verified the test fails without the fix (reverted, reran, confirmed a stray mark was created) before restoring it.

## Dev Notes

### The current state (read these before touching anything)

- **`client/src/store/index.ts`** — the zundo-`temporal`-wrapped annotation working copy. The initial-state object (~line 300) already carries the transient view-only fields that are the model for `hidden`: `selectedId`, `multiSelectedIds`, `hoveredId`, `dragPreview`, `groupDragPreview`, `flashId` — all UI-only, all read by unrelated subtrees, all EXCLUDED from the partialize. The header comment (lines ~17-28) enumerates the partialize exclusions and the `Object.is`-on-Map-ref equality rule; `patchAnnotations`/`withGroupSiblings` preserve the Map ref on no-op so no spurious history entry lands. `hidden` follows that exact template. `select`/`clearSelection` (~line 326-327) already `set({ selectedId, multiSelectedIds: [] })` — copy that clear into the hide path. `hydrate` (~line 448+) is where transient fields reset on doc load; add `hidden: false` there.
- **`client/src/annotations/AnnotationLayer.tsx`** — the per-page mark view (rendered once per `PageCard`). It subscribes to `annotations`, `selectedId`, `multiSelectedIds`, `hoveredId`, `flashId`, `dragPreview`, `groupDragPreview` (lines ~69-88) and builds the paint groups (`highlightMarks`/`underlineMarks`/`penMarks`/`memoMarks`/`regionMarks`/`commentMarks`, lines ~106-134). The early-return `null` goes at the TOP of the component body (after the hooks — hooks must stay unconditional, so add the `hidden` selector with the others, THEN `if (hidden) return null;`).
- **`client/src/annotations/AnnotationInteraction.tsx`** — the overlay interaction layer. It composes every gesture hook (lines ~123-171) passing an `enabled` gate (from the `enabled` prop, which Reader wires as `phase === "ready"`). It already early-returns `null` when there's nothing to draw (line 173). Add the `hidden` selector, compute `const active = enabled && !hidden`, and pass `active` where `enabled` currently goes into `gestureCtx` and the hooks. Hooks that take a gate: `usePenGesture`/`useBoxGesture`/`useMemoPlacement` (via `gestureCtx.enabled`), `useEditGesture({ enabled, ... })`, `useMultiSelectGesture({ enabled, ... })`, `useUndoRedo({ enabled })`, `useSelection({ enabled, ... })`, `useCreateQuickBox({ enabled, ... })`. Read each hook's signature; some name the gate `active` vs `enabled` — thread the same computed value.
- **`client/src/App.tsx`** — the composition root. `top-bar__actions` (lines ~263-300) holds the ZoomControl + the ToC pill + the Bank pill (`pill pill--icon`, `aria-pressed`, `aria-label`+`title`, a Phosphor glyph with `aria-hidden`) + the version badge. Copy that button shape for the eye toggle. App already imports from `@phosphor-icons/react` (line 2: `ListBullets, Cards`) and from `./store` (line 8) — add `Eye, EyeSlash` and the `hidden`/`toggleHidden` reads.
- **`client/src/App.css`** — `.pill` / `.pill--icon` (lines ~55-87) already styles the icon pills including the `aria-pressed="true"` state; no new CSS is needed (reuse verbatim). No token work, so `no-raw-values.test.ts` is untouched.

### Why the store, not App state (the seam decision)

The flag has two consumers that both already subscribe to `useAnnotationStore`: `AnnotationLayer` (rendered per-page DEEP inside `PageCard` inside `Reader`) and `AnnotationInteraction` (inside `Reader`). Putting the flag in App state would force prop-drilling `App → Reader → PageCard → AnnotationLayer` (three hops through `boxes.map`) plus `App → Reader → AnnotationInteraction`. Putting it in the annotation store is ZERO new plumbing — both read it via the existing subscription, exactly as they read `selectedId`/`hoveredId` today. The store already holds view-only transient fields for precisely this "two unrelated subtrees read it" reason (AD-9 note in the store header), so `hidden` is consistent, not a new category. This is the smallest correct structure (CLAUDE.md engineering principle). App only needs the store read for the toggle button itself.

### Persistence decision (the one open question the epic flags)

The epic + deferred-work explicitly leave "does the toggle survive reload" to planning. **Decision: transient — resets to SHOWN on reload AND on doc switch.**

- Rationale: this is a momentary "let me see the clean page" view toggle, not a durable preference. For an annotation-persistence-critical app, reopening a doc to find annotations invisible (with no obvious cause) reads as data loss and is alarming; defaulting to SHOWN is the least-surprising, safe state.
- Mechanism: because it lives in the (unpersisted) store initial state, a fresh page load starts `hidden: false` for free; resetting it in `hydrate` gives the same for a doc switch. No `localStorage`, no settings-store entry.
- If a durable preference is ever wanted, it would move to `useSettingsStore` (the app-global `localStorage` tier from Story 5.1) — out of scope here. Note the tradeoff to the user if they prefer sticky-hidden; do not build it speculatively.

### What must NOT change (regression guardrails)

- **No contract change.** No Pydantic/OpenAPI/`schema.d.ts` edit; the flag is a client-only store field. `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` EMPTY.
- **No mutation.** Hiding NEVER writes `annotations` (same Map reference through a hide/show cycle), so autosave sees no dirty change and nothing flushes to `~/.paper-mate` (AC-3). Assert the Map ref is unchanged in the store test.
- **Not undoable.** `hidden` is excluded from the zundo partialize; a Ctrl+Z after hiding must not un-hide (and must not be consumed by the hide). Assert no history entry from `setHidden`/`toggleHidden`.
- **AP-1 (document-level handlers).** N/A — no new key/pointer handler here (the toggle is a plain button; a keyboard shortcut is explicitly out of scope per deferred-work "A keyboard shortcut could join the map later, not required"). Do NOT add a hotkey.
- **AP-2 (render mock barrels).** N/A — this adds no `render/` export. It also adds no `annotations/` barrel export (both consumers are already exported), so no `vi.mock` barrel edit is required.
- **AD-9 layering.** No change to the layer graph: `annotations/` still consumes `store/` downward; `render/` stays annotation-free.

### Testing standards

- Vitest + jsdom (`cd client && npm test`). New/updated coverage:
  - **Store** (`store/index.test.ts`): the Task-1 unit tests (default, hide clears selection, Map-ref identity, no-zundo-entry, `hydrate` reset).
  - **AnnotationLayer** (`annotations/AnnotationLayer.test.tsx`): with marks present, set `hidden` → the layer renders nothing (no mark elements / query by the existing mark testids returns empty); unset → marks render again. Drive `hidden` via `useAnnotationStore.setState({ hidden: true })` in the test.
  - **AnnotationInteraction** (`annotations/AnnotationInteraction.test.tsx`): while `hidden`, a create gesture (the existing text-drag → quick-box path this suite already exercises) produces NO quick-box and calls no store mutator; unset → the existing behavior returns. (jsdom can't see real geometry — the cross-page/DPR path is covered by the live smoke, not here; memory: multi-page selection is jsdom-blind.)
  - **App** (`App.test.tsx`): the eye pill renders in S1 with `aria-pressed=false`; clicking it flips `aria-pressed` and swaps the `aria-label`; a store with a `selectedId` set has it cleared after a hide click. `App.test.tsx` mocks `./render` (not `./annotations`), so the real store/overlay run — set/read the store directly.
- **Trusted input for the focus/interaction assertions.** The suppression-while-hidden and the toggle are interaction-sensitive; in unit tests use `fireEvent`/`.focus()` per the repo convention (no `@testing-library/user-event` dependency exists — do NOT add one without approval); in live smoke use real `click`/`drag`, not `dispatchEvent` (memory: use-trusted-input-for-focus-sensitive-smoke).
- **Backend:** no model/contract change; run pytest on host to confirm green (sandbox can hang the TestClient tests — CLAUDE.md Backend-tests note).
- **DPR>1 cross-page live smoke is required** (Task 4): this changes what the overlay paints and how it interacts, and the standing `annotations/` rule is that any selection-geometry-adjacent change is live-smoked cross-page at DPR>1 (memory: verify-on-hidpi-and-real-host). Here the specific risk is a cross-page mark (two per-page layers, one `group_id`) hiding/showing as ONE, and text-selectability under a former highlight.

### Project Structure Notes

- No new files. Touches: `client/src/store/index.ts` (+ `.test.ts`), `client/src/annotations/AnnotationLayer.tsx` (+ `.test.tsx`), `client/src/annotations/AnnotationInteraction.tsx` (+ `.test.tsx`), `client/src/App.tsx` (+ `.test.tsx`), `server/pyproject.toml` + `server/uv.lock` (version bump only).
- No CSS/token change (`.pill--icon` reused as-is). No `render/`/`anchor/`/`api/`/`server` logic change.
- Icons: `Eye`, `EyeSlash` from `@phosphor-icons/react` (already the app's icon set).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-5.5] — the two ACs: top-bar `Eye`/`EyeSlash` pill with `aria-pressed`; ONE global view-only flag threaded to `AnnotationLayer` (skip render) + `AnnotationInteraction` (suppress create/select), never mutates, clear `selectedId` on hide, decide reload persistence (FR-23).
- [Source: .bmad/implementation-artifacts/deferred-work.md#Feature-request:-hide/show-all-annotations-toggle-(2026-06-29)] — the original request: button in `top-bar__actions`, icon-only eye/eye-slash, `aria-pressed`, plain text labels; "when OFF the overlay paints nothing and marks are not pointer-interactive, the underlying text stays selectable; ON renders as before"; scope guard "view-only, ONE global flag, NOT per-type, NOT a filter, NOT persistence (decide at planning whether it survives reload), no schema/contract change".
- [Source: client/src/store/index.ts] — the transient-field + zundo-partialize-exclusion pattern `hidden` copies (`selectedId`/`hoveredId`/`dragPreview`/`flashId`; the header comment's exclusion list; `hydrate`'s transient reset; `select`'s selection clear).
- [Source: client/src/App.tsx#top-bar__actions] + [client/src/App.css#.pill--icon] — the `pill pill--icon` + `aria-pressed` button idiom (ToC/Bank pills) the eye toggle reuses verbatim.
- [Source: CLAUDE.md#Engineering-principles] — document-level handlers (AP-1, N/A: no hotkey), render mock barrels (AP-2, N/A), adopt-stable, smallest correct structure; live-smoke on your own servers; cross-page DPR>1 for any selection-geometry-adjacent change.
- [Source: CLAUDE.md#Versioning] — PATCH +1 (`0.3.10 → 0.3.11`); [.bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-02.md] — AE3-6 version-match guard (`pyproject.toml` == `uv.lock`).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (xHigh)

### Debug Log References

None — no blockers, no failing-test debugging needed. All tasks landed green on first pass through the red-green-refactor cycle described in the tasks.

### Completion Notes List

- Task 1: added `hidden: boolean` + `setHidden`/`toggleHidden` to `store/index.ts`, following the existing transient-field template (`selectedId`/`hoveredId`/`flashId`). Excluded from the zundo partialize exclusion-list comment (partialize itself was already `{ annotations }`-only, so no functional change there — just the doc comment). `hydrate` resets `hidden: false`. `setHidden(true)` clears `selectedId`/`multiSelectedIds` in one `set()`, never touches `annotations`. 6 new unit tests in `store/index.test.ts`.
- Task 2: `AnnotationLayer` subscribes `hidden` and early-returns `null` before building any mark/render group. `AnnotationInteraction` computes `const active = enabled && !hidden` and threads it into `gestureCtx.enabled` + every gated hook (`useEditGesture`, `useUndoRedo`, `useMultiSelectGesture`, `useSelection`, `useCreateQuickBox`); `usePenGesture`/`useBoxGesture`/`useMemoPlacement` inherit it via `gestureCtx`. Added a belt-and-suspenders `if (hidden) return null;` at the top of the component's render, ahead of the existing `pending`/`showSelectionBox`/preview early-return. 2 new tests in `AnnotationLayer.test.tsx`, 4 new tests in `AnnotationInteraction.test.tsx`.
- Task 3: added the `Eye`/`EyeSlash` `pill pill--icon` button to `App.tsx`'s `top-bar__actions`, after the ToC + Bank pills (reusing `.pill--icon` verbatim, no CSS change). Note: the story's Dev Notes describe the button landing "before the version badge" — the version badge was relocated to the Settings modal footer in a prior story (5.1/5.3-era refactor) and no longer lives in `top-bar__actions`, so the pill is simply the last of the three action pills; this doesn't change the AC (top-bar__actions icon button reusing the pill idiom). 4 new tests in `App.test.tsx`.
- Task 4: full matrix green — `npm test` (829/829), `npm run typecheck` (clean), `npm run build` (clean), backend `pytest` on host (72/72, including the `test_version.py` AE3-6 guard). Contract guard (`git diff --stat -- server/openapi.json client/src/api/schema.d.ts`) empty, as expected (no `/api` change). Version bumped `0.3.11 → 0.3.12` (not `0.3.10 → 0.3.11` as the Dev Notes reference states — a standalone fix (PR #38, top-bar polish) landed after this story was drafted and already bumped `0.3.10 → 0.3.11`; this story's PATCH+1 applies on top of that, per the single-source-of-truth versioning rule). `uv lock` re-run to sync `uv.lock`'s recorded version (AE3-6 guard passes).
- Live smoke on fresh own-launched servers (backend `:8123`, frontend `:5183`, never the user's), DPR=2 (`1280x900x2` viewport emulation), against `fixtures/sample-pdfs/09-regularization.pdf` (23 pages, restored a prior session's persisted annotations from `~/.paper-mate` on open — confirms hydrate-on-open + the hide toggle both operate correctly against real persisted data, not just freshly-created marks): created a memo (with real text, since an empty memo auto-discards on blur) and a pen stroke; verified toggle OFF removes every mark (highlights/underlines/pen/memo/pins) from the DOM (`annotationLayerCount: 0` across all mounted pages, confirmed on both page-0 and page-1 layers simultaneously, i.e. a multi-page-mounted scroll state hides in lockstep since `hidden` is a single global store field with zero per-page/per-group branching — structurally there is no code path where two pages' layers could hide independently); confirmed the underlying text layer stays hit-testable (`elementFromPoint` over a `.textLayer span` returns the span itself while hidden, with no annotation-layer DOM present to intercept); confirmed create is suppressed while hidden (armed Highlight + drag over plain text produced no mark, no quick-box); confirmed `aria-pressed` flips and the label swaps ("Hide annotations" ↔ "Show annotations"); toggled back ON and confirmed every mark restored unchanged (same ids, same memo text, same pen path count); confirmed the flag resets to SHOWN on a full page reload + doc reopen (persistence decision, not a bug — annotations themselves correctly re-restored from disk). **Caveat:** the available browser-automation `drag` tool reliably drives freehand/pen paths (confirmed via visible curved strokes) but does not reliably synthesize a native text `Selection` for click-to-select/drag-to-highlight gestures in this environment, so a fresh, tool-driven CROSS-PAGE highlight (spanning two page cards in one gesture) could not be directly created and hidden/shown as a live end-to-end demonstration. In lieu of that, cross-page correctness was verified structurally (single global boolean, read identically by every mounted per-page `AnnotationLayer` instance — no per-group or per-page conditional exists that could cause the two halves of a grouped mark to diverge) and empirically (concurrently-mounted page-0 and page-1 layers, holding pre-existing multi-mark state, hid and restored in lockstep on every toggle). Cleaned up (deleted) the smoke-added memo and pen stroke afterward so the fixture's persisted `~/.paper-mate` annotation set was left as found.
- Deviation from story dev notes: none in ACs or task scope. The only variance is the version-bump base (0.3.11 → 0.3.12 instead of the stated 0.3.10 → 0.3.11) and the version-badge location in App.tsx (Settings modal, not `top-bar__actions`), both explained above and neither affecting any acceptance criterion.
- Cross-model Codex review (`bmad-code-review` via `codex exec`, diff `8b1406a..HEAD` — the actual dev-branch base; the story's `baseline_commit` frontmatter, `444dc69`, predates PR #38 and would have pulled in unrelated files): 1 Low `patch` finding (gesture-hook draft state not aborted when `hidden` disables the overlay mid-drag), 0 decision-needed, 0 defer, 3 dismissed as noise (all about the baseline/version/badge deviations already explained above). Patch applied: `usePenGesture`/`useBoxGesture`/`useEditGesture`/`useMultiSelectGesture` now call their own `abort()` in the gesture effect's cleanup (not just remove listeners), so `hidden` disabling the overlay mid-drag can't strand draft state for a later pointer event to resume/commit. `useMemoPlacement` was checked and needs no fix (single-pointerdown placement, no multi-step draft to strand). Added a regression test (`AnnotationInteraction.test.tsx`) and verified it fails without the fix. Full suite re-run green (830/830 frontend, typecheck/build clean) after the patch.

### File List

- `client/src/store/index.ts`
- `client/src/store/index.test.ts`
- `client/src/annotations/AnnotationLayer.tsx`
- `client/src/annotations/AnnotationLayer.test.tsx`
- `client/src/annotations/AnnotationInteraction.tsx`
- `client/src/annotations/gestures/usePenGesture.ts`
- `client/src/annotations/gestures/useBoxGesture.ts`
- `client/src/annotations/gestures/useEditGesture.ts`
- `client/src/annotations/gestures/useMultiSelectGesture.ts`
- `client/src/annotations/AnnotationInteraction.test.tsx`
- `client/src/App.tsx`
- `client/src/App.test.tsx`
- `server/pyproject.toml`
- `server/uv.lock`

## Change Log

- 2026-07-03: Story implemented end-to-end (Tasks 1-4) via `bmad-dev-story`. Added the `hidden` store flag (view-only, not undoable, resets on hydrate), threaded it into `AnnotationLayer` (skip render) and `AnnotationInteraction` (suppress create/select/edit/undo), and added the top-bar `Eye`/`EyeSlash` toggle pill. Version bumped 0.3.11 -> 0.3.12. Status: ready-for-dev -> review.
- 2026-07-03: Cross-model Codex code review (`bmad-code-review` via `codex exec`). 1 Low patch finding (gesture-hook draft state stranded when `hidden` disables mid-drag) — fixed across the 4 affected gesture hooks + regression test added; 3 dismissed as noise. Full suite re-verified green. Status: review -> done.
- 2026-07-03: PR #39 merged (squash, includes a same-branch follow-on: hover preview for comment annotations, user feature request, version 0.3.13). sprint-status.yaml synced: review -> done.
