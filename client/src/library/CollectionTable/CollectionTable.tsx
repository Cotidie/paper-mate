import { useRef, useState } from "react";
import type { CollectionRow } from "@/api/client";
import { currentFieldValue, type EditableField, type PendingUpload } from "@/library/row";
import PaperRow from "./PaperRow";
import PendingRow from "./PendingRow";
import "./CollectionTable.css";

const SKELETON_ROW_COUNT = 6;
const COLUMNS = ["Title", "Authors", "Added", "File type"] as const;

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
  | { loading: true; rows?: never; onOpenRow?: never; pendingRows?: never; onEditField?: never }
  | {
      loading?: false;
      rows: CollectionRow[];
      onOpenRow: (docId: string) => void;
      pendingRows?: PendingUpload[];
      onEditField: (docId: string, field: EditableField, value: string | null) => void;
    };

/**
 * Library collection table: rows in, DOM out. Owns no fetch (AD-9:
 * `LibraryPage` fetches, this renders). Rendered in the response's `order`
 * (client sort is Story 7.4), with optimistic `pendingRows` (Story 6.4) above
 * them, newest batch first. A pending row is not yet a stored paper: no
 * `doc_id`, so it is not selectable, openable, or editable (see `PendingRow`).
 * A real row (`PaperRow`) click arms/selects it (purely visual,
 * `aria-selected`); opening a paper is a dedicated Open button in the Title
 * cell (it calls `onOpenRow` directly, independent of arm state). Inline
 * editing on the Title/Authors cells of settled rows requires the row already
 * armed: the table reports `onEditField`, `LibraryPage` owns the `PATCH` +
 * optimistic state (the same split as `onOpenRow`). Selection and the editing
 * cursor are local UI state, not lifted, since nothing outside the table needs
 * them; this shell owns them plus the click-suppression discipline and hands
 * each row a set of clean gesture callbacks.
 */
export default function CollectionTable(props: CollectionTableProps) {
  if (props.loading) return <TableSkeleton />;
  const { rows, onOpenRow, pendingRows = [], onEditField } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ docId: string; field: EditableField } | null>(null);
  // A click that lands elsewhere while a cell is being edited blurs the
  // InlineEditor (auto-committing it) BEFORE the click event itself is
  // dispatched — without a guard, the SAME click that closes one field's
  // edit would immediately arm/edit/open whatever it landed on (fix
  // request: clicking away should only finish editing, not chain into a
  // new action). Set true only inside the actual blur-commit path
  // (`commitEdit(..., viaBlur=true)`) — never on a bare mousedown, which
  // would also fire for an unrelated mousedown *inside* the still-focused
  // input (e.g. repositioning the caret) and could then wrongly swallow a
  // later, unrelated keyboard-triggered action (no mousedown precedes a
  // keyboard Enter/Space activation, so a mousedown-based guard could go
  // stale and eat it). Consumed (checked-and-reset) by the gesture handlers.
  const suppressClickRef = useRef(false);

  // Consume a pending blur-commit suppression: true means "this gesture is the
  // click that just finished an edit; swallow it once". Returns whether it was
  // suppressed so the caller can bail.
  function consumeSuppressedClick(): boolean {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }

  function handleRowClick(docId: string) {
    if (consumeSuppressedClick()) return;
    setSelectedId((prev) => (prev === docId ? null : docId));
  }

  function startEdit(docId: string, field: EditableField) {
    if (consumeSuppressedClick()) return;
    setEditing({ docId, field });
  }

  function openRow(docId: string) {
    if (consumeSuppressedClick()) return;
    onOpenRow(docId);
  }

  function commitEdit(row: CollectionRow, field: EditableField, value: string, viaBlur: boolean) {
    setEditing(null);
    if (viaBlur) suppressClickRef.current = true;
    const trimmed = value.trim();
    if (trimmed === currentFieldValue(row, field)) return; // AC-6: no-op guard
    onEditField(row.doc_id, field, trimmed || null); // AC-7: empty -> null
  }

  return (
    <div className="collection-table-wrap">
      <table className="collection-table">
        <ColumnGroup />
        <TableHead />
        <tbody>
          {pendingRows.map((pending) => (
            <PendingRow key={pending.tempId} filename={pending.filename} />
          ))}
          {rows.map((row) => (
            <PaperRow
              key={row.doc_id}
              row={row}
              armed={selectedId === row.doc_id}
              editingField={editing?.docId === row.doc_id ? editing.field : null}
              onRowClick={() => handleRowClick(row.doc_id)}
              onArm={() => setSelectedId(row.doc_id)}
              onOpen={() => openRow(row.doc_id)}
              onStartEdit={(field) => startEdit(row.doc_id, field)}
              onCommit={(field, value, viaBlur) => commitEdit(row, field, value, viaBlur)}
              onCancel={() => setEditing(null)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
