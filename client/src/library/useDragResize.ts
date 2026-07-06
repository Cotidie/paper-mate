import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic drag-to-resize primitive (fix request: column widths, mirroring
 * the folder panel's resize): a single clamped numeric value, adjustable by
 * pointer drag or ArrowLeft/ArrowRight. Document-level `pointermove`/
 * `pointerup` listeners (CLAUDE.md: bind interaction handlers at document
 * level) are added only while dragging. `useResizablePanel` and
 * `useColumnWidths` are both thin instantiations of this - the drag/clamp/
 * keyboard mechanics live in exactly one place.
 */
export function useDragResize(initial: number, min: number, max: number, step = 16) {
  const [value, setValue] = useState(initial);
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { startX, startValue } = dragRef.current;
      setValue(clamp(startValue + (e.clientX - startX)));
    },
    [clamp],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startValue: value };
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    },
    [value, handlePointerMove, handlePointerUp],
  );

  // Fix request: unmounting mid-drag left the document-level listeners
  // attached (removed only on the drag's own pointerup), so a later pointer
  // event could call `setValue` on an unmounted component. Removal is a
  // no-op when nothing is attached, so this is safe to run unconditionally
  // on every unmount (and whenever the listener identities themselves change).
  useEffect(() => {
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setValue((prev) => clamp(prev - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setValue((prev) => clamp(prev + step));
      }
    },
    [clamp, step],
  );

  return { value, startResize, handleKeyDown, min, max };
}
