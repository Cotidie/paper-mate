import type { CollectionRow } from "@/api/client";
import "@/library/CollectionTable.css";

const SKELETON_ROW_COUNT = 6;
const COLUMNS = ["Title", "Authors", "Added", "File type"] as const;

/** Format an ISO `added` timestamp as a human-readable date (e.g. "Jul 5, 2026"). */
export function formatAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ColumnGroup() {
  return (
    <colgroup>
      <col className="collection-table__col-title" />
      <col className="collection-table__col-authors" />
      <col className="collection-table__col-added" />
      <col className="collection-table__col-file-type" />
    </colgroup>
  );
}

function TableHead() {
  return (
    <thead>
      <tr>
        {COLUMNS.map((label) => (
          <th key={label} scope="col">
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function TableSkeleton() {
  return (
    <table className="collection-table" aria-busy="true">
      <ColumnGroup />
      <TableHead />
      <tbody>
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
          <tr key={i} className="collection-table__skeleton-row">
            {COLUMNS.map((label) => (
              <td key={label}>
                <span className="collection-table__skeleton-cell" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type CollectionTableProps =
  | { loading: true; rows?: never }
  | { loading?: false; rows: CollectionRow[] };

/**
 * Read-only Library collection table (Story 6.3): rows in, DOM out. Owns no
 * fetch (AD-9: `LibraryPage` fetches, this renders). Rendered in the
 * response's `order` (client sort is Story 7.4).
 */
export default function CollectionTable(props: CollectionTableProps) {
  if (props.loading) return <TableSkeleton />;
  const { rows } = props;

  return (
    <div className="collection-table-wrap">
      <p className="collection-table__count">{rows.length} files in library</p>
      <table className="collection-table">
        <ColumnGroup />
        <TableHead />
        <tbody>
          {rows.map((row) => (
            <tr key={row.doc_id}>
              <td className="collection-table__title" title={row.title ?? undefined}>
                {row.title ?? <span className="collection-table__untitled">Untitled</span>}
              </td>
              <td className="collection-table__authors" title={row.authors ?? undefined}>
                {row.authors ?? ""}
              </td>
              <td className="collection-table__added">{formatAdded(row.added)}</td>
              <td>
                <span className="badge-pill">{row.file_type === "note" ? "Note" : "PDF"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
