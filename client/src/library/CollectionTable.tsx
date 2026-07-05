import { useEffect, useRef, useState } from "react";
import type { CollectionRow } from "@/api/client";
import type { PendingUpload } from "@/library/useBulkUpload";
import "@/library/CollectionTable.css";

const SKELETON_ROW_COUNT = 6;
const COLUMNS = ["Title", "Authors", "Added", "File type"] as const;

type EditableField = "title" | "authors";

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

/** The stored field value, normalized for the no-op comparison (AC-6). */
function currentFieldValue(row: CollectionRow, field: EditableField): string {
  return (field === "title" ? row.title : row.authors) ?? "";
}

/** What the editor is seeded with — the DISPLAYED text, never the literal
 * `Untitled` placeholder (AC-3/Dev Notes: a parse-failed row seeds its
 * filename fallback so the user tweaks what they see). */
function seedFieldValue(row: CollectionRow, field: EditableField): string {
  if (field === "authors") return row.authors ?? "";
  return row.title ?? (row.filename ? stripPdfExtension(row.filename) : "");
}

type RowStatus = CollectionRow["status"] | "extracting";

/**
 * Status -> visual seam (Story 6.4 introduces it, Story 6.5 drives it for real
 * settled rows). Keyed off `status`, not "is this a pending row":
 * - `extracting` -> a muted "Extracting" chip while the background job runs.
 * - `parse-failed` -> a subtle muted "No metadata" chip; the row keeps its
 *   filename-title fallback and stays fully interactive (editable in 6.6).
 * - `ready` / `enrich-skipped` -> the silent default (a normal row); the
 *   enrich skip was already conveyed by a one-time batch notice.
 */
function statusLabel(status: RowStatus): string | null {
  if (status === "extracting") return "Extracting";
  if (status === "parse-failed") return "No metadata";
  return null;
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

/**
 * The `<input>` for an in-progress cell edit (Story 6.6). Owns its draft text
 * and autofocus/select-all on mount; a `committedRef` guards the classic
 * inline-edit double-fire (Enter/Esc unmount the input, which fires `onBlur`
 * during teardown — without the guard a naive `onBlur=commit` would silently
 * re-commit after an Esc cancel).
 */
function InlineEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="collection-table__edit-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          committedRef.current = true;
          onCommit(value);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!committedRef.current) {
          committedRef.current = true;
          onCommit(value);
        }
      }}
    />
  );
}

/**
 * A Title/Authors `<td>`: the static ellipsis cell, or (when this
 * `{docId, field}` is the one being edited) the `InlineEditor`. Editable only
 * for settled rows (AC-8); click or Enter on the static cell enters edit,
 * both `stopPropagation()` so the row's select/open handler (Story 6.3) never
 * fires from an edit gesture.
 */
function EditableCell({
  className,
  title,
  field,
  editable,
  armed,
  isEditing,
  seedValue,
  children,
  onStartEdit,
  onArm,
  onCommit,
  onCancel,
}: {
  className: string;
  title?: string;
  field: EditableField;
  editable: boolean;
  armed: boolean;
  isEditing: boolean;
  seedValue: string;
  children: React.ReactNode;
  onStartEdit: () => void;
  onArm: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <td className={className}>
        <InlineEditor initialValue={seedValue} onCommit={onCommit} onCancel={onCancel} />
      </td>
    );
  }
  if (!editable) {
    return (
      <td className={className} title={title}>
        {children}
      </td>
    );
  }
  return (
    <td
      className={className}
      title={title}
      tabIndex={0}
      aria-label={field === "title" ? "Edit title" : "Edit authors"}
      onClick={(e) => {
        if (armed) {
          e.stopPropagation();
          onStartEdit();
        }
        // else: not intercepted; the click bubbles to the <tr>'s own
        // onClick, which arms the row exactly like any other cell.
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.stopPropagation();
        if (armed) {
          onStartEdit();
        } else {
          onArm();
        }
      }}
    >
      {children}
    </td>
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
 * `doc_id`, so it is not selectable, openable, or editable. A real row click
 * selects it (arms it); clicking the already-selected row opens it via
 * `onOpenRow` (LibraryPage owns navigation, this component only reports the
 * gesture). Story 6.6 adds inline editing on the Title/Authors cells of
 * settled rows: the table reports `onEditField`, `LibraryPage` owns the
 * `PATCH` + optimistic state (the same split as `onOpenRow`). Selection and
 * the editing cursor are local UI state, not lifted, since nothing outside
 * the table needs them.
 */
export default function CollectionTable(props: CollectionTableProps) {
  if (props.loading) return <TableSkeleton />;
  const { rows, onOpenRow, pendingRows = [], onEditField } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ docId: string; field: EditableField } | null>(null);

  function handleRowClick(docId: string) {
    setSelectedId((prev) => (prev === docId ? null : docId));
  }

  function commitEdit(row: CollectionRow, field: EditableField, value: string) {
    setEditing(null);
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
            const editable = row.status !== "extracting";
            const isEditingTitle = editing?.docId === row.doc_id && editing.field === "title";
            const isEditingAuthors = editing?.docId === row.doc_id && editing.field === "authors";
            return (
              <tr
                key={row.doc_id}
                aria-selected={selectedId === row.doc_id}
                onClick={() => handleRowClick(row.doc_id)}
                className={rowStatusClass(row.status)}
              >
                <EditableCell
                  className="collection-table__title"
                  title={displayTitle ?? undefined}
                  field="title"
                  editable={editable}
                  armed={selectedId === row.doc_id}
                  isEditing={isEditingTitle}
                  seedValue={seedFieldValue(row, "title")}
                  onStartEdit={() => setEditing({ docId: row.doc_id, field: "title" })}
                  onArm={() => setSelectedId(row.doc_id)}
                  onCommit={(value) => commitEdit(row, "title", value)}
                  onCancel={() => setEditing(null)}
                >
                  <span className="collection-table__title-text">
                    {displayTitle ?? <span className="collection-table__untitled">Untitled</span>}
                  </span>
                  <button
                    type="button"
                    className="collection-table__open-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenRow(row.doc_id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    Open
                  </button>
                </EditableCell>
                <EditableCell
                  className="collection-table__authors"
                  title={row.authors ?? undefined}
                  field="authors"
                  editable={editable}
                  armed={selectedId === row.doc_id}
                  isEditing={isEditingAuthors}
                  seedValue={seedFieldValue(row, "authors")}
                  onStartEdit={() => setEditing({ docId: row.doc_id, field: "authors" })}
                  onArm={() => setSelectedId(row.doc_id)}
                  onCommit={(value) => commitEdit(row, "authors", value)}
                  onCancel={() => setEditing(null)}
                >
                  {row.authors ?? ""}
                </EditableCell>
                <td className="collection-table__added">{formatAdded(row.added)}</td>
                <td>
                  {label ? (
                    <span
                      className={
                        row.status === "parse-failed" ? "badge-pill badge-pill--muted" : "badge-pill"
                      }
                    >
                      {label}
                    </span>
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
