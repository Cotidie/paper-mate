// annotations/ — the overlay VIEW + tool system + quick-box (AD-9). Depends
// downward on anchor/ + store/ only. Built in Story 2.2 (foundation): the
// per-page mark layer, the armed-tool/quick-box state machine, and the
// quick-box shell with one proof action. Tool-specific contents arrive in
// 2.3–2.9.

export { default as AnnotationLayer } from "./AnnotationLayer";
export { default as AnnotationInteraction } from "./AnnotationInteraction";
// The shared color-swatch row (DESIGN.md#color-swatch). Reused by the overlay's
// selection quick-box AND, from Story 2.6, the rail's Highlight color sub-toolbox.
export { default as ColorSwatchRow } from "./ColorSwatchRow";
export { buildAnnotations } from "./create";
export { clampToViewport } from "./position";
export {
  overlayReducer,
  initialOverlayState,
  type OverlayState,
  type OverlayAction,
  type AnnotationTool,
} from "./machine";
