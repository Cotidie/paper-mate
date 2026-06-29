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
  immediately (create-on-release), then the quick-box shows `ColorSwatchRow` (the
  6 accent colors) to recolor the just-made mark (`store.recolorAnnotation`).
  Cursor-mode drag keeps the 2.2 single-action proof (the cursor tool-type picker
  is Story 2.12).
- `ColorSwatchRow`: the highlight/underline recolor row; later color tools reuse
  it (Story 2.6's arm-time picker, Story 2.5's selection recolor).

Story 2.4 unified the tool state into one `activeTool` FSM (AD-11): mutual
exclusion is by construction (no `mode`+`armedTool` pair to keep in sync), pan
derives from `activeTool === "hand"`, and a rail click switches the tool in a
single click — a per-tool quick-box only opens on drag-release or when the tool
is already active, never in place of a switch. That is what lets Story 2.6 add an
arm-time color picker and Story 2.5 add click-to-select safely on this one model.

Still later stories: underline/pen/memo/comment tools + box-select drag (2.6-2.11),
select-a-highlight (2.5), the cursor-mode drag-to-change-tool picker (2.12), and
editing/undo/persistence (Epic 3).
