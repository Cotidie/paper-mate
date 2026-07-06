import { useRef, useState } from "react";
import type { CollectionRow } from "@/api/client";
import { currentFieldValue, stripPdfExtension, type EditableField, type PendingUpload } from "@/library/row";
import { MOVE_DRAG_MIME, encodeDragIds } from "@/library/moveDrag";
import PaperRow from "./PaperRow";
import PendingRow from "./PendingRow";
import "./CollectionTable.css";

const SKELETON_ROW_COUNT = 6;
const COLUMNS = ["Title", "Authors", "Added", "File type"] as const;
const EMPTY_CHECKED: Set<string> = new Set();

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
function buildDragPreview(rows: CollectionRow[], ids: string[]): HTMLElement {
  const byId = new Map(rows.map((r) => [r.doc_id, r]));
  const primary = byId.get(ids[0]);
  const title =
    primary?.title ?? (primary?.filename ? stripPdfExtension(primary.filename) : "Untitled");

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
  | {
      loading: true;
      rows?: never;
      onOpenRow?: never;
      pendingRows?: never;
      onEditField?: never;
      checkedIds?: never;
      onToggleChecked?: never;
    }
  | {
      loading?: false;
      rows: CollectionRow[];
      onOpenRow: (docId: string) => void;
      pendingRows?: PendingUpload[];
      onEditField: (docId: string, field: EditableField, value: string | null) => void;
      /** Ctrl/Cmd+click multi-select (Story 7.2 fix request) for the toolbar's
       *  bulk Move + drag-to-folder; lifted to `LibraryPage` since the toolbar
       *  needs it too. */
      checkedIds?: Set<string>;
      onToggleChecked?: (docId: string) => void;
    };

/**
 * Library collection table: rows in, DOM out. Owns no fetch (AD-9:
 * `LibraryPage` fetches, this renders). Rendered in the response's `order`
 * (client sort is Story 7.4), with optimistic `pendingRows` (Story 6.4) above
 * them, newest batch first. A pending row is not yet a stored paper: no
 * `doc_id`, so it is not selectable, openable, or editable (see `PendingRow`).
 * A plain row click arms/selects it (purely visual, `aria-selected`); opening
 * a paper is a dedicated Open button in the Title cell (it calls `onOpenRow`
 * directly, independent of arm state). Inline editing on the Title/Authors
 * cells of settled rows requires the row already armed: the table reports
 * `onEditField`, `LibraryPage` owns the `PATCH` + optimistic state (the same
 * split as `onOpenRow`). The single-row arm (`selectedId`) and the editing
 * cursor are local UI state, not lifted, since nothing outside the table
 * needs them. Ctrl/Cmd+click instead toggles `checkedIds` (lifted to
 * `LibraryPage`, controlled, default empty - the toolbar's bulk Move button
 * needs it too), intercepted at the row's CAPTURE phase so it never also
 * arms/edits/opens; a checked row's `dragstart` carries the whole checked set
 * (else just itself) for drag-to-folder.
 */
export default function CollectionTable(props: CollectionTableProps) {
  if (props.loading) return <TableSkeleton />;
  const {
    rows,
    onOpenRow,
    pendingRows = [],
    onEditField,
    checkedIds = EMPTY_CHECKED,
    onToggleChecked = () => {},
  } = props;
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

  // Ctrl/Cmd+click toggles multi-select instead of arming/editing. Fires in
  // the CAPTURE phase (before the Title/Authors cells' own bubble-phase click
  // handlers), so `stopPropagation` here keeps it from ALSO arming the row,
  // entering edit mode, or opening the reader.
  function handleRowClickCapture(e: React.MouseEvent<HTMLTableRowElement>, docId: string) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.stopPropagation();
    onToggleChecked(docId);
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

  function handleDragStart(e: React.DragEvent<HTMLTableRowElement>, docId: string) {
    const ids = checkedIds.has(docId) ? Array.from(checkedIds) : [docId];
    e.dataTransfer.setData(MOVE_DRAG_MIME, encodeDragIds(ids));
    e.dataTransfer.effectAllowed = "move";
    const preview = buildDragPreview(rows, ids);
    e.dataTransfer.setDragImage(preview, 12, 16);
    setTimeout(() => preview.remove(), 0);
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
              checked={checkedIds.has(row.doc_id)}
              onRowClick={() => handleRowClick(row.doc_id)}
              onRowClickCapture={(e) => handleRowClickCapture(e, row.doc_id)}
              onArm={() => setSelectedId(row.doc_id)}
              onOpen={() => openRow(row.doc_id)}
              onDragStart={(e) => handleDragStart(e, row.doc_id)}
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
