---
baseline_commit: 85945fb61a414eb85353e23a78ba3c81943bd51a
---

# Story 2.4: Unify tool state (single activeTool FSM)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want exactly one tool active at a time,
so that arming a tool never lets another (pan) swallow my gesture and the rail always shows one active tool.

> **This is a REFACTOR, not a feature.** No new user-visible tool, no new mark, no anchor/store/contract change. The visible behavior after this story must match the behavior at the end of Story 2.3 (which already mutually-excludes pan and highlight via a surgical patch). What changes is the *internal model*: Story 2.3 left two orthogonal fields — `mode: ToolMode` (cursor/hand/box, drives pan) and `armedTool: AnnotationTool | null` (drives marks) — kept in sync by a hand-written cross-setter (the "2.3 surgical mutual-exclusion patch"). This story replaces both with **one `activeTool` finite-state model** where mutual exclusion is true *by construction*, and reconciles Story 2.2's overlay machine so it is driven by that one model instead of a parallel arm/disarm copy. [AD-11, Epic-1 retro PREP-3]
>
> **Why now (sequencing):** every remaining tool story (2.6 underline, 2.7 pen, 2.8 memo, 2.9 comment, 2.11 box-select drag) arms a tool and pops a quick-box. If they each re-add the orthogonal `mode`+`armedTool` pattern, the Story 2.3 "pan eats the drag" bug recurs five times. Landing the unified FSM first means those stories add one button + one behavior on a model that already guarantees one-tool-at-a-time. Story 2.5 (select-highlight) also depends on this single model for cross-mode click-select.

## Scope boundary — READ FIRST

**IN (this story):**
- A **single `activeTool` model** that is the one source of truth for which tool is active across BOTH pointer tools (cursor / hand / box) and annotation tools (highlight / underline / pen / memo / comment). Mutually exclusive by construction. Replaces App's `mode: ToolMode` + `armedTool: AnnotationTool | null` and removes the 2.3 surgical cross-setter. [AD-11]
- **Reconcile the Story 2.2 overlay machine** (`annotations/machine.ts`): its transient quick-box lifecycle (`empty/annotating/pending`) stays, but the armed annotation tool it carries is **derived from `activeTool`** (one writer), not maintained as a separate arm/disarm lifecycle that App mirrors. [PREP-3]
- **Single-click tool switch from the rail** (AC4): clicking a rail tool button commits the switch in one click; switching tools never opens another tool's quick-box / sub-toolbox in place of the switch. Concretely: with Highlight armed, clicking the pointer (cursor) button switches to cursor in ONE click (today it only opens the flyout).
- **Re-derive the Reader's pan + overlay inputs from `activeTool`:** `panArmed = activeTool === "hand"`; the overlay's armed annotation tool = `activeTool` when it is an annotation tool, else `null`. The Reader and overlay keep their current prop shapes (no Reader-internal logic change).
- **Hotkeys for the tools that exist today** route through the single setter: `V`/`Esc` → `cursor`, `H` → `highlight` (preserved from 2.3), plus the rail's hand/box. The `activeTool` *type* includes the future tools (underline/pen/memo/comment) so the FSM is complete, but their keys + buttons + behavior land in their own stories (see OUT).
- **FSM transition unit tests** (the new model + its guards), plus updating every existing test that referenced the old `mode`/`armedTool` two-field shape.

**OUT (later stories — do NOT build):**
- **Arm-time color quick-pick** (show the swatch row when a color tool is *armed*, to pick the default color before drawing) → **Story 2.6**. This story does NOT add an on-arm picker; the swatch row still only appears as the post-create recolor (2.3), unchanged. AC4 forbids a tool's quick-box opening "in place of the switch" precisely so 2.6 can add the on-arm picker without re-introducing the bug.
- **Select-a-highlight** (hit-test, `selectedId`, recolor/delete an existing mark) → **Story 2.5** (AD-12). No selection state here.
- **New tools' behavior** — underline (2.6), pen (2.7), memo (2.8), comment (2.9). Do NOT add their rail buttons, hotkeys, or create paths. Only reserve them in the `activeTool` union type.
- **box-select drag behavior** → **Story 2.11**. `box` remains armable (it sets `activeTool`) but its drag still does nothing this story, exactly as today.
- Any **anchor / store / Pydantic / endpoint / generated-type change**. This is a client-internal refactor confined to the App/ToolRail pointer-tool layer + `annotations/` overlay. `render → anchor → annotations → store → api` layering is preserved (AD-9).

## Acceptance Criteria

1. **One `activeTool` source of truth, mutually exclusive by construction (AD-11).** Given the reader is ready, a single `activeTool` value of type `"cursor" | "hand" | "box" | "highlight" | "underline" | "pen" | "memo" | "comment"` is the one source of truth for the active tool. It replaces App's separate `mode: ToolMode` and `armedTool: AnnotationTool | null` and removes the Story 2.3 surgical cross-setter (the code that, on arming a tool, force-set `mode="cursor"`, and on picking a pointer sub-mode cleared `armedTool`). Setting `activeTool` to any value implicitly disarms the previous — no second field can hold a stale tool. [Source: ARCHITECTURE-SPINE.md#AD-11; sprint-change-proposal-2026-06-29-tool-fsm.md §4.1; epics.md#Story-2.4 AC1]

2. **Arming any tool disarms the previous; exactly one rail button reads active (AP-1).** Given a tool is active, when another is armed via the rail or a (currently-wired) hotkey (`V`/`Esc` → cursor, `H` → highlight), the previous disarms and exactly one rail button shows the active/armed state — the pointer button reads active in plain cursor/hand/box mode (the 2.3 #3 fix, preserved), an annotation button reads armed when its tool is active. The `H`/`V`/`Esc` handlers stay bound at `document` level, phase-gated (`docOpen`), exempting `INPUT`/`TEXTAREA`/`SELECT`/`BUTTON`/`contentEditable` and ignoring Ctrl/Alt/Meta chords — unchanged from 2.3. [Source: ARCHITECTURE-SPINE.md#AD-11; CLAUDE.md#Engineering-principles (document-level handlers); 2-3 AC1; epics.md#Story-2.4 AC2]

3. **The overlay quick-box machine is driven by the same model, not a parallel one (PREP-3).** Given the `annotations/` overlay, its transient lifecycle (`empty/annotating/pending`, drag-release → quick-box → dismiss) is preserved, but the armed annotation tool it carries is derived from the single `activeTool` (App passes the annotation-tool-or-null down exactly as 2.3 did via `armedTool`). The machine no longer keeps an independent arm/disarm tool lifecycle that App separately mirrors; there is one writer of "which annotation tool is armed." The 2.2 sticky-after-mark behavior and the disarm-while-pending selection-clear (2.3 re-pop fix) are preserved. [Source: ARCHITECTURE-SPINE.md#AD-11; Epic-1 retro PREP-3; 2-2 AC7; 2-3 Review-Findings re-pop fix]

4. **A rail click switches the tool in a single click and never opens a sub-toolbox in place of the switch (AD-11).** Given Highlight is armed, when the user clicks the pointer (cursor/selection) rail button, `activeTool` switches to `cursor` in ONE click and the rail reflects it immediately; no tool's quick-box / sub-toolbox opens instead of the switch. (Today the pointer button only opens its flyout, so switching from Highlight back to cursor takes an extra step — this fixes the Story 2.3 live-smoke single-click-switch issue.) The pointer flyout (choosing among cursor/hand/box) remains reachable as a secondary gesture; see Dev Notes "Single-click switch + the pointer flyout." [Source: ARCHITECTURE-SPINE.md#AD-11 (single-click-switch rule); sprint-change-proposal-2026-06-29-select-highlight.md (AC added to 2.4); epics.md#Story-2.4 AC4]

5. **No regression; pan derives from the FSM (NFR-1, NFR-3).** Given the unified model, all prior behavior holds: highlight-on-drag (2.3) still lands a mark and recolors; the page never reflows (NFR-1); pan works whenever `activeTool === "hand"` (and hold-`Space` temp-pan is unchanged — it is Reader-internal and independent of `activeTool`); box arms without panning or annotating (its drag is still Story 2.11); zoom/scroll unaffected; a highlight created at one zoom stays glued across zoom (NFR-3). The Reader's `panArmed` derives from `activeTool === "hand"`. All existing frontend + backend tests pass after being updated to the new model; FSM transition unit tests are added. [Source: epics.md#Story-2.4 AC5; ARCHITECTURE-SPINE.md#AD-4; NFR-1/NFR-3]

6. **Layering + contract preserved (AD-9, AD-3).** Given the refactor, the downward dependency `render → anchor → annotations → store → api` is unchanged: the `activeTool` model + rail live in the App/ToolRail pointer-tool layer and only pass an annotation-tool-or-null down to `annotations/`; no new `anchor/`/`render/` math; `store/` and the Pydantic models are untouched, so `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical. `no-raw-values.test.ts` stays green (no inline hex/px outside `theme/**`). No new `render/index.ts` export → both `vi.mock("./render")` barrels untouched (AP-2). [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3; CLAUDE.md#Engineering-principles (render-mock barrels)]

## Tasks / Subtasks

- [x] **Task 1 — Define the canonical `activeTool` union + guards (AC: 1, 6)**
  - [x] Add a small leaf module `client/src/tools.ts` (zero imports — pure types/consts, so both the App layer and `annotations/` can import it without violating the downward layer rule). Export:
    - `type ActiveTool = "cursor" | "hand" | "box" | "highlight" | "underline" | "pen" | "memo" | "comment"`.
    - `const ANNOTATION_TOOLS = ["highlight", "underline", "pen", "memo", "comment"] as const` and the derived `type AnnotationTool = (typeof ANNOTATION_TOOLS)[number]`.
    - `const POINTER_TOOLS = ["cursor", "hand", "box"] as const` and `type PointerTool`.
    - `function isAnnotationTool(t: ActiveTool): t is AnnotationTool` (membership test) — used to derive the overlay's `armedTool` and the Reader's pan flag.
  - [x] Make `annotations/machine.ts` consume `AnnotationTool` from `tools.ts` (re-export it from the `annotations` barrel for back-compat so existing `import type { AnnotationTool } from "./annotations"` sites keep working) rather than defining its own copy. The two literals must be identical — `tools.ts` becomes the single definition. [Decision A in Dev Notes — chosen]
  - [x] **Reconcile the `box` vs `box-select` literal:** AD-11 and the AC name the pointer tool `box`; the existing `ToolMode`/rail option uses `"box-select"`. Standardize on `box` in the `activeTool` union and update the one rail OPTION value + its testid (`tool-option-box-select` → `tool-option-box`) and the `ToolRail.test.tsx` references. (`box-select` the *feature* is still Story 2.11; only the literal/name is reconciled here.)

- [x] **Task 2 — Lift `activeTool` into App, remove the two old fields + the surgical patch (AC: 1, 2, 5)**
  - [x] In `App.tsx`, replace `const [mode, setMode] = useState<ToolMode>("cursor")` and `const [armedTool, setArmedTool] = useState<AnnotationTool | null>(null)` with a single `const [activeTool, setActiveTool] = useState<ActiveTool>("cursor")`.
  - [x] In the document-level key effect (`App.tsx:73-108`), route every key through `setActiveTool`: `v`/`V`/`Escape` → `setActiveTool("cursor")`; `h`/`H` → `setActiveTool("highlight")`; `[` → toggle the rail (unchanged). DELETE the 2.3 cross-setter lines (the `setMode("cursor")` paired with `setArmedTool("highlight")`, and the `setArmedTool(null)` paired with `setMode("cursor")`) — mutual exclusion is now automatic. Keep all existing guards (chord skip + editable/`SELECT`/`BUTTON` exempt) verbatim (AC2). Do NOT add a second listener (AP-1). Do NOT wire `U`/`D`/`T`/`C`/`M` — those tools don't exist yet (their stories add the key + button + behavior).
  - [x] Update the props App passes down (Task 3 + Task 4): `Reader` gets `panArmed={activeTool === "hand"}` and `armedTool={isAnnotationTool(activeTool) ? activeTool : null}`; `ToolRail` gets `activeTool` + a single `onSelectTool(t: ActiveTool)` callback (replacing the old `mode`/`onMode`/`armedTool`/`onArmTool` quartet). Remove the now-dead `onMode`/`onArmTool` cross-setting closures.
  - [x] Update the App header comment block (`App.tsx:30-40`) to describe the single `activeTool` model and that mutual exclusion is by construction (delete the "ORTHOGONAL to `mode`" note, which no longer holds).

- [x] **Task 3 — Collapse the ToolRail to the single `activeTool` model + single-click switch (AC: 2, 4)**
  - [x] In `ToolRail.tsx`, change the props to `{ activeTool: ActiveTool; onSelectTool: (t: ActiveTool) => void; collapsed; onToggleCollapse }`. Remove `mode`/`onMode`/`armedTool`/`onArmTool`. The `ToolMode` type export here is superseded by `ActiveTool` from `tools.ts` — remove `ToolMode` and update its importers (App, Reader if it imports it).
  - [x] **Active/armed styling from `activeTool`:** the pointer button reads active when `activeTool` is a pointer tool (`cursor`/`hand`/`box`) — preserving the 2.3 #3 fix that cursor mode shows active; the Highlight button reads armed when `activeTool === "highlight"`. Exactly one button is active (mutual exclusion is now intrinsic, not a derived `armedTool == null`).
  - [x] **Single-click switch (AC4):** clicking the pointer rail button must COMMIT to a pointer tool in one click (call `onSelectTool` with the displayed pointer sub-mode), so switching from Highlight → cursor is one click and opens no sub-toolbox. Keep the cursor/hand/box flyout reachable as a secondary gesture — see Dev Notes "Single-click switch + the pointer flyout" for the chosen interaction. The flyout options call `onSelectTool(o.value)` (the pointer sub-mode) and close. The Highlight button calls `onSelectTool("highlight")`. (Toggling Highlight off → back to cursor: clicking Highlight while it is armed should return to `cursor`; preserve the 2.3 toggle-off feel via `onSelectTool(activeTool === "highlight" ? "cursor" : "highlight")`.)
  - [x] Keep the rail presentational: it owns no tool state, only the local flyout-open state (as today). App owns `activeTool`.

- [x] **Task 4 — Reconcile the overlay machine + interaction with the single model (AC: 3, 5)**
  - [x] In `annotations/machine.ts`, make the armed annotation tool a DERIVED input rather than an independently-mutated lifecycle. The transient states `empty/annotating/pending` stay. Minimal-change path (recommended): keep the reducer but ensure the only writer of the armed tool is App via the `armedTool` prop sync — i.e. the `arm`/`disarm` actions exist solely to mirror the prop, never set from inside the overlay. Cleaner path (preferred if low-risk): drop the standalone `armed` status + `arm`/`disarm` actions; carry the armed tool into `present` from an `activeTool`-derived ref so `pending.tool` reflects it, and `rest()` reads the same ref for stickiness. Pick the smaller diff that still leaves ONE writer; document the choice in Completion Notes. [Decision B in Dev Notes]
  - [x] In `annotations/AnnotationInteraction.tsx`, keep accepting the `armedTool` prop (now `isAnnotationTool(activeTool) ? activeTool : null` from App) unchanged in shape. Preserve: create-on-release for highlight (AC-5 of 2.3), the swatch-row recolor, sticky-after-mark, dismiss on pick/outside/`Esc`/scroll, and the disarm-while-pending `removeAllRanges()` re-pop fix (2.3 review finding). If Task 4's machine change alters the arm/disarm effect, re-prove the re-pop fix still fires.
  - [x] In `Reader.tsx`, no logic change: it already takes `panArmed` + `armedTool` as props and does the right thing; only the values App computes change. Confirm `canPan = (panArmed ?? false) || spaceHeld` still holds and hold-`Space` is independent of `activeTool`.

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] **New FSM unit tests** (`client/src/tools.test.ts` or fold into a machine test): `isAnnotationTool` correctly partitions the union; setting `activeTool` is single-valued (no second field can diverge — assert at the App-behavior level in Task-5 App tests).
  - [x] **`App.test.tsx`:** rewrite the two 2.3 mutual-exclusion tests (`App.test.tsx:299,314`) to the single model — arming highlight (via `H` or rail) makes `activeTool="highlight"` and pan no longer arms; selecting hand makes `activeTool="hand"` and highlight is no longer armed; clicking the pointer button while highlight armed switches to cursor in one click (AC4). Keep the existing `H`/`V`/`Esc` key tests + chord/editable-exempt tests; confirm they pass against the single setter.
  - [x] **`ToolRail.test.tsx`:** update all renders to the new props (`activeTool`/`onSelectTool`); update the `box-select` → `box` testid/literal; the pointer button active-state test (`:53`), the Highlight-armed test (`:94`), and the flyout test now assert single-click commit (clicking pointer button calls `onSelectTool` with a pointer tool; clicking a flyout option calls `onSelectTool(value)`).
  - [x] **`Reader.test.tsx`:** if it passes `panArmed`/`armedTool` or imports `ToolMode`, update to the new types; confirm pan still arms on `activeTool==="hand"`-derived `panArmed`. Check the `vi.mock("./render")` barrel — NO new `render/` export this story, so it must stay untouched (AP-2); confirm.
  - [x] **`AnnotationInteraction.test.tsx`:** update if the machine reconciliation (Task 4) changed the arm/disarm wiring; the highlight create-on-release, swatch recolor, sticky-arm, cursor-mode proof button, and disarm-while-pending re-pop-clear assertions must all still pass.
  - [x] Full regression: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` and `cd client && npm test` + `npm run typecheck` — all green. No contract change → regenerate-or-verify: `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical (no diff).
  - [x] **Live smoke (the real verifier — Epic-1 retro; jsdom proves wiring, not gesture routing).** Run the host two-process flow (`cd server && uv run uvicorn app.main:app --reload --port 8000` + `cd client && npm run dev`), open a PDF, and re-run the Story 2.3 live-smoke scenarios against the FSM: (a) arm Highlight, drag text → highlight lands, page does not jump; (b) arm Hand, then `H`, then drag → highlights (pan did NOT eat it); (c) with Highlight armed, click the cursor rail button → switches to cursor in ONE click, no sub-toolbox; (d) Hand → drag pans; (e) zoom in/out → a highlight stays glued. Capture the result in Completion Notes.

- [x] **Task 6 — Docs (AC: 6)**
  - [x] No `/api` change → `docs/API.md` untouched (do not edit).
  - [x] Update `client/src/annotations/README.md`: note the tool state is now one `activeTool` FSM (AD-11), the overlay machine is driven by it (not a parallel arm/disarm), and that the per-tool quick-box opens only on drag-release or when the tool is already active (never replacing a switch) — so Story 2.6's arm-time picker and Story 2.5's selection both build on this one model.

### Review Follow-ups (AI)

- [x] [AI-Review][MED] Close the pointer flyout whenever a rail action switches to an annotation tool, so an already-open cursor/hand/box sub-toolbox cannot remain visible after Highlight is selected. [client/src/ToolRail.tsx:117] — RESOLVED: added a `useEffect(() => { if (!pointerActive) setOpen(false); }, [pointerActive])` in `ToolRail.tsx` so the flyout closes whenever `activeTool` stops being a pointer tool (covers both the `H` and click-Highlight paths). Regression test added in `ToolRail.test.tsx`; verified live (flyout open → click Highlight → highlight armed AND flyout closed).

## Dev Notes

### What "unify" actually means here (the core of the story)

After Story 2.3, App holds two fields that *must* agree:

```
mode: ToolMode = "cursor" | "hand" | "box-select"        // drives pan (Reader)
armedTool: AnnotationTool | null                          // drives marks (overlay)
```

They were kept mutually exclusive by a hand-written cross-setter (App.tsx:90-108, 196-208): arming a tool force-set `mode="cursor"`; picking a pointer sub-mode cleared `armedTool`. That patch *works* but is exactly the "two parallel states a human keeps in sync" anti-pattern the live smoke caught (#2). It would be copy-pasted into 2.6–2.11. **This story collapses the two fields into one `activeTool` so disagreement is unrepresentable.** `panArmed` and the overlay's `armedTool` become pure *derivations* of `activeTool`, not stored siblings:

```
panArmed   = activeTool === "hand"
armedTool  = isAnnotationTool(activeTool) ? activeTool : null   // passed to the overlay
```

That is the whole idea. Resist re-introducing any second stored tool field.

### Decision A — where `ActiveTool` lives (chosen: a leaf `tools.ts`)

The union spans pointer tools (App/ToolRail layer) AND annotation tools (`annotations/` layer). Putting it in `ToolRail.tsx` (where `ToolMode` lives) would force `annotations/` to import upward; putting it in `annotations/machine.ts` would force the App layer to import the annotation type for its pointer modes. **Chosen: a zero-import leaf `client/src/tools.ts`** holding the union + `ANNOTATION_TOOLS`/`POINTER_TOOLS` + `isAnnotationTool`. Both layers import down/sideways into a dependency-free leaf — no layer violation (AD-9). `annotations/machine.ts` consumes `AnnotationTool` from it and the `annotations` barrel re-exports it so existing import sites are unchanged. Rejected: a Zustand UI-tool slice — Story 2.3 already rejected putting pointer/tool UI state in `store/` (it is the annotation working copy, imports `api/` only, AD-9); that rejection stands, and App-state remains the home for the single `activeTool`.

### Decision B — reconciling the overlay machine (PREP-3)

AD-11/PREP-3 require the transient overlay machine to be "driven by the same model, not a parallel one." Two acceptable implementations; pick the smaller safe diff and record which:

- **Minimal (lower risk):** keep `machine.ts` as-is structurally, but treat App's `armedTool` prop as the SOLE writer of the armed tool — the `arm`/`disarm` actions only ever fire from the prop-sync effect (they already do, `AnnotationInteraction.tsx:92-99`). Add a comment asserting "single writer: App's `activeTool`; the overlay never self-arms." This is technically already close to driven-by; the story's value is making it explicit + deleting the App-side cross-setter so there is genuinely one model.
- **Preferred (cleaner, if low-risk):** drop the standalone `armed` status + `arm`/`disarm` actions; derive the armed tool at `present` time from an `activeTool`-fed ref, and have `rest()` read the same ref for stickiness. Fewer states, no possibility of a divergent in-overlay tool.

Either way: ONE writer (App's `activeTool`), and the 2.3 disarm-while-pending `removeAllRanges()` re-pop fix must still fire when the active tool changes away from an annotation tool while a quick-box is open.

### Single-click switch + the pointer flyout (AC4)

Today the pointer rail button is a flyout-opener: clicking it opens cursor/hand/box and does NOT itself switch tools. With Highlight armed, that means returning to cursor takes two interactions (open flyout → pick cursor) — the live-smoke single-click-switch issue. **Chosen interaction:** the pointer rail button click *commits* to a pointer tool immediately (`onSelectTool` with the shown sub-mode, defaulting to `cursor`); the cursor/hand/box flyout opens as a secondary gesture for choosing a *different* pointer sub-mode (e.g., open the flyout only when the pointer tool is already the active tool, or behind a small caret affordance — keep it presentational and reachable, your call, but the single-click commit is the hard requirement). The Highlight button toggles: `onSelectTool(activeTool === "highlight" ? "cursor" : "highlight")` so a second click returns to cursor (preserving the 2.3 toggle-off feel). The hard invariant (AC4): switching tools is always one click and never pops another tool's quick-box / sub-toolbox in its place — this is what lets Story 2.6 add an arm-time color picker safely.

### What must NOT change (regression guardrails)

- **Highlight create-on-release + recolor (2.3):** with the active tool = highlight, a text drag-release still lands a default-color mark and pops the swatch-recolor row. Don't touch `buildAnnotations`, the store, or `AnnotationLayer`.
- **The 2.3 re-pop fix:** disarming while the quick-box is pending must still `removeAllRanges()` (AnnotationInteraction.tsx:92-99) — re-verify after Task 4.
- **The 2.3 #3 active-cursor fix:** the pointer button reads active in plain cursor mode (don't regress to "active only when nothing armed" phrased against the deleted `armedTool`).
- **The 2.3 scroll-dismiss + outside-click-dismiss** of the quick-box — untouched.
- **Hold-`Space` temp-pan** is Reader-internal and INDEPENDENT of `activeTool` (`canPan = panArmed || spaceHeld`). Do not fold Space into the FSM — a document-level Space handler fights the scroll container (Epic-1 retro AP-1, the reason it lives in the Reader). Leave it alone.
- **box** arms but its drag does nothing (Story 2.11). Don't accidentally make `box` start a selection.

### Reuse map — what already exists (do NOT rebuild)

- `annotations/machine.ts` — the transient overlay reducer (`empty/armed/annotating/pending`, `present`/`commit`/`dismiss`, `rest()` stickiness). Reconcile, don't rewrite.
- `annotations/AnnotationInteraction.tsx` — the prop-sync effect, create-on-release, swatch recolor, dismiss paths. Keep the `armedTool` prop shape; only its source changes.
- `Reader.tsx` — `panArmed`/`armedTool` props + `canPan`/hold-Space. No logic change; only the values App feeds.
- `ToolRail.tsx` — the rail shell, flyout, collapse, armed styling. Collapse two prop pairs into one `activeTool`/`onSelectTool`; reuse the layout.
- `store/index.ts`, `anchor/`, `create.ts`, `AnnotationLayer.tsx`, `ColorSwatchRow.tsx` — UNTOUCHED.

### Integration points (read these; they are the seams)

- `client/src/App.tsx` — owns `mode` + `armedTool` today (App.tsx:33, 40) and the document-level key effect (App.tsx:73-108) + the two cross-setting closures wired to `ToolRail` (App.tsx:194-211) and to `Reader` (App.tsx:188-189). Collapse to one `activeTool` + one setter; derive `panArmed`/`armedTool` for the children. [App.tsx:30-40, 73-108, 185-211]
- `client/src/ToolRail.tsx` — defines `ToolMode` (ToolRail.tsx:19), the `OPTIONS` flyout (27-31), armed = `armedTool == null` (91), the Highlight button (152-164). Switch to `activeTool`/`onSelectTool`; implement single-click commit. [ToolRail.tsx:19, 27-31, 44-62, 84-164]
- `client/src/annotations/machine.ts` — `AnnotationTool` def (13), `arm`/`disarm` (50-53), `currentTool`/`rest` (38-46). Make `AnnotationTool` come from `tools.ts`; ensure one writer (Decision B). [machine.ts:13, 21-74]
- `client/src/annotations/AnnotationInteraction.tsx` — the `armedTool` prop + prop-sync arm/disarm effect (78-99). Keep the prop; re-verify the re-pop clear. [AnnotationInteraction.tsx:43-60, 78-131]
- `client/src/Reader.tsx` — `panArmed`/`armedTool` props (63-76), `canPan` (102), `data-pan` (532), overlay mount passing `armedTool` (569). No logic change. [Reader.tsx:61-102, 525-575]
- `client/src/tools.ts` — NEW leaf module (Decision A).

### Design tokens / UI strings

- No new tokens, no new colors, no new copy. Rail labels/titles unchanged except the `box-select` → `box` literal (the user-facing label can stay "Box select"; only the internal value + testid change). **No em-dash in any user-facing string** (button `title`/`aria-label`) — none should change here, but grep new strings. [[no-emdash-user-facing]]
- `no-raw-values.test.ts` must stay green: this story adds no `src/theme/**`-external hex/px.

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Document-level interaction handlers (AP-1):** the `H`/`V`/`Esc` keys stay in App's single document-level effect, phase-gated, editable/buttons exempt. Don't bind to `.pdf-canvas`. Hold-Space stays Reader-internal.
- **Adopt stable primitives, don't reinvent (AP-4/PREP-1):** this is a state-model refactor; it adds NO coordinate or selection math. If a hand-rolled path tempts you, stop — reuse the 2.2/2.3 primitives.
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export this story → both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) stay untouched. Confirm.
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story, as standing practice.

### Testing standards

- Frontend Vitest + jsdom: assert the model (which tool is active, what App passes down, single-click commit, mutual exclusion) and store/quick-box wiring — NOT pixel movement. jsdom zeroes `getClientRects`, so drive the create path via the 2.2/2.3 selection mocks as those tests already do. Real gesture-routing (pan-doesn't-eat-the-drag, single-click switch in the live DOM) is proven by the **live smoke** (Task 5), per the Epic-1 retro.
- Backend pytest: no model/contract change; run the suite to confirm no regression.

### Project Structure Notes

- New file: `client/src/tools.ts` (+ optional `tools.test.ts`). Edits: `App.tsx`, `ToolRail.tsx`, `annotations/machine.ts`, `annotations/AnnotationInteraction.tsx` (verify), `annotations/index.ts` (re-export `AnnotationTool` from `tools.ts`), the four touched test files, `annotations/README.md`. No new top-level dirs. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): `render → anchor → annotations → store → api`. `tools.ts` is a dependency-free leaf both the App layer and `annotations/` may import. The `activeTool` model + rail stay in the App/ToolRail pointer-tool layer; the overlay logic stays in `annotations/`. No upward imports from `render/`/`anchor/`.

### References

- [Source: .bmad/planning-artifacts/sprint-change-proposal-2026-06-29-tool-fsm.md §1, §3, §4.1, §4.3] — the issue (two orthogonal states let pan eat the drag), the recommended single-`activeTool` FSM, the AC seed, and the AD-11 text.
- [Source: .bmad/planning-artifacts/sprint-change-proposal-2026-06-29-select-highlight.md] — the AC4 single-click-switch addition to 2.4 and why 2.5 depends on this model.
- [Source: .bmad/planning-artifacts/epics.md#Story-2.4-Unify-tool-state] — story statement + 5 ACs.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — tool-state model: one `activeTool`, mutually exclusive by construction; pan derives from it; overlay machine driven by the same model; single-click switch.
- [Source: ARCHITECTURE-SPINE.md#AD-9] — boundary/layer invariants (anchor-only math, generated client, layering).
- [Source: ARCHITECTURE-SPINE.md#AD-12] — the selection model (Story 2.5) that builds on this single `activeTool`; do NOT build it here.
- [Source: EXPERIENCE.md IP-1 (line 88), IP-3 (line 90)] — tool select = exactly one tool active (mutual exclusion, AD-11); the contextual quick-box pops on drag-release.
- [Source: .bmad/implementation-artifacts/epic-2/2-3-highlight-text-via-drag.md] — the surgical mutual-exclusion patch this story supersedes; the create-on-release + recolor + re-pop fix + #3 active-cursor fix that must be preserved.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions] — document-level handlers, adopt-stable, render-mock-barrel sync, token rules, test incantations.

## Previous Story Intelligence

From Story 2.3 (highlight via drag, done) + its live-smoke + the Epic-1 retro:

- **The bug this story fixes was found live, not in jsdom.** The two-state `mode`+`armedTool` model let the hand pan and highlight both arm; the Reader's `data-pan` handler suppressed text selection so the highlight drag produced "no reaction." 2.3 shipped the surgical cross-setter; this story removes the *cause* (two states). Re-prove with the live smoke — jsdom won't catch a swallowed gesture.
- **The 2.3 review findings live on:** (1) the `H`/key guard must exempt `SELECT`/`BUTTON` (already done — preserve it); (2) disarming while a quick-box is pending must `removeAllRanges()` or the stale selection re-pops the box. Both must survive the FSM refactor.
- **The 2.3 #3 fix:** the pointer button reads active in plain cursor mode. Re-express it as "active when `activeTool` is a pointer tool," not the deleted `armedTool == null`.
- **`ColorSwatchRow` is reusable** — Story 2.6 (arm-time color pick) will reuse it as an on-arm picker; AC4 here keeps the door open by forbidding a quick-box from replacing a tool switch.
- **`AnnotationLayer` filters by `doc_id` + `page_index`** (2.2 finding) — untouched here; don't regress it.

## Git Intelligence

- Baseline: `85945fb` (Chore: move stray debug captures) on `main`; the 2.3 highlight tool, `ColorSwatchRow`, `store.recolorAnnotation`, the overlay machine, and the App `mode`+`armedTool` cross-setter are all merged. This story refactors that App/ToolRail/overlay tool-state into one model.
- Branch off `main` (global git convention: never commit to `main` directly). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`); Docker is the prod-like single-command boot.
- No contract change → keep `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical (verify no diff after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). Prod = single image, FastAPI serves API + built SPA same-origin.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches the App/ToolRail pointer-tool layer + `annotations/` overlay + a new dependency-free `tools.ts` leaf; NO `anchor/`/`render/`/`store/`/contract change.
- Tool-state model (AD-11) is the new cross-tool invariant established here; every later Epic-2 tool (2.6–2.11) and the selection model (AD-12, Story 2.5) build on this single `activeTool`.
- No auth, localhost single-user. v1 scope = Phase 1.

## Story Completion Status

Story context engineered and ready for dev. Two internal design calls are pre-resolved with rationale (Decision A: `ActiveTool` lives in a zero-import leaf `tools.ts`; Decision B: the overlay machine has one writer — App's `activeTool` — pick the smaller safe diff to enforce it). No user-blocking decisions. This is a behavior-preserving refactor: success = identical visible behavior to end-of-2.3 PLUS the single-click tool switch (AC4), one model instead of two, the overlay driven by it, and the live smoke re-passing the pan-doesn't-eat-the-drag + single-click-switch scenarios.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story)

### Debug Log References

- Frontend: `cd client && npm test` → 23 files, 212 tests passing. `npm run typecheck` clean.
- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 38 passing.
- Contract: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` → empty (byte-identical, no contract change). `vi.mock("./render")` barrels untouched (AP-2).
- Live smoke: host two-process flow + Playwright against `09-regularization.pdf` at DPR 1.25 (HiDPI).

### Completion Notes List

- **One `activeTool` model (AC1/AC2).** App's `mode: ToolMode` + `armedTool: AnnotationTool | null` and the Story 2.3 cross-setter are gone; replaced by a single `activeTool: ActiveTool` (`useState`). `panArmed = activeTool === "hand"` and the overlay's `armedTool = isAnnotationTool(activeTool) ? activeTool : null` are pure derivations passed down (no stored siblings). `H`/`V`/`Esc` route through the one setter; guards (chord-skip + INPUT/TEXTAREA/SELECT/BUTTON/contentEditable exempt) preserved verbatim, one document-level listener.
- **Decision A — `tools.ts` leaf (chosen as specified).** New zero-import `client/src/tools.ts` holds `ActiveTool`/`AnnotationTool`/`PointerTool`, `ANNOTATION_TOOLS`/`POINTER_TOOLS`, and `isAnnotationTool`/`isPointerTool`. `annotations/machine.ts` now imports + re-exports `AnnotationTool` from it (single definition); the `annotations` barrel re-export chain is unchanged, so `Reader`/`AnnotationInteraction` import sites are untouched. No layer violation (both layers import down into a dependency-free leaf, AD-9).
- **Decision B — minimal path (chosen).** The overlay machine (`empty/annotating/pending` + `armed`) is structurally unchanged; App's `activeTool`-derived `armedTool` prop remains the SOLE writer via the existing prop-sync effect (the machine never self-arms). Added a single-writer comment in `machine.ts`. This is the smaller, lower-risk diff and keeps every 2.2/2.3 overlay behavior (create-on-release, swatch recolor, sticky-after-mark, scroll/outside/Esc dismiss, and the disarm-while-pending `removeAllRanges()` re-pop fix) byte-for-byte intact — all AnnotationInteraction tests pass unchanged.
- **ToolRail single-click switch (AC4).** Props collapsed to `{ activeTool, onSelectTool, collapsed, onToggleCollapse }`. When a pointer tool is NOT active (e.g. Highlight armed), clicking the pointer button COMMITS to the pointer sub-mode (default cursor) in one click and opens no flyout; when a pointer tool is already active, the click opens the flyout to pick a different sub-mode. Highlight button toggles `onSelectTool(activeTool === "highlight" ? "cursor" : "highlight")`. Pointer-active styling re-expressed as `isPointerTool(activeTool)` (preserves the 2.3 #3 active-cursor fix). `box-select` literal/testid reconciled to `box` (feature still Story 2.11).
- **Reader unchanged (AC5).** Only the values App feeds change; `canPan = (panArmed ?? false) || spaceHeld` and hold-Space remain Reader-internal and independent of `activeTool`.
- **Live smoke (DPR 1.25, real browser) — all pass:** (a) Highlight armed + text drag → mark landed (annotation count +1) with the swatch row, page `scrollTop` stayed 0 (no jump); (b) Hand armed → press `H` → highlight arms and `data-pan` clears (pan did NOT eat the drag — the 2.3 bug is gone at the cause); (c) Highlight armed → one click on the pointer button switches to cursor, no flyout opened (AC4); (d) Hand → `data-pan` present (pannable); (e) zoom 157%→246%→157% → the mark stays present/glued, no reflow. Highlight stayed sticky after the mark.
- No new tokens/colors/copy; `no-raw-values.test.ts` green. No `/api` change → `docs/API.md` untouched. `server/uv.lock` picked up the already-merged 0.0.1→0.1.0 version bump as incidental churn.

### File List

- `client/src/tools.ts` (new) — the zero-import tool-FSM leaf (Decision A).
- `client/src/tools.test.ts` (new) — FSM partition unit tests.
- `client/src/App.tsx` — single `activeTool` state + setter; derived `panArmed`/`armedTool`; new ToolRail props; removed `ToolMode`/`AnnotationTool` imports + cross-setters.
- `client/src/ToolRail.tsx` — `activeTool`/`onSelectTool` props; single-click switch; `box-select`→`box`; removed `ToolMode`.
- `client/src/annotations/machine.ts` — source `AnnotationTool` from `tools.ts` + single-writer comment.
- `client/src/annotations/README.md` — documented the unified `activeTool` FSM (AD-11).
- `client/src/App.test.tsx` — rewrote the mutual-exclusion tests to the single model + added the AC4 single-click-switch test.
- `client/src/ToolRail.test.tsx` — updated to `activeTool`/`onSelectTool` + `box` testid + AC4/toggle-off tests.
- `server/uv.lock` — incidental version-bump sync (0.0.1→0.1.0).

## Change Log

- 2026-06-29: Unified the tool state into one `activeTool` FSM (AD-11). Replaced App's `mode`+`armedTool` pair and the Story 2.3 cross-setter with a single source of truth; pan + overlay armed-tool now derive from it; ToolRail switches in a single click (AC4); overlay machine driven by the one model (single writer). Behavior-preserving refactor; live smoke re-passed the pan-doesn't-eat-the-drag + single-click-switch scenarios at DPR 1.25.
- 2026-06-29: Addressed cross-model code review (Codex) — 1 MED item resolved. Close the pointer flyout whenever `activeTool` stops being a pointer tool, so switching to Highlight never leaves a stale cursor/hand/box sub-toolbox open (AC4). Added a regression test (213 FE tests green).
- 2026-06-29: UX fix (user request): re-clicking an already-active annotation tool no longer cancels it (was toggling Highlight back to cursor). Re-click is now idempotent (stays armed), consistent with the pointer button (re-click opens/closes its sub-toolbox, never disarms). Leave a tool via another tool or V/Esc. Tests updated.

## Senior Developer Review (AI)

Reviewer: Codex (cross-model review, bmad-code-review, non-interactive)
Outcome: **Changes Requested** → all action items resolved 2026-06-29 (see Review Follow-ups); the single MED finding is fixed + tested.

### Findings

**High:** None.

**Medium:**
- [AI-Review][MED] Stale pointer flyout can remain open after switching to Highlight. In `ToolRail`, clicking the pointer button while an annotation tool is active correctly commits to cursor without opening the flyout, but the reverse path is not symmetric: if the pointer flyout is already open and the user clicks Highlight (or uses `H`), `open` stays true because the click is inside `rootRef` and the Highlight handler only calls `onSelectTool(...)`. The app ends with `activeTool === "highlight"` while the cursor/hand/box sub-toolbox remains visible, which violates the AC4 intent that tool switches not leave another tool's sub-toolbox in place of the switch. Fix: close the flyout when selecting Highlight or add an effect that closes it whenever `activeTool` is no longer a pointer tool. Evidence: `client/src/ToolRail.tsx:117` only closes via pointer option selection; `client/src/ToolRail.tsx:161` switches Highlight without closing local flyout state.

**Low:** None.

### Acceptance Notes

- AC1/AC2: App now has one stored `activeTool`; `panArmed` and overlay `armedTool` are pure derivations. The old `mode`/`armedTool` cross-setters are gone.
- AC3: The overlay machine still uses the minimal mirror path. `arm`/`disarm` are only driven by the `armedTool` prop sync, and the disarm-while-pending `removeAllRanges()` fix remains in `AnnotationInteraction`.
- AC4: The required Highlight to cursor single-click path is implemented and tested. The Medium finding is the stale-open inverse path from an already-open pointer flyout to Highlight.
- AC6: `client/src/tools.ts` is a zero-import leaf; no `anchor/`, `render/`, `store/`, Pydantic, OpenAPI, or generated client type changes were introduced by the implementation commit.

### Verification

- `cd client && npm test`: first run reported 211/212 passing with one transient `Reader.test.tsx` Space-pan assertion failure; immediate rerun passed 23 files, 212 tests.
- `cd client && npm run typecheck`: passed.
- `git diff --stat 85945fb..HEAD -- server/openapi.json client/src/api/schema.d.ts`: empty.
- `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`: could not complete in this sandbox. The unmodified command failed first because uv tried to write `/home/cotidie/.cache/uv` on a read-only filesystem. With `UV_CACHE_DIR=/tmp/uv-cache` and with direct `.venv/bin/python -m pytest`, collection succeeded (38 tests), and `test_models.py`, `test_openapi.py`, and `test_storage.py` passed in isolation (20 tests), but TestClient-backed `test_health.py`, `test_docs.py`, and `test_static.py` hung before completing. This is recorded as a verification caveat, not a Story 2.4 code finding.
