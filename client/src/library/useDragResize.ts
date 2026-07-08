import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic drag-to-resize primitive (fix request: column widths, mirroring
 * the folder panel's resize): a single clamped numeric value, adjustable by
 * pointer drag or ArrowLeft/ArrowRight. Document-level `pointermove`/
 * `pointerup` listeners (CLAUDE.md: bind interaction handlers at document
 * level) are added only while dragging. `useResizablePanel` and
 * `useColumnWidths` are both thin instantiations of this - the drag/clamp/
 * keyboard mechanics live in exactly one place.
 *
 * `onCommit` (Story 7.10) fires only with the SETTLED value: once on
 * `pointerup`, and once per keyboard step - never on a per-frame
 * `pointermove` (which would thrash a caller persisting it, e.g.
 * `useColumnWidths` writing to `localStorage`). A `valueRef` mirrors `value`
 * synchronously (not via an effect) so `onCommit` always reads the
 * just-computed number, never a stale render's closure.
 */
export function useDragResize(
  initial: number,
  min: number,
  max: number,
  step = 16,
  onCommit?: (value: number) => void,
) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null);
  // The listener pair actually registered on `document` right now (or `null`
  // between drags). Read/written only by `startResize`/`handlePointerUp`/the
  // unmount effect below - NOT by identity comparison - so an `onCommit` that
  // isn't referentially stable across renders (Story 7.10: `useColumnWidths`
  // passes a fresh closure per key per render) can't desync which listener
  // gets removed from which gets added.
  const attachedRef = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { startX, startValue } = dragRef.current;
      const next = clamp(startValue + (e.clientX - startX));
      valueRef.current = next;
      setValue(next);
    },
    [clamp],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    if (attachedRef.current) {
      document.removeEventListener("pointermove", attachedRef.current.move);
      document.removeEventListener("pointerup", attachedRef.current.up);
      attachedRef.current = null;
    }
    onCommit?.(valueRef.current);
  }, [onCommit]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startValue: value };
      attachedRef.current = { move: handlePointerMove, up: handlePointerUp };
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    },
    [value, handlePointerMove, handlePointerUp],
  );

  // Fix request: unmounting mid-drag left the document-level listeners
  // attached (removed only on the drag's own pointerup), so a later pointer
  // event could call `setValue` on an unmounted component. Empty deps: this
  // runs ONLY on true unmount, never on an `onCommit`/`handlePointerUp`
  // identity change mid-drag (Story 7.10 fix - it used to depend on
  // `[handlePointerMove, handlePointerUp]`, so an unstable `onCommit`
  // silently tore down the live pointerup listener before the user ever
  // released the pointer). `attachedRef` is read fresh at unmount time, so
  // it always removes whatever is CURRENTLY attached, regardless of which
  // render's closures they came from.
  useEffect(() => {
    return () => {
      if (attachedRef.current) {
        document.removeEventListener("pointermove", attachedRef.current.move);
        document.removeEventListener("pointerup", attachedRef.current.up);
      }
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = clamp(valueRef.current - step);
        valueRef.current = next;
        setValue(next);
        onCommit?.(next);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = clamp(valueRef.current + step);
        valueRef.current = next;
        setValue(next);
        onCommit?.(next);
      }
    },
    [clamp, step, onCommit],
  );

  return { value, startResize, handleKeyDown, min, max };
}
