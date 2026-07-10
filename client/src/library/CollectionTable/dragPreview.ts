import type { CollectionRow } from "@/api/client";
import { stripPdfExtension } from "@/library/row";

/** A dedicated MIME type for the column-header drag (Story 7.10 AC-1), so a
 *  header drag is distinguishable from the row-move drag (`MOVE_DRAG_MIME`,
 *  `moveDrag.ts`, whose reasoning this mirrors). */
export const COLUMN_DRAG_MIME = "application/x-papermate-column-reorder";

/**
 * A compact custom HTML5 drag image (fix request), built fresh per
 * `dragstart` as a detached DOM node: the browser default is to snapshot the
 * WHOLE dragged element, which for a `<tr>` means the full table width -
 * ugly and unreadable. Mirrors Google Drive's small filename chip + a count
 * badge when more than one item is dragged. Appended off-screen (see
 * `.collection-table__drag-preview`'s `position: fixed; top/left: -9999px`)
 * so the browser can rasterize it before `setDragImage` is called; the
 * caller removes it on the next tick (must still exist at the moment
 * `setDragImage` runs, but the OS-level snapshot is captured synchronously).
 */
export function buildDragPreview(rows: CollectionRow[], ids: string[]): HTMLElement {
  const byId = new Map(rows.map((r) => [r.doc_id, r]));
  const primary = byId.get(ids[0]);
  const title = primary?.title ?? (primary?.filename ? stripPdfExtension(primary.filename) : "Untitled");

  const el = document.createElement("div");
  el.className = "collection-table__drag-preview";
  el.textContent = title;

  if (ids.length > 1) {
    const badge = document.createElement("span");
    badge.className = "collection-table__drag-preview-badge";
    badge.textContent = String(ids.length);
    el.appendChild(badge);
  }

  document.body.appendChild(el);
  return el;
}

/** The column-header drag's own compact preview (Story 7.10): reuses
 *  `buildDragPreview`'s detached-node shape (and its CSS class - no new
 *  styling needed) with just the column's label instead of a row title. */
export function buildColumnDragPreview(label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "collection-table__drag-preview";
  el.textContent = label;
  document.body.appendChild(el);
  return el;
}
