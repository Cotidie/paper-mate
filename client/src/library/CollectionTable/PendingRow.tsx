import type { ReactNode } from "react";
import { rowStatusClass, statusLabel, stripPdfExtension } from "@/library/row";
import type { ColumnDef } from "@/library/tableView";

/**
 * An optimistic upload row (Story 6.4): rendered above the settled rows while
 * its `POST /api/docs` is in flight. Not yet a stored paper — no `doc_id`, so
 * it is inert (`aria-disabled`, no selection/open/edit), showing only the
 * filename-as-title and the "Extracting" chip. `visibleColumns` is the
 * ORDERED column list (Story 7.10, AC-6, same as `PaperRow`): cells render
 * via `.map` in that order so a hidden column omits its cell, and a
 * persisted reorder still lines up with the `<colgroup>`/`<th>`s above it.
 */
export default function PendingRow({
  filename,
  visibleColumns,
}: {
  filename: string;
  visibleColumns: ColumnDef[];
}) {
  const label = statusLabel("extracting");
  const title = stripPdfExtension(filename);

  function renderCell(col: ColumnDef): ReactNode {
    switch (col.key) {
      case "title":
        return (
          <td key="title" className="collection-table__title" title={title}>
            {title}
          </td>
        );
      case "authors":
        return <td key="authors" className="collection-table__authors" />;
      // A fresh upload has no Crossref-enriched metadata yet (it settles via
      // the background pipeline, Story 7.9) - empty cells, no lookup.
      case "venue_short":
        return <td key="venue_short" className="collection-table__venue-short" />;
      case "venue":
        return <td key="venue" className="collection-table__venue" />;
      case "year":
        return <td key="year" className="collection-table__year" />;
      // A fresh upload always lands Uncategorized (Dev Notes) - no folder
      // lookup needed while it's still pending; an uncategorized Location
      // cell renders empty (fix request), matching `PaperRow`'s own cell.
      case "location":
        return <td key="location" className="collection-table__location" />;
      case "added":
        return <td key="added" className="collection-table__added" />;
      case "file_type":
        return <td key="file_type">{label && <span className="badge-pill">{label}</span>}</td>;
      case "doi":
        return <td key="doi" className="collection-table__doi" />;
    }
  }

  return (
    <tr aria-disabled="true" className={rowStatusClass("extracting")}>
      {visibleColumns.map((col) => renderCell(col))}
    </tr>
  );
}
