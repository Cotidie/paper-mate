import { rowStatusClass, statusLabel, stripPdfExtension } from "@/library/row";
import type { ColumnKey } from "@/library/tableView";

/**
 * An optimistic upload row (Story 6.4): rendered above the settled rows while
 * its `POST /api/docs` is in flight. Not yet a stored paper — no `doc_id`, so
 * it is inert (`aria-disabled`, no selection/open/edit), showing only the
 * filename-as-title and the "Extracting" chip. Cells gate on `visibleColumns`
 * (Story 7.4) same as `PaperRow`, so a hidden column doesn't desync the
 * `<tr>`'s cell count from the `<colgroup>`.
 */
export default function PendingRow({
  filename,
  visibleColumns,
}: {
  filename: string;
  visibleColumns: Set<ColumnKey>;
}) {
  const label = statusLabel("extracting");
  const title = stripPdfExtension(filename);
  return (
    <tr aria-disabled="true" className={rowStatusClass("extracting")}>
      {visibleColumns.has("title") && (
        <td className="collection-table__title" title={title}>
          {title}
        </td>
      )}
      {visibleColumns.has("authors") && <td className="collection-table__authors" />}
      {visibleColumns.has("added") && <td className="collection-table__added" />}
      {visibleColumns.has("file_type") && (
        <td>{label && <span className="badge-pill">{label}</span>}</td>
      )}
      {/* A fresh upload always lands Uncategorized (Dev Notes) - no folder
          lookup needed while it's still pending. */}
      {visibleColumns.has("location") && <td className="collection-table__location">Uncategorized</td>}
    </tr>
  );
}
