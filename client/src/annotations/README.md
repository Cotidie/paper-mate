# annotations/

Annotation layer (view) + tool system + quick-box. Depends downward on
anchor + store only (AD-9 layering).

Built in Story 2.2 (foundation the tool stories 2.3-2.9 reuse):

- `AnnotationLayer`: the per-page VIEW. Renders each stored annotation off
  `anchor.kind` (text marks for the highlight proof), positioned via the anchor
  service against the live card box + scale, so it re-derives on every zoom
  (AC-6) and never reflows the canvas (NFR-1).
- `machine.ts`: the transient-overlay state machine (PREP-3): armed-tool /
  annotating / pending-quick-box / empty.
- `AnnotationInteraction`: document-level selection handling + the
  `{component.quick-box}` shell with one proof action (creates a default
  text-highlight). Tool-specific quick-box contents arrive in 2.3-2.9.
- `create.ts` (`buildAnnotations`) + `position.ts` (`clampToViewport`): the pure
  entity-build (two-page `group_id` split) and on-screen-nudge helpers.

Story 2.3 (highlight tool) adds the first real tool on this foundation:

- The Highlight tool is armed from the rail button or `H` (App owns `armedTool`,
  the single source; the rail shows armed, `AnnotationInteraction` consumes it).
  Sticky until `V`/`Esc`/another tool.
- With highlight armed, a text drag-release LANDS a default-color highlight
  immediately (create-on-release), then the quick-box shows `ColorSwatchRow` (the
  6 accent colors) to recolor the just-made mark (`store.recolorAnnotation`).
  Cursor-mode drag keeps the 2.2 single-action proof (the cursor tool-type picker
  is Story 2.9).
- `ColorSwatchRow`: the highlight/underline recolor row; 2.4 (underline) / 2.5
  (pen) reuse it.

Still later stories: underline/pen/memo/comment/box-select tools (2.4-2.8), the
cursor-mode drag-to-change-tool picker (2.9), and editing/undo/persistence
(Epic 3).
