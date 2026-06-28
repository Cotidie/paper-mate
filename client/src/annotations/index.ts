// annotations/ — the overlay VIEW + tool system + quick-box (AD-9). Depends
// downward on anchor/ + store/ only. Built in Story 2.2 (foundation): the
// per-page mark layer, the armed-tool/quick-box state machine, and the
// quick-box shell with one proof action. Tool-specific contents arrive in
// 2.3–2.9.

export { default as AnnotationLayer } from "./AnnotationLayer";
export { default as AnnotationInteraction } from "./AnnotationInteraction";
export { buildAnnotations } from "./create";
export { clampToViewport } from "./position";
export {
  overlayReducer,
  initialOverlayState,
  type OverlayState,
  type OverlayAction,
  type AnnotationTool,
} from "./machine";
