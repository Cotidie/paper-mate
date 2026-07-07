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
  | { kind: "trash" }
  | { kind: "recent" };

/** Sort key for the Recent lens: `last_opened`'s epoch millis, falling back
 * to `added` for a legacy row not yet reconciled (AC-4). Parsed, not raw
 * ISO-string comparison (mirrors `tableView.ts`'s `added` sort key). */
function recentSortKey(paper: CollectionRow): number {
  return new Date(paper.last_opened ?? paper.added).getTime();
}

/** Recent lens date buckets (post-review scope, superseded AC-2/AC-6):
 * Google-Drive-style grouping, tracked no further back than "last month" -
 * anything older is dropped entirely (no numeric cap). */
export type RecentBucket = "Today" | "Yesterday" | "Last week" | "Last month";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Milliseconds until the next UTC-midnight boundary after `now` (Codex
 * review, second pass): the Recent lens's bucket cutoffs are UTC calendar
 * days, so `LibraryPage` reschedules its shared `now` at exactly this
 * interval - the mounted view re-buckets across a day rollover without
 * requiring the user to touch anything. */
export function msUntilNextUtcMidnight(now: number): number {
  return startOfUtcDay(now) + DAY_MS - now;
}

/** Which bucket a paper's last-opened moment falls in, relative to `now`.
 * `null` means older than the "last month" cutoff - excluded from Recent
 * entirely. Calendar-day boundaries in UTC (matches how `added`/`last_opened`
 * are generated server-side, `paths.now_iso()`), so a test can control `now`
 * without timezone flakiness. */
export function recentBucket(iso: string, now: number): RecentBucket | null {
  const t = new Date(iso).getTime();
  const startOfToday = startOfUtcDay(now);
  const startOfYesterday = startOfToday - DAY_MS;
  const startOfLastWeek = startOfToday - 7 * DAY_MS;
  const startOfLastMonth = startOfToday - 30 * DAY_MS;
  if (t >= startOfToday) return "Today";
  if (t >= startOfYesterday) return "Yesterday";
  if (t >= startOfLastWeek) return "Last week";
  if (t >= startOfLastMonth) return "Last month";
  return null;
}

/** Group-header labels for an already-sorted (most-recent-first) Recent rows
 * array: a `doc_id` appears here only when it starts a new bucket (the
 * table renders a header row immediately before it). Pure, no React -
 * `CollectionTable` renders from this, `LibraryPage` only computes it when
 * the lens is Recent and no column sort has scrambled the recency order. */
export function recentGroupLabels(rows: CollectionRow[], now: number): Map<string, RecentBucket> {
  const labels = new Map<string, RecentBucket>();
  let lastBucket: RecentBucket | null = null;
  for (const row of rows) {
    const bucket = recentBucket(row.last_opened ?? row.added, now);
    if (bucket !== null && bucket !== lastBucket) {
      labels.set(row.doc_id, bucket);
      lastBucket = bucket;
    }
  }
  return labels;
}

/**
 * Apply the folder lens to the collection (LFR-13/14). The Trash lens (Story
 * 7.5, AD-L3) is the one place trashed papers surface; every other kind
 * excludes them via the `untrashed` base filter. `now` is injectable for
 * deterministic tests of the Recent lens's rolling time window; defaults to
 * the real clock.
 */
export function filterPapers(
  papers: CollectionRow[],
  selection: FolderSelection,
  now: number = Date.now(),
): CollectionRow[] {
  if (selection.kind === "trash") return papers.filter((p) => p.trashed);
  const untrashed = papers.filter((p) => !p.trashed);
  if (selection.kind === "all") return untrashed;
  if (selection.kind === "uncategorized") return untrashed.filter((p) => p.folder_id === null);
  if (selection.kind === "recent") {
    return untrashed
      .filter((p) => recentBucket(p.last_opened ?? p.added, now) !== null)
      .sort((a, b) => recentSortKey(b) - recentSortKey(a));
  }
  return untrashed.filter((p) => p.folder_id === selection.id);
}

/** Whether `selection` is the given panel entry, for the active-highlight class. */
export function isSelected(selection: FolderSelection, entry: FolderSelection): boolean {
  if (selection.kind !== entry.kind) return false;
  return selection.kind === "folder" && entry.kind === "folder" ? selection.id === entry.id : true;
}
