# Epic 5: Reader preferences & polish (post-v1, Phase-1.5)

> Added 2026-06-30 via correct-course. Groups the preferences, color-system, interaction-polish, and structural-refactor items from `deferred-work.md`. Theme: let the reader tune the app and make the chrome recede further, plus pay down the structural debt the tool stories accrued. Post-v1.

## Story 5.0: Codebase structural refactor (data contracts + conditional/FSM unification + src split)

> deferred-work: "lean on data classes", "unify conditional logic + FSM-isolated state", "src folder structural refactoring" — ONE refactor thread. **Sequencing note:** this is ideally done at the Epic-2/Epic-3 boundary (before 3.1 builds the command path on the current sprawl). It is tracked in Epic 5 for grouping, but pull it EARLIER if Epic 3 work is blocked by the sprawl. No behavior/contract change.

As a developer,
I want the annotation code unified behind data contracts, a per-tool descriptor/FSM, and a clean module split,
So that adding a tool or an edit is one registration, not edits across five `if` chains.

**Acceptance Criteria:**

**Given** the per-tool/per-kind conditional sprawl (`AnnotationLayer`/`AnnotationInteraction`/`create.ts`/`store`)
**Then** it is unified behind ONE descriptor/registry keyed on `anchor.kind` + `type` (AD-5 as the dispatch key), so a new tool registers one entry; the near-twin builders and `set()` blocks consolidate (AR-9)

**Given** recurring loose shapes (create-options twins, `active*`/`setActive*`/`*Ref` fans, point/rect math)
**Then** they become typed data contracts (one "create request" per tool, one "active-tool defaults" object — ties into Story 5.2, narrower prop bundles); any data class WRAPS the generated `Annotation` type, never shadows it (AR-3)

**Given** the fragmented interaction state (selection / quick-box / pen-draft / memo-cleanup / flyout / Esc across components)
**Then** the overlay lifecycle consolidates into one explicit FSM (extends `machine.ts`, AD-11/PREP-3); the duplicated App+overlay Esc logic collapses (enables Story 5.6 layered Esc)

**Given** the refactor
**Then** client + server suites stay green and the tracked OpenAPI contract is byte-identical; both `vi.mock("./render")` barrels updated if any `render/` export moves; `no-raw-values` re-run after CSS moves; its own PR(s), never folded into a feature story

## Story 5.1: Settings modal + custom hotkey rebinding

> deferred-work: "Settings modal in the toolbox (hotkey rebinding first)". The real cost is the keymap-as-data enabler; the modal UI is secondary.

As a reader,
I want a Settings modal where I can rebind hotkeys,
So that the keyboard map fits my habits.

**Acceptance Criteria:**

**Given** the hard-coded `e.key === "h"` keydown literals in `App.tsx`
**Then** they are first refactored into a single keymap data structure (action → binding, a store slice + a `useKeymap` lookup) the document keydown reads — the enabler that makes rebinding possible (FR-24, AD-11)

**Given** a Settings affordance in the toolbox/tool-rail (Phosphor `Gear`/`Sliders`)
**When** I open it
**Then** a focus-trapped, `Esc`-dismissable `{component}` modal opens with a keybinding pane listing every action (UX-DR15 map) and a "press a key" capture field per action (exempt from the global tool keys while capturing) (FR-24, UX-DR17)

**Given** a rebind
**Then** conflict detection blocks two actions on one key, a reset-to-defaults exists, browser/OS-critical combos are reserved; preferences persist in `localStorage` (app-global, not per-doc `~/.paper-mate`); token-driven, no em-dash in copy; no contract change (FR-24)

## Story 5.2: Color system — per-tool default + custom slots — DESCOPED from v1 (2026-07-02)

> **DESCOPED (2026-07-02, product decision, never attempted).** No longer needed for v1; not built. `sprint-status.yaml` marks it `blocked` so Epic 5 can still close once its remaining stories reach `done`. The spec below is retained as the source if it is ever re-promoted (see `deferred-work.md` "Descoped: Story 5.2").

> deferred-work: "per-tool remembered default color" + "custom color slot(s) + color picker, cached in the browser". Both reshape the single shared `activeColor`; do together.

As a reader,
I want each tool to remember its own color and to add custom colors,
So that changing the highlight color doesn't change the pen, and I'm not limited to the fixed palette.

**Acceptance Criteria:**

**Given** the single shared `activeColor` (one store field, every tool writes it)
**Then** it becomes a per-tool map (`activeColorByTool` + `setActiveColor(tool, color)`); the create path reads the armed tool's color; each flyout shows/sets its own; recolor updates that mark's `type` only; the selection quick-box still shows the SELECTED mark's own color (FR-25)

**Given** a "More colors" affordance at the tail of every `ColorSwatchRow` (highlight/underline/pen/memo flyouts + selection quick-box)
**When** I pick a custom color
**Then** it slides into the row tail as a fixed-count FIFO window (newest appended, oldest off), persisted in `localStorage`; decide the window size and whether the named defaults can rotate off (FR-25)

**Given** the custom-hex contract risk
**Then** custom colors map to runtime CSS vars (`--color-annotation-custom-N`) seeded from `localStorage` at boot (PREFERRED — keeps `style.color` a token name, no contract break, stays in `theme/` + `annotations/`); `no-raw-values` is honored (hex routed through the theme layer, never inlined) (AR-3, AR-12)

## Story 5.3: React client structural refactor — modularize Reader/AnnotationLayer/AnnotationInteraction

> User request (2026-07-02): `Reader.tsx`, `AnnotationLayer.tsx`, and `AnnotationInteraction.tsx` have bloated since Story 5.0's gesture-hook extraction (2293 combined lines). Modularize further, deduplicate, remove dead code. A pure refactor thread, same footing as Story 5.0 — its own PR(s), never folded into a feature story.

As a developer,
I want `Reader`/`AnnotationLayer`/`AnnotationInteraction` split into cohesive, single-responsibility modules with no dead code or duplication,
So that the overlay/reader composition root stays legible and the next tool/story doesn't have to wade through three 600-800 line files to find where it hooks in.

**Acceptance Criteria:**

**Given** `Reader.tsx` / `AnnotationLayer.tsx` / `AnnotationInteraction.tsx` (2293 combined lines post-5.0)
**Then** each is decomposed into smaller, cohesive units (extracted hooks/components/pure helpers) along the SAME OOP/encapsulation approach Story 5.0 chose (each concern owns its own state/refs, not a shared conditional sprawl); no god-component remains the dumping ground for unrelated concerns

**Given** the extraction
**Then** duplicated logic (across these 3 files AND vs. the existing `gestures/`/`render/`/`anchor/` layers) is consolidated to one definition; dead code (unreferenced exports, stale branches, superseded comments) is deleted, not left "just in case"

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json`/`schema.d.ts` byte-identical, both `vi.mock("./render")` barrels updated if any export moves, re-smoked live at DPR>1 cross-page (the standing `annotations/` selection-geometry risk)

**Given** AD-9 layering (`render/` → `anchor/` → `annotations/` → `App`) and the zero-import-leaf convention (`tools.ts`, `domFocus.ts`)
**Then** the new module boundaries respect it; no upward imports introduced

## Story 5.4: React client `src/` module layout (folder-structure refactor)

> User request (2026-07-02): `client/src/` root is flat: 38 files (`.tsx`/`.ts`/`.css`/`.test.*`) piled beside the existing layer dirs (`anchor/`, `annotations/`, `render/`, `store/`, `api/`, `reader/`, `settings/`, `theme/`). Adopt the `/scaffold-react` folder convention (adapted to this Vite + TS + Zustand stack): colocate each component with its CSS + test, give hooks and pure leaves a home, keep only entry/config files at the root. A pure refactor thread, same footing as Story 5.0 / 5.3, so it gets its own PR(s), never folded into a feature story. No behavior/contract change.

As a developer,
I want `client/src/` reorganized into the scaffold-react folder layout instead of 38 flat root files,
So that a component, hook, or helper lives in an obvious place and the root stops being a dumping ground.

**Acceptance Criteria:**

**Given** the flat `client/src/` root (component `.tsx` + colocated `.css` + `.test.tsx` for `Reader`/`BankPanel`/`EmptyDropzone`/`SaveIndicator`/`Toast`/`TocPanel`/`ToolRail`/`ToolFlyout`/`ZoomControl`, plus loose `bank.ts`/`tools.ts`/`domFocus.ts`/`uuid.ts`/`useAutosave.ts`/`useLiveRef.ts` and their `.test.*` siblings)
**Then** each reusable component moves into `components/<Name>/` (its `.tsx` + `.css` + `.test.tsx` colocated, one folder per component, per the scaffold-react convention); hooks (`use*`) get a hooks home; pure zero-import leaves (`tools.ts`, `domFocus.ts`, `uuid.ts`, `bank.ts`) get a `lib/`-style home, so no reusable component or helper is left loose at the root

**Given** this repo's stack differs from the CRA source scaffold (Vite + TS + Zustand + generated tokens; a single-view reader with no `react-router` `pages/`)
**Then** the scaffold's ARCHITECTURE is adapted, not copied literally: the existing AD-9 layer dirs (`render/`, `anchor/`, `annotations/`, `store/`, `api/`, `reader/`, `settings/`, `theme/`) are preserved as-is (they already ARE the modular boundaries), only the flat root files are foldered, and no toolchain / token / generated-file / Storybook rules are introduced or changed (scaffold rule: preserve the target toolchain)

**Given** the entry + composition-root files (`main.tsx`, `App.tsx`/`App.css`, `index.css`, `vite-env.d.ts`) and the cross-cutting guard suites (`no-raw-values.test.ts`, `focus-ring.test.ts`)
**Then** the entry + `App` root stay at `src/` root (the scaffold keeps the app entry at root); the guard suites land wherever keeps their file-globbing valid; every moved file's imports AND every importer are updated, including both `vi.mock("./render")` barrels (`App.test`, `Reader.test`) fixed for their new relative paths

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` byte-identical, `no-raw-values` re-run after any CSS move, no upward imports introduced (AD-9 downward-only layering), and re-smoked live at DPR>1 cross-page (the standing `annotations/` selection-geometry risk); its own PR(s), never folded into a feature story

## Story 5.5: Hide/show all annotations toggle

> deferred-work: "hide/show all annotations toggle".

As a reader,
I want one toggle to hide/show ALL annotations,
So that I can read the clean page and bring my marks back.

**Acceptance Criteria:**

**Given** a top-bar `top-bar__actions` icon button (Phosphor eye / eye-slash, `aria-pressed`, plain `title`/`aria-label`, no em-dash)
**When** I toggle it OFF
**Then** the overlay paints NOTHING and marks are not pointer-interactive (no hover/select); the underlying text stays selectable; ON restores everything unchanged (FR-23, NFR-1)

**Given** the toggle
**Then** it is ONE global view-only flag (composition root or store, sibling of `activeTool`/`selectedId`), threaded to `AnnotationLayer` (skip render) and `AnnotationInteraction` (suppress create/select while hidden); it NEVER mutates/deletes an annotation; clear `selectedId` on hide; decide whether the flag survives reload (FR-23)

## Story 5.6: Interaction polish — layered Esc, in-editor confirm, collapsed stroke-width

> deferred-work: "layered Esc", "confirm (check) affordance on memo + comment editors", "collapse the pen stroke-width row into a single dropdown". Small UX refinements; layered Esc depends on Story 5.0's Esc consolidation.
>
> **2026-07-03 RESCOPE (user decision):** shipped as **layered-Esc ONLY**. AC-2 (in-editor confirm check) and AC-3 (collapsed pen stroke-width dropdown) below are **DISCARDED** — not built, not deferred. Kept here (marked) for provenance; the delivered scope is AC-1. See `.bmad/implementation-artifacts/epic-5/5-6-interaction-polish-esc-confirm-strokewidth.md`.

As a reader,
I want Esc to do the most-local thing, an explicit confirm on note editors, and a compact stroke-width control,
So that the annotate interactions feel precise and uncluttered.

**Acceptance Criteria:**

**Given** an `Esc` press
**Then** it resolves in priority order, consuming the event at the first match: (1) an open/edited transient box (empty memo removed, non-empty blurs) → cancel it; (2) else a selected mark → clear selection (stay in tool); (3) else → return the tool to cursor — so the FIRST Esc clears selection without disarming, a SECOND returns to cursor (UX-DR15; builds on Story 5.0)

**Given** the memo (`MemoBox`) and comment (`CommentBubble`) editors
**Then** each gets a check (Phosphor `Check`) confirm control that commits `body` and exits; preserve multi-line input (bind the button + `Ctrl/Cmd+Enter`, keep plain `Enter` as newline, or `Enter` confirms + `Shift+Enter` newline — pick one); keyboard-reachable, token icon, no em-dash; same `retext`/`clearSelection` path, no contract change (UX-DR8, UX-DR17)

**Given** the pen `StrokeWidthRow` (three preset dots in a row)
**Then** it becomes a compact collapsible control (trigger shows current width + caret → vertical thin/medium/thick list; pick collapses) matching the memo `SizeRow` pattern; update the Story 2.8 tests that asserted all three step buttons visible; presentation only, no model/contract change

## Story 5.7: Dim the Table-of-Contents panel until hovered — DESCOPED from v1 (2026-07-03)

> **DESCOPED (2026-07-03, product decision, never attempted).** No longer needed for v1; not built. `sprint-status.yaml` marks it `blocked` so Epic 5 can still close once its remaining stories reach `done`. The spec below is retained as the source if it is ever re-promoted (see `deferred-work.md` "Descoped: Story 5.7").

> deferred-work: "dim the Table-of-Contents panel until hovered". UX polish toward immersion (NFR-5).

As a reader,
I want the ToC panel dimmed at rest and full on hover,
So that it recedes while reading but is there when I reach for it.

**Acceptance Criteria:**

**Given** the `TocPanel` (Story 1.9) at rest
**Then** it sits at ~0.4 opacity and lifts to full opacity on `:hover`/`:focus-within` with a short transition; it stays clickable at rest (default read) (UX-DR11, NFR-5)

**Given** the fade
**Then** it respects `prefers-reduced-motion` (degrade to instant, UX-DR17), is token-driven (`--toc-panel-resting-opacity`, no raw values), and changes nothing in the contract/store — pure presentation

## Story 5.8: Doc-scope the annotation store (retire the cross-doc autosave guard)

> Correct-course 2026-07-02 (`sprint-change-proposal-2026-07-02.md`), closing action items AE-4 / AE3-3. The store holds `annotations` without owning which doc they belong to, so autosave leans on a `useAutosave` `generationRef` guard to stop one doc's marks flushing onto another across a doc switch (the Story 3.4 HIGH Codex finding). Make ownership atomic instead. A developer refactor story: no new FR, no contract change. Needs a doc-switch DPR>1 live smoke (AE-5) before done.

As a developer,
I want the store to own `(docId, annotations)` as one atomic unit,
So that a doc switch swaps both together and autosave can bind to the store's own `docId` instead of a defensive generation-counter guard.

**Acceptance Criteria:**

**Given** the store holds `annotations` without the owning `docId`, and `useAutosave` uses a `generationRef` to guard a stale flush from landing on the wrong doc (AR-6, the Story 3.4 HIGH finding)
**Then** the store owns `(docId, annotations)` atomically: opening/switching a doc sets both in one update, hydrate-on-open replaces both, and there is no window where `annotations` belong to one doc while `docId` reads another

**Given** the atomic ownership
**Then** autosave binds to `store.docId` (a flush targets the doc the store currently owns), and the `useAutosave` `generationRef` cross-doc guard is deleted, not left as a redundant belt-and-braces check (AR-6, AR-7)

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` byte-identical, and it is live-smoked across a doc SWITCH at DPR>1 (open doc A, annotate, open doc B, confirm A's marks never flush onto B and B restores its own) (AE-5, AR-6)

---
