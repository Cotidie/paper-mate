import { useDragResize } from "@/library/useDragResize";

/** Matches the shared `--toc-panel-width` token (the folder panel's default,
 *  pre-resize, width). */
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const KEYBOARD_STEP = 16;

/**
 * Drag-to-resize for the Library's folder panel (fix request): client-only
 * UI state, resets to `DEFAULT_WIDTH` on reload (same footing as Story 7.4's
 * other view-state - not persisted, AD-L3). A thin instantiation of the
 * generic `useDragResize` primitive (shared with `useColumnWidths`).
 */
export function useResizablePanel() {
  const { value: width, startResize, handleKeyDown, min: minWidth, max: maxWidth } = useDragResize(
    DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_WIDTH,
    KEYBOARD_STEP,
  );
  return { width, startResize, handleKeyDown, minWidth, maxWidth };
}
