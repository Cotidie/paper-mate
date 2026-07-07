import type { CollectionRow } from "@/api/client";

/**
 * The Library route's folder lens (Story 7.2, AD-L3): a view-state
 * discriminated union, never a route/URL param. `LibraryPage` owns the
 * selected value; `FolderPanel` drives it, `CollectionTable` consumes it.
 */
export type FolderSelection =
  | { kind: "all" }
  | { kind: "uncategorized" }
  | { kind: "folder"; id: string }
  | { kind: "trash" };

/**
 * Apply the folder lens to the collection (LFR-13/14). The Trash lens (Story
 * 7.5, AD-L3) is the one place trashed papers surface; every other kind
 * excludes them via the `untrashed` base filter.
 */
export function filterPapers(papers: CollectionRow[], selection: FolderSelection): CollectionRow[] {
  if (selection.kind === "trash") return papers.filter((p) => p.trashed);
  const untrashed = papers.filter((p) => !p.trashed);
  if (selection.kind === "all") return untrashed;
  if (selection.kind === "uncategorized") return untrashed.filter((p) => p.folder_id === null);
  return untrashed.filter((p) => p.folder_id === selection.id);
}

/** Whether `selection` is the given panel entry, for the active-highlight class. */
export function isSelected(selection: FolderSelection, entry: FolderSelection): boolean {
  if (selection.kind !== entry.kind) return false;
  return selection.kind === "folder" && entry.kind === "folder" ? selection.id === entry.id : true;
}
