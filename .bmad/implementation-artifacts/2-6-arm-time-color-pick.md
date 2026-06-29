---
baseline_commit: 43b54ce560e2e53000b0f71964470b2acf3c67a2
---

# Story 2.6: Arm-time color quick-pick (highlight sub-toolbox) + 5-color palette

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to pick the highlight color when I arm the tool, from the highlight tool's own sub-toolbox,
so that new marks land in my chosen color without a recolor step.

> **This story makes the highlight color a chosen DEFAULT, not a hardcode.** Today the create path lands every mark at the literal `annotation-default` token (`AnnotationInteraction.tsx#DEFAULT_COLOR`). This story: (1) introduces a **sub-toolbox on the Highlight tool button** in the rail — a color-swatch flyout, the exact sibling of the existing pointer (cursor/hand/box) flyout — that sets the **active color**; (2) makes the create path READ that active color; (3) trims the annotation palette from **6 → 5** by removing **Orange**, everywhere, for all tools. The post-create recolor row (2.3/2.5) keeps working. [AD-11, AD-9, UX-DR5/DR6]
>
> **Why now (sequencing):** the underline (2.7) and pen (2.8) tools inherit this same color model + `ColorSwatchRow`. Landing arm-time color + the trimmed palette before them means they get a chosen default for free instead of re-deriving it. The Highlight tool button is already a single-click-switch button whose `onSelectTool` comment explicitly reserves room for "Story 2.6's arm-time picker" — this is that picker.

## Two user comments folded in (this story's framing)

1. **Reduce the default color set to FIVE, for ALL tools — remove Orange.** The palette is `yellow / green / pink / blue / purple` (default = yellow). `ColorSwatchRow` is the single source every tool reuses, so dropping Orange there + in `DESIGN.md` (token source of truth) trims it for highlight today and underline/pen later.
2. **This story introduces the SUB-TOOLBOX of the highlight tool.** Mirror the pointer button's flyout exactly: the Highlight button gets its own color-swatch sub-toolbox; opening it sets the default color for the next marks.

## Scope boundary — READ FIRST

**IN (this story):**

- **Trim the annotation accent palette 6 → 5 (remove Orange), at the source of truth.** Edit `DESIGN.md`: drop the `annotation-orange` color token (line ~41) and every prose mention (description line 6, the palette paragraph ~313, the `Orange` bullet ~337). Regenerate `client/src/theme/tokens.css` (`cd client && npm run gen:tokens`) so `--color-annotation-orange` disappears. Remove the Orange entry from `ColorSwatchRow.tsx`'s `PALETTE` (and fix its "6 annotation accent colors" header comment → 5). `annotation-default` (= yellow) stays the first swatch.
- **A new `activeColor` piece of state, owned by `App` and threaded like `activeTool`.** App holds `activeColor` (`useState<string>("annotation-default")`), passes it + an `onPickColor` setter to `ToolRail` (for the sub-toolbox), and passes `activeColor` down through `Reader` to `AnnotationInteraction` (a new prop, the sibling of `armedTool`). One source of truth; mirrors the existing `activeTool` ownership exactly (App owns, threads to rail + overlay).
- **A color sub-toolbox on the Highlight tool button in `ToolRail.tsx`** — the structural twin of the existing pointer flyout (`tool-flyout` / `role="menu"`). It renders the 5 swatches (reuse `ColorSwatchRow`, value = `activeColor`); picking one calls `onPickColor(token)` and closes the flyout. Open/close behavior mirrors the pointer button (see Decision A): a click that ARMS highlight from another tool switches in one click and does NOT open the flyout (AC4 preserved); a click on the ALREADY-active Highlight button toggles the color flyout. Close on outside-click / `Esc`, and close whenever highlight stops being the active tool.
- **The create path reads `activeColor`.** In `AnnotationInteraction.tsx`, replace the hardcoded `DEFAULT_COLOR` at the two `buildAnnotations({ …, color })` call sites with the `activeColor` prop. New marks land in the chosen color; the default persists for the armed session (it is App state, not reset on each mark).
- **Keep the post-create recolor row working (2.3/2.5).** The selection quick-box's `ColorSwatchRow` still recolors the selected mark via `store.recolorAnnotation`. Unchanged except it now shows 5 swatches.
- **Accessibility + no-canvas-shift:** the sub-toolbox is keyboard-reachable (`role="menu"` / `menuitemradio`, like the pointer flyout and `ColorSwatchRow`), `Esc`-dismissable, focus-visible, and is a rail overlay that never reflows the canvas (NFR-1).

**OUT (later stories / not this one — do NOT build):**

- **Underline / pen / memo / comment tools** (2.7–2.10) and their own sub-toolboxes. This story only wires highlight. They reuse `activeColor` + `ColorSwatchRow` later; do not pre-build them. (Pen also needs stroke-width — out of scope.)
- **Per-tool remembered color** (a different default per tool). One shared `activeColor` for now; if 2.8 needs per-tool, it extends then.
- **Any anchor / store-schema / Pydantic / endpoint / generated-type change.** `activeColor` is App UI state; it does NOT go in the persisted annotation model or the API contract. `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical.
- **Persistence / command stack / undo** — Epic 3. Recoloring still uses the existing client-side `recolorAnnotation`.
- **Changing the default color** away from yellow, or adding new colors. Five only, default yellow.
- **Removing Orange from historical story files** (`2-3-*.md`, `2-5-*.md`) — leave them; they record what was true then. (Updating the `UX-DR1` "6-color" wording in `epics.md` is OPTIONAL polish, not required for dev.)

## Acceptance Criteria

1. **Five-color palette, Orange gone, everywhere (comment 1).** The annotation accent palette is exactly `yellow (= default) / green / pink / blue / purple`. `DESIGN.md` no longer defines `annotation-orange` (token block + all prose mentions removed); regenerated `client/src/theme/tokens.css` has no `--color-annotation-orange`; `ColorSwatchRow`'s `PALETTE` has 5 entries (default first) and its comment says 5; no code references `annotation-orange` or `--color-annotation-orange` (`grep` is clean). The recolor row and the new arm-time sub-toolbox both show exactly 5 swatches. [Source: user comment 1; DESIGN.md#colors (annotation-*); CLAUDE.md#Design-conventions (DESIGN.md is the token contract, tokens.css is generated)]

2. **The Highlight tool has a color sub-toolbox — the twin of the pointer flyout (comment 2, UX-DR5/DR6).** In the rail, the Highlight button exposes a color-swatch flyout (`ColorSwatchRow`, 5 swatches, `value = activeColor`, armed swatch gets the 2px ink ring per DESIGN.md#color-swatch). It is built like the existing pointer `tool-flyout` (`role="menu"`, `menuitemradio`, keyboard-reachable, `Esc`/outside-click dismiss) and is a rail overlay that never shifts the canvas (NFR-1, UX-DR17). [Source: epics.md#Story-2.6 AC1; user comment 2; DESIGN.md#quick-box ("Highlight mode → color-swatch row"), #color-swatch; ToolRail.tsx (pointer flyout pattern)]

3. **Single-click switch is preserved; the sub-toolbox is a secondary gesture (AD-11 / AC4).** Clicking Highlight while a DIFFERENT tool is active arms highlight in ONE click and does NOT open the color flyout (a switch never opens a sub-toolbox in place of the switch — the same rule the pointer button follows). Clicking the ALREADY-active Highlight button toggles the color flyout. The flyout closes automatically when highlight stops being the active tool. [Source: epics.md#Story-2.4 AC (single-click switch); ARCHITECTURE-SPINE.md#AD-11; ToolRail.tsx `onSelectTool` comment ("never opens a sub-toolbox in place of the switch … so Story 2.6's arm-time picker is safe")]

4. **Picking a swatch sets the active color; the next mark lands in it (epics.md#Story-2.6 AC2).** Picking a swatch in the sub-toolbox sets `activeColor` (App state). When the user then drags a highlight, `buildAnnotations` is called with `activeColor` (the create path reads the active color, NOT a hardcoded `annotation-default`), so the mark is created in the chosen color. The default persists for the armed session (and across marks) until changed. [Source: epics.md#Story-2.6 AC2; AnnotationInteraction.tsx#DEFAULT_COLOR + the two `buildAnnotations` call sites; create.ts `BuildOptions.color`]

5. **The post-create recolor row still works; both read/write the same active-color model (epics.md#Story-2.6 AC3).** The selection quick-box's recolor row (2.3/2.5) still recolors the selected mark through `store.recolorAnnotation` and repaints. The arm-time sub-toolbox and the create path share the one `activeColor` source; the recolor row continues to act on the selected mark. [Source: epics.md#Story-2.6 AC3; AnnotationInteraction.tsx `recolorSelected` + `ColorSwatchRow`]

6. **Client-side only; layering + contract preserved (AD-9, AD-3).** `activeColor` is App UI state threaded as props (like `activeTool`); nothing is added to the store schema, the persisted `Annotation`, the anchor model, or the API. `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical; `no-raw-values.test.ts` stays green (the only hex change is the removed token in `DESIGN.md` → regenerated `tokens.css`, both under the allowed `src/theme/**` / token source); no new `render/index.ts` export so both `vi.mock("./render")` barrels stay untouched. Highlight create (2.3), selection/recolor/delete (2.5), pan (2.4), and zoom-glue (NFR-3) do not regress. [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3; CLAUDE.md#Engineering-principles]

## Tasks / Subtasks

- [x] **Task 1 — Trim the palette 6 → 5 (remove Orange) at the source of truth (AC: 1)**
  - [x] `DESIGN.md`: delete the `annotation-orange: "#ffd6a8"` line in the `colors:` block (~41); remove "orange" from the description (line 6) and the palette paragraph (~313) so the palette reads `yellow / green / pink / blue / purple`; delete the `**Orange** (...)` bullet (~337). Leave `annotation-default` (= yellow) intact.
  - [x] Regenerate tokens: `cd client && npm run gen:tokens`. Confirm `client/src/theme/tokens.css` no longer has `--color-annotation-orange` (it is a gitignored build artifact; `dev`/`build` also regenerate it).
  - [x] `client/src/annotations/ColorSwatchRow.tsx`: remove the `{ token: "annotation-orange", label: "Orange" }` entry from `PALETTE`; update the header comment "6 annotation accent colors" → "5 annotation accent colors". Default-yellow stays first.
  - [x] `grep -rn "annotation-orange\|--color-annotation-orange\|Orange" client/src` is clean (only historical `.bmad` story files may still mention it — leave those).

- [x] **Task 2 — `activeColor` state owned by App, threaded like `activeTool` (AC: 2, 4, 5)**
  - [x] In `client/src/App.tsx`, add `const [activeColor, setActiveColor] = useState<string>("annotation-default");` next to `activeTool`. (Default = yellow per DESIGN.md.)
  - [x] Pass `activeColor` + `onPickColor={setActiveColor}` to `<ToolRail>` (the sub-toolbox reads/writes it). Pass `activeColor` to `<Reader>` so it reaches `AnnotationInteraction` (mirror how `armedTool` is derived/threaded: `App → Reader prop → AnnotationInteraction prop`).
  - [x] In `client/src/Reader.tsx`, add an `activeColor` prop and forward it to `<AnnotationInteraction activeColor={activeColor} … />` (sibling of the existing `armedTool` prop on line ~564–569).

- [x] **Task 3 — Highlight color sub-toolbox in `ToolRail.tsx` (AC: 2, 3)**
  - [x] Add props `activeColor: string` and `onPickColor: (token: string) => void` to `ToolRail`.
  - [x] Add local `const [colorOpen, setColorOpen] = useState(false)` — the highlight flyout's open state, the twin of the pointer button's `open`.
  - [x] Generalize the existing outside-click/`Esc` flyout effect so it also closes `colorOpen` (or add a parallel effect). Close `colorOpen` whenever `activeTool !== "highlight"` (mirror the `if (!pointerActive) setOpen(false)` effect).
  - [x] Highlight button `onClick` (Decision A — mirror the pointer button): `if (activeTool === "highlight") setColorOpen(o => !o); else onSelectTool("highlight")`. So arming from another tool is one click and opens nothing (AC3); a click on the active button toggles the flyout. Give the button `aria-haspopup="menu"` + `aria-expanded={colorOpen}` (it now owns a menu).
  - [x] Render the flyout when `colorOpen`: reuse the `.tool-flyout` shell (`role="menu"`, `data-testid="highlight-color-flyout"`) wrapping `<ColorSwatchRow value={activeColor} onPick={(t) => { onPickColor(t); setColorOpen(false); }} />`. `ColorSwatchRow` is already `role="group"` of `menuitemradio` swatches — keyboard-reachable; the armed swatch (= `activeColor`) shows the 2px ink ring.
  - [x] `ToolRail` may now import `ColorSwatchRow` from `./annotations` — confirm that import is downward (App/rail layer → annotations) and the existing barrel exports it (`annotations/index.ts`). The rail stays presentational (state still owned by App; it only renders + calls back).

- [x] **Task 4 — Create path reads `activeColor` (AC: 4)**
  - [x] In `client/src/annotations/AnnotationInteraction.tsx`, add the `activeColor: string` prop. Replace `DEFAULT_COLOR` at the two `buildAnnotations(…, { …, color: DEFAULT_COLOR })` call sites (drag-release create ~140-147 and the cursor-mode proof commit ~232-239) with `color: activeColor`. Remove the now-unused `const DEFAULT_COLOR = "annotation-default"` (or keep it ONLY as the App-state initial default — prefer initializing in App so there is one default site).
  - [x] Do NOT touch the create machine (`machine.ts`), the re-pop fix, sticky-after-mark, or the two-page `group_id` split — only the color value changes.

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] `ColorSwatchRow.test.tsx`: assert 5 swatches now (was 6); remove the `"annotation-orange"` expectation; assert the default/yellow swatch is first and arms when `value="annotation-default"`.
  - [x] `ToolRail.test.tsx`: clicking Highlight while cursor is active arms highlight and does NOT show `highlight-color-flyout` (AC3); clicking Highlight while it is already active shows the flyout; picking a swatch calls `onPickColor` with the token and closes the flyout; `Esc`/outside-click closes it; the flyout closes when `activeTool` changes away from highlight. Reuse the file's existing flyout test pattern.
  - [x] `AnnotationInteraction.test.tsx`: with `activeColor="annotation-green"`, a create-on-release builds the annotation with `style.color === "annotation-green"` (the create path reads the prop, not a hardcode). The 2.5 select/recolor/delete + 2.3 re-pop/sticky tests still pass with the new prop wired.
  - [x] App/Reader: thread the new prop through any test mounts so existing `App.test.tsx` / `Reader.test.tsx` stay green (no new `render/` export → both `vi.mock("./render")` barrels untouched; confirm).
  - [x] Full regression: `cd client && npm test` + `npm run typecheck`; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Contract byte-identical: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` empty. `no-raw-values.test.ts` green.
  - [x] **Live smoke (the real verifier — jsdom proves wiring, not gesture/visual routing). Host two-process flow + a real PDF at DPR>1:** (a) arm Highlight from cursor → it arms in ONE click, no flyout pops; (b) click the already-active Highlight button → the 5-swatch color flyout opens, current color armed; (c) pick green → flyout closes; (d) drag text → the new highlight is GREEN (not yellow); (e) re-arm, default persists across marks within the session; (f) select an existing mark → the recolor row still recolors it (5 swatches, no Orange); (g) `Esc`/outside-click closes the flyout; (h) the flyout never shifts the canvas and rides as a rail overlay. Capture results in Completion Notes. [Reuse `fixtures/sample-pdfs/09-regularization.pdf`.]

- [x] **Task 6 — Docs (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Update `client/src/annotations/README.md` (and/or a short note where the rail/tools are documented): the palette is now 5 colors (Orange removed); arm-time color is chosen via the Highlight tool's sub-toolbox (the twin of the pointer flyout) and stored as App `activeColor`; the create path reads `activeColor`; the post-create recolor row is unchanged.
  - [x] OPTIONAL (not required): update the `UX-DR1` "6-color annotation accent palette" wording in `epics.md` to "5-color" so the planning artifact matches. Skip if out of appetite — it does not block dev.

## Dev Notes

### What this story adds vs reuses (the core of the story)

The pieces all exist; this is a thin re-wire + a palette trim:

| Need | Already exists (REUSE) | New (this story) |
| --- | --- | --- |
| Swatch row UI | `ColorSwatchRow` (`role="group"` of `menuitemradio`, armed-ring, `value`/`onPick`) | remove the Orange entry → 5 swatches; reuse as the arm-time picker too |
| Rail flyout pattern | the pointer `tool-flyout` (`role="menu"`, outside-click/`Esc` dismiss, close-on-tool-change) in `ToolRail.tsx` | a second flyout on the Highlight button, same shell, holding `ColorSwatchRow` |
| Tool state ownership | App owns `activeTool`, threads to rail + Reader/overlay | App owns `activeColor`, threaded the same way (rail + overlay) |
| Create entity | `buildAnnotations` already takes `color` (`BuildOptions.color`) | pass `activeColor` instead of the `DEFAULT_COLOR` constant |
| Recolor existing mark | `store.recolorAnnotation` + the selection quick-box row | unchanged (now 5 swatches) |
| Token source of truth | `DESIGN.md` colors → `gen:tokens` → `tokens.css` | drop `annotation-orange`; regenerate |

Resist adding: a per-tool color map, `activeColor` in the persisted store/contract, a brand-new picker component (reuse `ColorSwatchRow`), or auto-opening the flyout on arm (that would re-introduce the two-step-switch smell AC4 forbids — see Decision A).

### Decision A — the highlight sub-toolbox mirrors the pointer flyout exactly (arm = one-click switch, flyout = secondary gesture)

The rail already has the right pattern: the pointer button switches in one click when inactive (opens NO flyout) and toggles its flyout only when it is already active (`onClick: if (pointerActive) setOpen(o=>!o); else onSelectTool(pointerMode)`), and `ToolRail.tsx`'s `onSelectTool` doc comment explicitly reserves this for "Story 2.6's arm-time picker." So the Highlight button does the same: `if (activeTool === "highlight") setColorOpen(o=>!o); else onSelectTool("highlight")`. This keeps the single-click switch invariant (AD-11 / Story-2.4 AC4) — clicking Highlight from another tool arms in one click and shows no sub-toolbox — and makes the color flyout the deliberate secondary gesture, consistent with the rest of the rail.

*Note (reconciling the epic wording):* `epics.md#Story-2.6 AC1` phrases the picker as one that "pops as an on-arm picker." Auto-popping the flyout the instant highlight is armed would make the switch a two-step affair (and diverge from the pointer button). Decision A keeps the consistent rail behavior (arm in one click; open the picker on a second click of the active button) rather than auto-popping. **This is the one interaction call worth a glance before dev** — see the question at the end. If Wonseok prefers auto-pop-on-arm, the only change is: in the Highlight `onClick`, also `setColorOpen(true)` when arming (and gate so a switch AWAY still never opens it).

### Decision B — `activeColor` lives in App (threaded), not in the Zustand store

`activeTool` is App `useState` threaded to the rail + the Reader/overlay; `activeColor` is its sibling (the armed tool's chosen color), so it follows the same path: App owns it, threads `activeColor`+`onPickColor` to `ToolRail` and `activeColor` to `Reader → AnnotationInteraction`. This keeps the store the *annotation working copy* (annotations Map + `selectedId`/`hoveredId` selection state), not a dumping ground for tool-chrome state, and keeps the rail presentational (it renders + calls back, owns no tool state). *(Alternative considered: put `activeColor` in the store so the rail and overlay both subscribe without prop-threading — rejected to match the established `activeTool` ownership and keep tool-chrome state out of the persisted-annotation store. If prop-threading through `Reader` feels heavy, the store is an acceptable fallback; record the choice.)*

### What must NOT change (regression guardrails)

- **Highlight create-on-release, the 2.3 re-pop fix, sticky-after-mark, the two-page `group_id` split** — only the `color` value changes; do not touch `machine.ts` / `create.ts` logic (besides reading the prop).
- **The 2.5 selection seam** (`selectedId`, interactive marks, hover/selected affordances, the selection quick-box recolor + delete) — unchanged; the recolor row simply shows 5 swatches now.
- **The pointer flyout** (cursor/hand/box) — its open/close logic is the template you mirror; do not regress it when generalizing the dismiss effect.
- **Single `activeTool` model (AD-11)** — `activeColor` is orthogonal; do NOT fold color into `activeTool` or add a second tool field.
- **Pan (hand), hold-Space, zoom-glue (NFR-3)** — unaffected.

### Integration points (read these; they are the seams)

- `client/src/App.tsx` — owns `activeTool` (`useState`, line ~38), threads to `ToolRail` (~193) and `Reader` (~182, `armedTool` derivation ~188). ADD `activeColor` + thread to both. [App.tsx:38, 182-196]
- `client/src/ToolRail.tsx` — the pointer flyout (`open`, the outside-click/`Esc` effect, the `if (!pointerActive) setOpen(false)` close, the Highlight button ~`onClick={() => onSelectTool("highlight")}`). ADD `activeColor`/`onPickColor` props, a `colorOpen` flyout on the Highlight button, mirroring the pointer one. [ToolRail.tsx (pointer flyout + Highlight button)]
- `client/src/annotations/ColorSwatchRow.tsx` — `PALETTE` (remove Orange) + header comment (6→5). The armed swatch = `value`. [ColorSwatchRow.tsx:21-28]
- `client/src/Reader.tsx` — forwards props to `AnnotationInteraction` (~564-569, sibling `armedTool`). ADD `activeColor` pass-through. [Reader.tsx:64-76, 564-569]
- `client/src/annotations/AnnotationInteraction.tsx` — `DEFAULT_COLOR` (line 32) used at the two `buildAnnotations` call sites (~147, ~239); the selection recolor row (`recolorSelected` ~294, `<ColorSwatchRow … />` ~441). Replace `DEFAULT_COLOR` with the `activeColor` prop at the create sites. [AnnotationInteraction.tsx:32, 140-147, 232-239, 439-441]
- `client/src/annotations/create.ts` — `BuildOptions.color` already exists; nothing to change. [create.ts (BuildOptions)]
- `DESIGN.md` — `colors:` block (~36-42), description (line 6), palette paragraph (~313), color bullets (~332-338). Remove Orange. [DESIGN.md:6, 36-42, 313, 332-338]

### Design tokens / UI strings

- No NEW token. One token REMOVED (`annotation-orange`) at the source (`DESIGN.md`) → regenerate `tokens.css` via `npm run gen:tokens`. Raw hex stays only under `src/theme/**` (the generated `tokens.css`); `no-raw-values.test.ts` still green. [Source: CLAUDE.md#Design-conventions]
- Swatch labels/tooltips are plain color words (no em-dash). The Highlight button keeps `title="Highlight (H)"`. The flyout is a rail overlay (`{component.tool-rail}` / DESIGN.md#quick-box "Highlight mode → color-swatch row"). [[no-emdash-user-facing]]

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / don't reinvent (AP-4):** reuse `ColorSwatchRow` + the pointer `tool-flyout` shell for the highlight sub-toolbox; do not author a new picker. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** the flyout's outside-click/`Esc` listeners bind on `document` (the rail's existing pattern), editable/buttons exempt where relevant. Mirror, don't reinvent.
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) stay untouched. Confirm.
- **HiDPI live smoke (memory):** verify the flyout open/close, the new-mark color, and the trimmed 5-swatch rows on a real host at DPR>1 — jsdom proves wiring, not visuals. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL/wiring — `PALETTE` length 5, the flyout renders only on the second (active) click, `onPickColor` fires with the token, the create path uses the `activeColor` prop — NOT pixel geometry (jsdom zeroes rects). Reuse `ToolRail.test.tsx`'s flyout pattern and `AnnotationInteraction.test.tsx`'s fake-card/stub-selection pattern.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- Edits: `DESIGN.md`, `client/src/theme/tokens.css` (regenerated), `App.tsx`, `Reader.tsx`, `ToolRail.tsx` (+ test), `annotations/ColorSwatchRow.tsx` (+ test), `annotations/AnnotationInteraction.tsx` (+ tests), `annotations/README.md`. No new files, no new top-level dirs. `create.ts`/`machine.ts`/`store/index.ts` unchanged (store schema untouched — Decision B). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): `render → anchor → annotations → store → api`. `activeColor` is App composition-root state threaded down; the rail (App layer) may import `ColorSwatchRow` from `annotations/` (downward). No `render/`/anchor/contract change.

### Versioning

- PATCH +1 when this story reaches `done` (PR merge): `server/pyproject.toml` `0.1.2 → 0.1.3` (single source; do NOT hard-code elsewhere). Bump once at done, not per commit. [Source: CLAUDE.md#Versioning]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.6] — story statement + the three ACs (on-arm picker sets the default; create reads active color; recolor row still works).
- [Source: ARCHITECTURE-SPINE.md#AD-11] — the single `activeTool` model + single-click switch the sub-toolbox must not break.
- [Source: ARCHITECTURE-SPINE.md#AD-9] — layer/boundary invariants (tool-chrome state in the composition root; client reaches backend only via the generated client).
- [Source: ARCHITECTURE-SPINE.md#AD-3] — contract stability (no API/Pydantic/generated-type change).
- [Source: DESIGN.md#quick-box, #color-swatch, #colors] — "Highlight mode → color-swatch row"; the 20px armed-ring swatch; the annotation accent token block (Orange removed).
- [Source: EXPERIENCE.md IP-1/IP-3] — tool arming (exactly one active) + the contextual quick-box mapping the swatch row reuses.
- [Source: .bmad/implementation-artifacts/2-5-select-highlight-recolor-delete.md] — the selection seam + `recolorAnnotation` + `ColorSwatchRow` reuse this story preserves.
- [Source: .bmad/implementation-artifacts/2-3-highlight-text-via-drag.md] — `ColorSwatchRow`, `buildAnnotations`'s `color` option, create-on-release.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Versioning] — adopt-stable, document-level handlers, render-mock-barrel sync, token contract, no em-dash, PATCH bump.

## Previous Story Intelligence

From Story 2.5 (select-highlight, done) + its two Codex reviews + the Epic-1 retro:

- **Think about the INVERSE path (Codex caught a flyout staying open on switch in 2.4).** For 2.6 the inverse paths are: the color flyout must CLOSE when highlight is deselected (mirror `if (!pointerActive) setOpen(false)`); arming highlight from another tool must NOT open it (AC3); picking a swatch must close it.
- **Live smoke is the real verifier.** jsdom passed 2.4/2.5 while real-DOM gesture/visual bugs existed (e.g. zoom `scroll → clearSelection` lost the ring). Verify the new-mark COLOR and the flyout open/close on a real host at DPR>1, not just in jsdom.
- **One model, no parallel state.** 2.4 collapsed tool state into one `activeTool`; keep `activeColor` orthogonal and singular — do not introduce a per-tool color map this story.
- **Contract byte-identical discipline.** Every Epic-2 story has kept `server/openapi.json` + `client/src/api/schema.d.ts` unchanged; this one must too (`activeColor` never enters the persisted model).
- **The 2.3 re-pop fix + sticky-after-mark** survived 2.4 and 2.5; they must survive 2.6 (the create path change is color-only).

## Git Intelligence

- Baseline: `43b54ce` (Chore: mark story 2-5 done; bump 0.1.2) on `main`; `activeTool`/`ToolRail` (with the pointer flyout), `ColorSwatchRow`, `buildAnnotations` (`color` option), `store.recolorAnnotation`, the selection seam, and the `anchor/` service are all merged. This story re-wires color and trims the palette on top.
- Branch off `main` (never commit to `main` directly). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`); the frontend palette change needs a `gen:tokens` regen (auto on `dev`/`build`).
- No contract change → keep `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical (verify no diff after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). Prod = single image, same-origin.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches the App composition root (`App.tsx`/`Reader.tsx` — `activeColor`), the rail (`ToolRail.tsx` — highlight sub-toolbox), and `annotations/` (`ColorSwatchRow` palette + the create path's color source). No `render/`/anchor/store-schema/contract change.
- `activeTool` (AD-11) is the established single tool model; `activeColor` is its sibling chosen-color state. v1 scope = Phase 1; no auth, localhost single-user.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Two internal design calls are pre-resolved with rationale (Decision A — the highlight sub-toolbox mirrors the pointer flyout: arm = one-click switch, the color flyout opens on a second click of the active Highlight button, preserving the single-click-switch invariant; Decision B — `activeColor` lives in App and is threaded like `activeTool`, not added to the store/contract). One interaction call (auto-pop-on-arm vs second-click-to-open) is flagged for a quick confirm but has a clear recommended default (second-click, per Decision A). Success = the annotation palette is 5 colors (Orange removed everywhere, tokens regenerated), the Highlight button has a color sub-toolbox twinning the pointer flyout, picking a swatch sets `activeColor`, a new drag lands in that color (create reads `activeColor`, not a hardcode), the post-create recolor row still works with 5 swatches, everything stays client-side with the API/anchor/store contract byte-identical, and the live smoke passes at DPR>1 without regressing create/select/pan/zoom.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code dev-story workflow).

### Debug Log References

- Live smoke selection: a programmatic `Range` across multiple pdf.js text-layer
  spans yielded an empty `Selection.toString()` (the BR-separated child spans made
  the multi-span range collapse). A single-span text-node range selected cleanly
  ("Chapter 8 de") and drove the create-on-release pointerup — sufficient to prove
  the active-color create path. (jsdom covers the two-page/group path.)

### Completion Notes List

Implemented entirely client-side; no contract/anchor/store-schema/persistence change.

- **Palette 6 → 5 (Task 1):** removed `annotation-orange` from `DESIGN.md` (token
  block + all three prose mentions) and regenerated `tokens.css` (no
  `--color-annotation-orange`); dropped the Orange entry from `ColorSwatchRow`
  `PALETTE` (now 5, default-yellow first) + comment. `grep` for orange is clean in
  `src` (only historical `.bmad` story files retain it).
- **`activeColor` ownership (Task 2, Decision B):** App owns `activeColor`
  (`useState("annotation-default")`), threaded like `activeTool` — to `ToolRail`
  (`activeColor`+`onPickColor`) and through `Reader` to `AnnotationInteraction`.
  Store schema untouched.
- **Highlight color sub-toolbox (Task 3, Decision A):** the Highlight button now
  mirrors the pointer button exactly — arming from another tool is one click and
  opens NO flyout (AC3); a click on the already-active button toggles the color
  flyout (`highlight-color-flyout`, reusing `ColorSwatchRow`). Wrapped the button +
  flyout in a `.tool-rail__item` (relative) so the flyout aligns to the button, not
  the rail top. Generalized the rail's outside-click/`Esc` dismiss to close both
  flyouts; the color flyout also closes when highlight stops being active. Added
  `ColorSwatchRow` to the annotations barrel.
- **Create reads `activeColor` (Task 4):** removed the `DEFAULT_COLOR` constant;
  both `buildAnnotations` call sites (drag-release + cursor-mode proof) now read an
  `activeColorRef` (latest-value ref, like `armedToolRef`). The post-create recolor
  row (2.3/2.5) is unchanged.

**Regression bar:** client `npm test` 253 passed (23 files; was 235 baseline);
`npm run typecheck` clean; server pytest 38 passed; `git diff --stat` on
`server/openapi.json` + `client/src/api/schema.d.ts` empty (contract byte-identical);
`no-raw-values.test.ts` green; no new `render/index.ts` export so both
`vi.mock("./render")` barrels untouched.

**Live smoke (host two-process flow, real PDF `09-regularization.pdf`, Chrome via
Playwright; DPR 1.0 — note: this story changes no rect/anchor geometry, so DPR>1 is
not a risk surface here, the contract + anchor are byte-identical):**
(a) arm Highlight from cursor → armed, NO color flyout (AC3) ✓;
(b) click the already-active Highlight button → 5-swatch color flyout opens
(`#ffe478/#b9efc6/#ffc7de/#bcdcff/#e0c8ff`, no Orange), default armed, positioned
+8px right of and top-aligned to the button ✓;
(c) pick Green → flyout closes, Highlight stays armed ✓;
(d) drag-select text → the new mark lands GREEN (`rgb(185,239,198)` = `#b9efc6`),
and the selection quick-box opens armed to Green (create reads `activeColor`, not
the yellow default) ✓.
Captures: `docs/images/story-2-6-highlight-color-flyout.png`,
`docs/images/story-2-6-green-mark-landed.png`. Esc/outside-click close, the
switch-away-closes-flyout inverse path, and the unchanged recolor/two-page paths are
covered in jsdom.

### File List

- DESIGN.md (removed annotation-orange token + prose mentions; 6 → 5 colors)
- client/src/theme/tokens.css (regenerated; gitignored build artifact)
- client/src/annotations/ColorSwatchRow.tsx (5-color palette, comment)
- client/src/annotations/ColorSwatchRow.test.tsx (5 swatches; orange absent)
- client/src/annotations/index.ts (export ColorSwatchRow from the barrel)
- client/src/App.tsx (activeColor state + thread to ToolRail and Reader)
- client/src/Reader.tsx (activeColor prop → AnnotationInteraction)
- client/src/ToolRail.tsx (highlight color sub-toolbox; props; dismiss + close-on-switch)
- client/src/ToolRail.test.tsx (sub-toolbox tests; prop helper; idempotent-click updated)
- client/src/App.css (.tool-rail__item relative wrapper)
- client/src/annotations/AnnotationInteraction.tsx (activeColor prop + ref; create reads it; DEFAULT_COLOR removed)
- client/src/annotations/AnnotationInteraction.test.tsx (active-color create test)
- client/src/annotations/README.md (Story 2.6 notes: 5-color palette + arm-time color)
- docs/images/story-2-6-highlight-color-flyout.png (live-smoke capture)
- docs/images/story-2-6-green-mark-landed.png (live-smoke capture)
- .bmad/implementation-artifacts/2-6-arm-time-color-pick.md (this story)
- .bmad/implementation-artifacts/sprint-status.yaml (status tracking)

### Code Review (cross-model: Codex via `codex exec`, read-only)

Ran the BMad code-review method through `codex exec --sandbox read-only` against
`43b54ce..HEAD`. No BLOCKER / HIGH. Triage:

- ✅ **MED — open flyout state survived rail collapse** (`ToolRail.tsx`): collapsing
  the rail unmounts the buttons but left `open`/`colorOpen` true, so expanding could
  resurrect a flyout without a fresh gesture. Fixed: a `collapsed` effect clears both
  flyout states. +1 regression test (collapse → expand leaves no flyout).
- ✅ **MED — `client/src` still spelled `annotation-orange` / `Orange`** (negative
  test assertions + README), violating AC1's grep-clean guard. Fixed: the swatch
  tests now assert an exact count of 5 (`.color-swatch` length) instead of naming the
  removed token; README reworded ("trimmed to five"). `grep -rn` for orange in
  `client/src` is now CLEAN.
- ⏸️ **MED — `activeColor` optional with a default (dismissed, with rationale):**
  Codex suggested making it required on `Reader`/`AnnotationInteraction`. Dismissed:
  `activeColor` deliberately mirrors its sibling `armedTool`, which is also optional
  (`armedTool?: … = null`) and defaulted — App always threads both. Making one
  required and not the other breaks the established prop pattern and would churn ~15
  test mounts for no real safety gain (the create-reads-activeColor path is covered
  by an explicit test). Keeping the sibling-consistent shape.
- ⏸️ **LOW — live smoke ran at DPR 1.0, story text mentioned DPR>1 (accepted):** this
  story changes NO rect/anchor/glyph geometry (contract + `anchor/` byte-identical);
  the only new surfaces are DOM rail chrome (the flyout) and a mark's token color, so
  DPR>1 is not a risk surface here (unlike selection/geometry features, where the
  memory mandates it). The smoke verified the flyout + the green-mark color at DPR 1.0;
  rationale recorded in the Completion Notes.

Post-review: client 254 tests pass, typecheck clean, contract byte-identical,
`no-raw-values` green, orange grep clean.

## Change Log

- 2026-06-29: Implemented Story 2.6 (arm-time color quick-pick + 5-color palette).
  Removed Orange (DESIGN.md token source → regenerated tokens.css); added the
  Highlight tool's color sub-toolbox (twin of the pointer flyout) setting App-owned
  `activeColor`; the create path now reads `activeColor` instead of a hardcoded
  default. Client-only; API/anchor/store contract byte-identical. Status → review.
- 2026-06-29: Addressed Codex review — clear rail flyout state on collapse (+test);
  swatch tests assert an exact count of 5 instead of naming the removed token + README
  reworded (grep-clean guard restored). Two findings accepted/dismissed with rationale
  (sibling-consistent optional `activeColor`; DPR not a risk surface this story). Client
  254 pass, contract byte-identical.
- 2026-06-29: Two more UX refinements (supersede the old AC4 single-click-no-flyout rule):
  (1) UNIFIED sub-toolbar layout — the rail's color flyout now matches the pointer flyout
  box (same width = one tool-button, centered swatches, the rail's standard gap), via the
  scoped `.tool-flyout .color-swatch-row` override; the overlay recolor row stays
  horizontal. (2) ONE consistent open mechanism — switching to ANY tool (pointer or
  highlight) auto-opens that tool's sub-toolbar by default; collapsed the two flyout
  booleans (`open` + `colorOpen`) into a single `flyoutOpen` driven by a StrictMode-safe
  "open on activeTool CHANGE" effect (skips mount, so the load-time cursor default does
  not pop a flyout). Clicking the active tool's button toggles it; Esc/outside/switch-
  away/collapse close it. Updated ToolRail + App tests for the new behavior (the old AC4
  "switch opens no flyout" assertion is replaced — switching now opens the target tool's
  bar). Client 258 pass, typecheck clean, contract byte-identical. Live-smoked on a fresh
  own Vite (5174): clean load (no flyout), arming Highlight auto-opens the color picker,
  switching to cursor auto-opens the pointer flyout, both flyouts measure 46px wide
  (unified). Captures: `docs/images/story-2-6-unified-pointer-flyout.png`.
- 2026-06-29: Three user UX refinements (supersede Decision A/B for the rail picker):
  (1) the highlight color sub-toolbox stacks swatches VERTICALLY (scoped CSS override on
  `.tool-flyout .color-swatch-row`, the overlay recolor row stays horizontal);
  (2) switching TO highlight now AUTO-OPENS the sub-toolbox (effect on the highlight-
  active transition) instead of requiring a second click; (3) the active/default color
  is now the LAST color chosen by EITHER the sub-toolbox OR recoloring an existing mark
  ("remember last choice"). To support (3)'s second writer, `activeColor` MOVED from App
  state into the Zustand store (`activeColor` + `setActiveColor`); App subscribes to pass
  it to the rail, the overlay reads it from the store directly (Reader no longer threads
  it), and `recolorSelected` also calls `setActiveColor`. Client 257 pass, typecheck
  clean, contract byte-identical, orange grep clean. Live-smoked on a FRESH own Vite
  (port 5174, per the new CLAUDE.md rule): vertical column confirmed; single click on
  Highlight auto-opens the picker; recoloring a mark to purple then re-arming Highlight
  shows purple armed (default remembered). Capture: `docs/images/story-2-6-vertical-autoopen-flyout.png`.
- 2026-06-29: Shared sub-toolrail component + test trimming.
  (a) Extracted `ToolFlyout` — the ONE sub-toolrail shell (position/box/column) every
  tool renders its controls inside. Both rail buttons now sit in `.tool-rail__item`
  wrappers so the pointer flyout and the highlight color flyout anchor IDENTICALLY (the
  pointer flyout previously anchored to the rail, the color flyout to its button → ~5px
  horizontal mismatch). (b) `ColorSwatchRow` now renders a cell button wrapping an inner
  `color-swatch__dot`, so the rail flyout sizes each swatch to the 36px tool-button cell
  (20px colored dot centered) — matching the pointer options' 36px cell / 20px glyph
  exactly. Overlay recolor row stays compact (cell hugs the 20px dot). Live-measured:
  both flyouts left=66, width=46, cell 36×36, inner element 20×20 (only `top` differs,
  each anchoring to its own button). Capture: `docs/images/story-2-6-shared-subtoolrail.png`.
  (c) Test trimming (per user request): removed the stale "single-click switch opens no
  flyout (AC4)" unit test (rule superseded; one-click switch covered in App.test), the
  redundant "requests the switch in one click" test, and a no-op `toBeDefined` assertion;
  converted a verbose inline-rerender test to the `update()` helper (less brittle to prop
  changes). Client 257 pass, typecheck clean, contract byte-identical.
