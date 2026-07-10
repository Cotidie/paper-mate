import { useMemo, useRef, useState } from "react";
import type { ColumnDef, ColumnKey } from "@/library/tableView";
import { reorderColumns as reorderColumnsInOrder } from "@/library/columnReorder";

/** Live drag-over preview (fix request): while a column drag is in
 *  progress, the header/cell order shown to the user already reflects where
 *  it would land, rather than only snapping into place on drop. Reuses the
 *  same `reorderColumns` the drop itself commits, so the preview and the
 *  eventual committed order are computed by the identical logic (a
 *  mid-drag Escape/drop-outside just clears `draggingKey`/`overKey`,
 *  reverting to `columns` with no store write - this is a display-only
 *  overlay, never persisted). */
function livePreviewColumns(
  columns: ColumnDef[],
  draggingKey: ColumnKey | null,
  overKey: ColumnKey | null,
): ColumnDef[] {
  if (!draggingKey || !overKey || draggingKey === overKey) return columns;
  const keys = columns.map((c) => c.key);
  if (!keys.includes(draggingKey) || !keys.includes(overKey)) return columns;
  const previewKeys = reorderColumnsInOrder(keys, draggingKey, overKey);
  return previewKeys.map((k) => columns.find((c) => c.key === k)!);
}

/**
 * The column-header drag machine (Story 7.10): the lifted drag state plus the
 * frozen-geometry resolver that makes the live preview stable. Returns the
 * `tableRef` to attach to the `<table>` (so drag-start can snapshot each
 * header's screen geometry), the `displayColumns` the header + body render
 * from (the live preview, not the committed order — that only changes on drop
 * via `onReorderColumn`), the `dropIndicator` the target header renders, and
 * the four drag handlers `TableHead` wires up.
 */
export function useColumnDrag({
  visibleColumns,
  onReorderColumn,
}: {
  visibleColumns: ColumnDef[];
  onReorderColumn?: (fromKey: ColumnKey, toKey: ColumnKey) => void;
}) {
  // Live column-drag preview (fix request): the key being dragged and the
  // header currently resolved as the target, purely local render state -
  // not persisted, not the committed order (that only changes on drop via
  // `onReorderColumn`). `displayColumns` below is what actually renders.
  const [draggingColumnKey, setDraggingColumnKey] = useState<ColumnKey | null>(null);
  const [dragOverColumnKey, setDragOverColumnKey] = useState<ColumnKey | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  // A FROZEN snapshot of each header's screen geometry, captured ONCE at
  // drag start (fix request - this is the actual oscillation fix, see the
  // dedicated doc comment below). Never re-captured mid-drag.
  const columnRectsRef = useRef<{ key: ColumnKey; left: number; right: number }[]>([]);
  const displayColumns = useMemo(
    () => livePreviewColumns(visibleColumns, draggingColumnKey, dragOverColumnKey),
    [visibleColumns, draggingColumnKey, dragOverColumnKey],
  );
  // The target header + which side the drop indicator renders on (fix
  // request: it always rendered on the LEFT/"before" edge, but
  // `reorderColumns`'s array-move semantics land the dragged column AFTER
  // the target on a forward drag (source left of target in the COMMITTED
  // order) - the indicator must match, or it visibly points at the wrong
  // side of where the column actually settles. Computed from the ORIGINAL
  // committed order, exactly mirroring `reorderColumns`'s own fromIdx/toIdx
  // comparison, so the two can never disagree.
  const dropIndicator = useMemo<{ key: ColumnKey; side: "before" | "after" } | null>(() => {
    if (!draggingColumnKey || !dragOverColumnKey || draggingColumnKey === dragOverColumnKey) return null;
    const keys = visibleColumns.map((c) => c.key);
    const fromIdx = keys.indexOf(draggingColumnKey);
    const toIdx = keys.indexOf(dragOverColumnKey);
    if (fromIdx === -1 || toIdx === -1) return null;
    return { key: dragOverColumnKey, side: fromIdx < toIdx ? "after" : "before" };
  }, [draggingColumnKey, dragOverColumnKey, visibleColumns]);

  /**
   * Resolves a live-preview drag target from the POINTER's raw `clientX`
   * against a geometry snapshot frozen at drag start - never from "which
   * DOM element did this dragover fire on" (fix request, 2nd attempt: a
   * "same-column" guard alone only covered a STATIONARY cursor landing back
   * on the dragged column after one swap; a real, continuously MOVING mouse
   * sweeps across multiple headers while the layout reflows beneath it,
   * which the same-column guard doesn't touch - severe rapid oscillation
   * persisted). Since column WIDTHS never change during a reorder (only
   * their ORDER does), each frozen [left, right) range represents a FIXED
   * screen "slot" for the ENTIRE drag - whichever key occupied that slot in
   * the COMMITTED order at drag-start is a stable, non-reflowing answer to
   * "which key should the dragged column be inserted relative to", exactly
   * matching what `reorderColumns` needs as `toKey`. No feedback loop is
   * possible: the geometry this reads from never itself changes mid-drag.
   */
  function resolveColumnKeyAtClientX(clientX: number): ColumnKey | null {
    const rects = columnRectsRef.current;
    if (rects.length === 0) return null;
    if (clientX <= rects[0].left) return rects[0].key;
    const last = rects[rects.length - 1];
    if (clientX >= last.right) return last.key;
    for (const rect of rects) {
      if (clientX >= rect.left && clientX < rect.right) return rect.key;
    }
    return last.key;
  }

  function captureColumnRects() {
    const ths = tableRef.current?.querySelectorAll<HTMLElement>("thead th[data-column-key]");
    columnRectsRef.current = Array.from(ths ?? []).map((th) => {
      const rect = th.getBoundingClientRect();
      return { key: th.dataset.columnKey as ColumnKey, left: rect.left, right: rect.right };
    });
  }

  function handleColumnDragStart(key: ColumnKey) {
    captureColumnRects();
    setDraggingColumnKey(key);
  }

  function handleColumnDragOverAt(clientX: number) {
    const key = resolveColumnKeyAtClientX(clientX);
    if (key) setDragOverColumnKey(key);
  }

  function handleColumnDragEnd() {
    setDraggingColumnKey(null);
    setDragOverColumnKey(null);
    columnRectsRef.current = [];
  }

  function commitColumnDrop() {
    if (draggingColumnKey && dragOverColumnKey && draggingColumnKey !== dragOverColumnKey) {
      onReorderColumn?.(draggingColumnKey, dragOverColumnKey);
    }
    handleColumnDragEnd();
  }

  return {
    tableRef,
    displayColumns,
    dropIndicator,
    handleColumnDragStart,
    handleColumnDragOverAt,
    handleColumnDragEnd,
    commitColumnDrop,
  };
}
