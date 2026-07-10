import type { ColumnDef, ColumnKey } from "@/library/tableView";
import { ColumnGroup, TableHead, sumColumnWidths } from "./ColumnHeader";
import "./CollectionTable.css";

const SKELETON_ROW_COUNT = 6;

/** The loading placeholder (Story 6.2): the real header + `<colgroup>` over
 *  shimmer rows, so the table's chrome is stable before the collection loads.
 *  Static headers (no `onSortChange`) render as plain text. */
export default function TableSkeleton({
  visibleColumns,
  columnWidths,
}: {
  visibleColumns: ColumnDef[];
  columnWidths?: Record<ColumnKey, number>;
}) {
  return (
    <div className="collection-table-wrap">
      <table
        className="collection-table"
        aria-busy="true"
        style={{ width: sumColumnWidths(visibleColumns, columnWidths) }}
      >
        <ColumnGroup columns={visibleColumns} widths={columnWidths} />
        <TableHead columns={visibleColumns} sort={null} />
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
            <tr key={i} className="collection-table__skeleton-row">
              {visibleColumns.map((col) => (
                <td key={col.key}>
                  <span className="collection-table__skeleton-cell" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
