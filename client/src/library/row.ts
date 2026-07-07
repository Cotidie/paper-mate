import type { CollectionRow, Doc } from "@/api/client";

/** The inline-editable metadata fields (Story 6.6; `venue`/`year` added by a
 *  Story 7.9 fix request). `doi` stays link-only, never inline-editable. */
export type EditableField = "title" | "authors" | "venue" | "year";

/** A row's display status: the settled `CollectionRow["status"]` plus the
 *  client-only `"extracting"` overlay for an optimistic/in-flight row. Homed
 *  here because it is re-derived across the table, the pending row, and the
 *  optimistic-add projection. */
export type RowStatus = CollectionRow["status"] | "extracting";

/** An optimistic upload row: not yet a stored `CollectionRow`, so it carries no
 *  `doc_id`/`order`/`folder_id`/`trashed` — those would be fabricated. */
export interface PendingUpload {
  tempId: string;
  filename: string;
}

/** Format an ISO `added` timestamp as a human-readable date (e.g. "Jul 5, 2026"). */
export function formatAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Strip a trailing `.pdf` extension so a filename reads as a title. */
export function stripPdfExtension(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

/** The stored field value, normalized for the no-op comparison (AC-6). Year
 *  is stringified (the editor is a plain text input for every field). */
export function currentFieldValue(row: CollectionRow, field: EditableField): string {
  if (field === "year") return row.year != null ? String(row.year) : "";
  if (field === "title") return row.title ?? "";
  return row[field] ?? "";
}

/** What the editor is seeded with — the DISPLAYED text, never the literal
 * `Untitled` placeholder (AC-3/Dev Notes: a parse-failed row seeds its
 * filename fallback so the user tweaks what they see). */
export function seedFieldValue(row: CollectionRow, field: EditableField): string {
  if (field === "title") return row.title ?? (row.filename ? stripPdfExtension(row.filename) : "");
  return currentFieldValue(row, field);
}

/**
 * Status -> visual seam (Story 6.4 introduces it, Story 6.5 drives it for real
 * settled rows). Keyed off `status`, not "is this a pending row":
 * - `extracting` -> a muted "Extracting" chip while the background job runs.
 * - `parse-failed` -> a subtle muted "-" chip (fix request: the longer "No
 *   metadata" text wrapped to two lines in the File type column, growing the
 *   row height); the row keeps its filename-title fallback and stays fully
 *   interactive (editable in 6.6).
 * - `ready` / `enrich-skipped` -> the silent default (a normal row); the
 *   enrich skip was already conveyed by a one-time batch notice.
 */
export function statusLabel(status: RowStatus): string | null {
  if (status === "extracting") return "Extracting";
  if (status === "parse-failed") return "-";
  return null;
}

export function rowStatusClass(status: RowStatus): string | undefined {
  return status === "extracting" ? "collection-table__row--extracting" : undefined;
}

/** Project an upload's `Doc` into the display-cache `CollectionRow` shape
 *  (Story 6.4): a freshly stored paper is never in a folder or trashed, and
 *  sorts after every row currently known — matching the backend's own
 *  append-at-`max(order)+1` semantics (`_upsert_paper_entry`), so the row's
 *  position is stable across the AC-7 post-batch refetch rather than
 *  settling at the top only to jump to the bottom once the authoritative
 *  reconcile lands (client-side re-sort, e.g. newest-first, is Story 7.4's
 *  "display sort/filter controls" — out of scope here). */
export function docToRow(doc: Doc, papers: CollectionRow[]): CollectionRow {
  const maxOrder = papers.reduce((max, p) => Math.max(max, p.order), -1);
  return {
    doc_id: doc.doc_id,
    title: doc.title ?? null,
    authors: doc.authors ?? null,
    added: doc.added,
    file_type: doc.file_type,
    status: doc.status,
    folder_id: null,
    trashed: false,
    starred: false,
    order: maxOrder + 1,
    filename: doc.filename,
    doi: doc.doi ?? null,
    venue: doc.venue ?? null,
    year: doc.year ?? null,
  };
}
