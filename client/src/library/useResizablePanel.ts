import { useCallback, useRef, useState } from "react";

/** Matches the shared `--toc-panel-width` token (the folder panel's default,
 *  pre-resize, width). */
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const KEYBOARD_STEP = 16;

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

/**
 * Drag-to-resize for the Library's folder panel (fix request): client-only
 * UI state, resets to `DEFAULT_WIDTH` on reload (same footing as Story 7.4's
 * other view-state - not persisted, AD-L3). The drag itself is tracked via
 * document-level `pointermove`/`pointerup` listeners (CLAUDE.md: bind
 * interaction handlers at document level) added only while dragging, so a
 * fast drag that leaves the handle's own hit area is still tracked.
 */
export function useResizablePanel() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const { startX, startWidth } = dragRef.current;
    setWidth(clamp(startWidth + (e.clientX - startX)));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    },
    [width, handlePointerMove, handlePointerUp],
  );

  // ArrowLeft/ArrowRight keyboard resize (the handle is a real, focusable
  // `role="separator"`) - a drag gesture has no keyboard equivalent otherwise.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setWidth((prev) => clamp(prev - KEYBOARD_STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setWidth((prev) => clamp(prev + KEYBOARD_STEP));
    }
  }, []);

  return { width, startResize, handleKeyDown, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH };
}
