# annotations/

Annotation layer (view) + tool system + quick-box. Depends downward on
anchor + store only (AD-9 layering).

Built in Story 2.2 (foundation the tool stories 2.3-2.9 reuse):

- `AnnotationLayer`: the per-page VIEW. Renders each stored annotation off
  `anchor.kind` (text marks for the highlight proof), positioned via the anchor
  service against the live card box + scale, so it re-derives on every zoom
  (AC-6) and never reflows the canvas (NFR-1).
- `machine.ts`: the transient-overlay state machine (PREP-3): armed-tool /
  annotating / pending-quick-box / empty. Since Story 2.4 it is driven by the
  ONE tool model (AD-11): the armed annotation tool is derived from App's single
  `activeTool` and mirrored down via the `armedTool` prop, which is its sole
  writer — the machine never self-arms (it only carries the armed tool through
  its transient states). The tool union lives in the zero-import `tools.ts` leaf;
  `AnnotationTool` is re-exported from this barrel for back-compat.
- `AnnotationInteraction`: document-level selection handling + the
  `{component.quick-box}` shell with one proof action (creates a default
  text-highlight). Tool-specific quick-box contents arrive in 2.3-2.9.
- `create.ts` (`buildAnnotations`) + `position.ts` (`clampToViewport`): the pure
  entity-build (two-page `group_id` split) and on-screen-nudge helpers.

Story 2.3 (highlight tool) adds the first real tool on this foundation:

- The Highlight tool is armed from the rail button or `H`. App owns the single
  `activeTool` (AD-11); when it is an annotation tool the rail shows it armed and
  `AnnotationInteraction` consumes it via `armedTool`. Sticky until
  `V`/`Esc`/another tool.
- With highlight armed, a text drag-release LANDS a default-color highlight
  immediately (create-on-release). Since Story 2.5 the just-made mark is then
  SELECTED, so the unified selection quick-box (recolor + delete) takes over —
  there is no separate create quick-box (one affordance for "act on a mark",
  whether just-created or clicked later). Cursor-mode drag keeps the 2.2
  single-action proof button, which also selects the mark after it creates (the
  cursor tool-type picker is Story 2.12).
- `ColorSwatchRow`: the highlight/underline recolor row; later color tools reuse
  it (Story 2.6's arm-time picker, Story 2.5's selection recolor).

Story 2.4 unified the tool state into one `activeTool` FSM (AD-11): mutual
exclusion is by construction (no `mode`+`armedTool` pair to keep in sync), pan
derives from `activeTool === "hand"`, and a rail click switches the tool in a
single click — a per-tool quick-box only opens on drag-release or when the tool
is already active, never in place of a switch. That is what lets Story 2.6 add an
arm-time color picker and Story 2.5 add click-to-select safely on this one model.

Story 2.5 adds the selection seam (AD-12) — the first way to act on an EXISTING
mark, decoupled from the create machine and the Epic-3 command stack:

- One `selectedId: string | null` in the store is the single source of truth for
  selection (`select`/`clearSelection`), plus a group-aware `deleteAnnotation`
  (removes the id AND its `group_id` siblings, so a two-page highlight deletes
  both pages; clears `selectedId` if it was in the set). Client-only — no
  persistence/undo yet (that is the seed Story 3.3 reuses).
- The highlight marks are now pointer-interactive (Decision A): each mark rect IS
  the page-normalized anchor rect (`denormalizeRect`), so `pointer-events:auto` +
  `cursor:pointer` make it the hit surface. Hovering outlines the WHOLE annotation
  (a per-layer transient `hoveredId`) and shows the pointer cursor (NOT the text
  I-beam) — so you cannot start a new highlight over an existing one. Clicking
  selects it (a `--selected` ring, stronger than the hover outline). Recent-wins:
  marks render sorted by `created_at` ascending (newest on top wins overlap). The
  rest of the layer sheet stays `pointer-events:none`, so non-highlighted text
  stays selectable (trade-off: you cannot text-select over a highlight).
- The selection quick-box is a SEPARATE render path off `selectedId` (Decision B,
  NOT `machine.ts`): it reuses `ColorSwatchRow` (armed to the mark's current
  color → `store.recolorAnnotation`, reused from 2.3) + a Delete action, reusing
  the `.quick-box` shell + `clampToViewport`. A pick dismisses the box but keeps
  the mark selected/ringed; clicking a mark again reopens its box. `Del`/
  `Backspace` delete; `Esc` or a pointerdown on empty page content clears the
  selection (document-level, phase-gated, editable/buttons/chrome exempt so the
  toolbar/zoom keep it). Scroll (including zoom recenters) only CLOSES the
  floating box — the ring rides the denormalized rect and stays glued (NFR-3). Selection works in cursor mode AND while a highlight
  tool is active (a pointerdown on a mark selects; empty text falls through to the
  2.3 create path). a11y: the layer stays decorative (`aria-hidden`); selection is
  a pointer affordance with document-level Del/Esc — a keyboard-reachable list
  comes with the Epic-3 Annotation Bank.

Still later stories: underline/pen/memo/comment tools + box-select drag (2.6-2.11),
the cursor-mode drag-to-change-tool picker (2.12), and editing/undo/persistence
(Epic 3).
