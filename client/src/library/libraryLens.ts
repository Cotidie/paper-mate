import type { CollectionRow, Folder } from "@/api/client";
import type { FolderSelection } from "@/library/folderFilter";
import { stripPdfExtension } from "@/library/row";
import type { ColumnDef } from "@/library/tableView";

/**
 * The Library page's pure per-lens view-state (Story 7.12, AD-L3): the empty
 * copy, the count-line target, the purge-dialog title, the folder-picker PDF
 * filter, and the folder-hides-Location column derivation. React-free leaf
 * (like `folderFilter.ts`), so `LibraryPage` stays a thin composition root.
 */

const PDF_EXTENSION = /\.pdf$/i;

/** The quiet empty-line copy for a filtered-to-nothing selection (Story 7.2:
 *  a small SHOULD, distinct from `EmptyDropzone`'s zero-library state). */
export function emptySelectionMessage(selection: FolderSelection): string {
  if (selection.kind === "uncategorized") return "No uncategorized papers.";
  if (selection.kind === "folder") return "No papers in this folder.";
  if (selection.kind === "trash") return "Trash is empty.";
  if (selection.kind === "recent") return "No recent papers.";
  if (selection.kind === "starred") return "No starred papers.";
  return "No papers to show.";
}

/** The toolbar count's "in ___" target (fix request: it read "in library" for
 *  every view, even a selected folder). Folders are a flat list keyed by id
 *  (no tree walk needed - a name lookup is a plain find). */
export function selectionLabel(selection: FolderSelection, folders: Folder[]): string {
  if (selection.kind === "uncategorized") return "Uncategorized";
  if (selection.kind === "folder") return folders.find((f) => f.id === selection.id)?.name ?? "folder";
  if (selection.kind === "trash") return "Trash";
  if (selection.kind === "recent") return "Recent";
  if (selection.kind === "starred") return "Starred";
  return "library";
}

/** A folder pick returns every file type in the directory tree; this filters
 *  it down to PDFs before handing anything to `uploadFiles` (a folder upload
 *  silently skips non-PDF clutter rather than surfacing a failure toast per
 *  non-PDF file). */
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXTENSION.test(file.name);
}

/** Purge confirm title: names the one paper, or counts a bulk selection /
 *  Empty Trash (both funnel through the same dialog). */
export function purgeDialogTitle(targets: CollectionRow[]): string {
  if (targets.length === 0) return "";
  if (targets.length === 1) {
    const target = targets[0];
    const name = target.title ?? (target.filename ? stripPdfExtension(target.filename) : "Untitled");
    return `Purge "${name}"`;
  }
  return `Purge ${targets.length} papers`;
}

/** Inside a folder, the Location column is redundant (fix request): the folder
 *  IS the location, so it's suppressed regardless of the user's own
 *  Display-menu toggle. All/Recent/Starred/Trash still show it (a mixed set of
 *  folders/Uncategorized). The underlying `hiddenColumns` toggle state is
 *  untouched, so leaving the folder restores whatever the user had set. */
export function visibleColumnsForSelection(columns: ColumnDef[], selection: FolderSelection): ColumnDef[] {
  return selection.kind === "folder" ? columns.filter((c) => c.key !== "location") : columns;
}
