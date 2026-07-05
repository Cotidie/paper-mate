import { useState } from "react";
import type { CollectionRow } from "@/api/client";
import type { PendingUpload } from "@/library/useBulkUpload";
import "@/library/CollectionTable.css";

const SKELETON_ROW_COUNT = 6;
const COLUMNS = ["Title", "Authors", "Added", "File type"] as const;

/** Format an ISO `added` timestamp as a human-readable date (e.g. "Jul 5, 2026"). */
export function formatAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Strip a trailing `.pdf` extension so a filename reads as a title. */
function stripPdfExtension(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

type RowStatus = CollectionRow["status"] | "extracting";

/**
 * Status -> visual seam (Story 6.4 introduces it, Story 6.5 drives it for
 * real settled rows). Only `extracting` renders a label/modifier in this
 * story; every other status (including `ready`, which is all real rows are
 * in 6.4) is the silent default. Keyed off `status`, not "is this a pending
 * row", so 6.5's real `extracting` rows reuse it unchanged.
 */
function statusLabel(status: RowStatus): string | null {
  return status === "extracting" ? "Extracting" : null;
}

function rowStatusClass(status: RowStatus): string | undefined {
  return status === "extracting" ? "collection-table__row--extracting" : undefined;
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
    <div className="collection-table-wrap">
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
    </div>
  );
}

type CollectionTableProps =
  | { loading: true; rows?: never; onOpenRow?: never; pendingRows?: never }
  | {
      loading?: false;
      rows: CollectionRow[];
      onOpenRow: (docId: string) => void;
      pendingRows?: PendingUpload[];
    };

/**
 * Read-only Library collection table: rows in, DOM out. Owns no fetch (AD-9:
 * `LibraryPage` fetches, this renders). Rendered in the response's `order`
 * (client sort is Story 7.4), with optimistic `pendingRows` (Story 6.4) above
 * them, newest batch first. A pending row is not yet a stored paper: no
 * `doc_id`, so it is not selectable or openable. A real row click selects it
 * (arms it); clicking the already-selected row opens it via `onOpenRow`
 * (LibraryPage owns navigation, this component only reports the gesture).
 * Selection is local UI state, not lifted, since nothing outside the table
 * needs it.
 */
export default function CollectionTable(props: CollectionTableProps) {
  if (props.loading) return <TableSkeleton />;
  const { rows, onOpenRow, pendingRows = [] } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleRowClick(docId: string) {
    if (selectedId === docId) {
      onOpenRow(docId);
      setSelectedId(null);
    } else {
      setSelectedId(docId);
    }
  }

  return (
    <div className="collection-table-wrap">
      <table className="collection-table">
        <ColumnGroup />
        <TableHead />
        <tbody>
          {pendingRows.map((pending) => {
            const label = statusLabel("extracting");
            return (
              <tr key={pending.tempId} aria-disabled="true" className={rowStatusClass("extracting")}>
                <td className="collection-table__title" title={stripPdfExtension(pending.filename)}>
                  {stripPdfExtension(pending.filename)}
                </td>
                <td className="collection-table__authors" />
                <td className="collection-table__added" />
                <td>{label && <span className="badge-pill">{label}</span>}</td>
              </tr>
            );
          })}
          {rows.map((row) => {
            // A null title falls back to the filename, extension stripped
            // (still recognizable); `Untitled` is the last resort when
            // neither is known.
            const displayTitle = row.title ?? (row.filename ? stripPdfExtension(row.filename) : null);
            const label = statusLabel(row.status);
            return (
              <tr
                key={row.doc_id}
                aria-selected={selectedId === row.doc_id}
                onClick={() => handleRowClick(row.doc_id)}
                className={rowStatusClass(row.status)}
              >
                <td className="collection-table__title" title={displayTitle ?? undefined}>
                  {displayTitle ?? <span className="collection-table__untitled">Untitled</span>}
                </td>
                <td className="collection-table__authors" title={row.authors ?? undefined}>
                  {row.authors ?? ""}
                </td>
                <td className="collection-table__added">{formatAdded(row.added)}</td>
                <td>
                  {label ? (
                    <span className="badge-pill">{label}</span>
                  ) : (
                    <span className="badge-pill">{row.file_type === "note" ? "Note" : "PDF"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
