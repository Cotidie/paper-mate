import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Floats an in-cell editor OVER its table cell (fix request: editing a tag
 * cell must not grow the row, Notion-style). Portaled to `document.body` and
 * `position: fixed`, anchored to the cell's own `getBoundingClientRect()` -
 * the same escape-the-table pattern `usePopover` documents (a portal sidesteps
 * the table's stacking/paint model and any transformed ancestor). The static
 * cell stays mounted underneath at its normal one-line height, so the table
 * never reflows; the panel overlays the cell (same top/left, min-width == the
 * cell's width) and grows DOWNWARD as chips are added.
 *
 * Repositions on scroll (capture, so the table body's own scroll container
 * counts, not just window) and resize, so the panel tracks the cell instead of
 * being stranded when the page moves under it.
 */
export default function FloatingCellEditor({
  anchorRef,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // A passive effect, NOT `useLayoutEffect`: the anchor is this component's own
  // ANCESTOR cell, and a descendant's layout effect fires BEFORE its ancestor's
  // ref is attached (React commits layout work child-first), so `anchorRef`
  // would still be null there. Passive effects run after the whole commit, once
  // every ref is set. The panel returns null until measured, so there is no
  // flash of a mispositioned editor - it simply appears in place.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const measure = () => {
      const r = anchor.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [anchorRef]);

  if (!rect) return null;
  return createPortal(
    <div className="floating-cell-editor" style={{ top: rect.top, left: rect.left, minWidth: rect.width }}>
      {children}
    </div>,
    document.body,
  );
}
