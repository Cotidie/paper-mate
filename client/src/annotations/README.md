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
