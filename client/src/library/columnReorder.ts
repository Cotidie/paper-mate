import type { ColumnKey } from "@/library/tableView";

/**
 * The Library table's client-only column REORDER transform (Story 7.10,
 * AC-1/AC-2/AC-4, AD-L3). Pure array-move functions over the column keys in
 * `tableView.ts`; the sort transform is its sibling leaf `columnSort.ts`.
 * `tableViewPrefs`'s persisted-store actions delegate to these (the single
 * source of the pin-Title invariant).
 */

/** Pins Title to index 0 (Story 7.10, AC-4 - a store invariant, not just a UI
 *  check, Dev Notes: "no code path... can strand it"). A well-formed `order`
 *  (Title already first) is returned as-is, so `moveColumn`/`reorderColumns`
 *  don't allocate on the common path; a malformed one (e.g. adversarial
 *  `localStorage`, or a caller passing an arbitrary array straight into
 *  these exported pure functions) is defensively re-pinned BEFORE any index
 *  math runs, so a swap/splice computed against a bad input can never
 *  further displace Title. */
function pinTitleFirst(order: ColumnKey[]): ColumnKey[] {
  if (order[0] === "title") return order;
  return ["title", ...order.filter((k) => k !== "title")];
}

/** Moves `key` one slot toward `dir` in `order` (Story 7.10, AC-1/AC-2/AC-4).
 *  Title is pinned at index 0: moving Title is a no-op, and a move that would
 *  cross Title (the column immediately right of it moving left) or run off
 *  either end is also a no-op. Always returns a NEW array, never mutates
 *  `order` - the single source `tableViewPrefs`'s store actions delegate to. */
export function moveColumn(order: ColumnKey[], key: ColumnKey, dir: "left" | "right"): ColumnKey[] {
  const pinned = pinTitleFirst(order);
  if (key === "title") return [...pinned];
  const idx = pinned.indexOf(key);
  if (idx === -1) return [...pinned];
  const targetIdx = dir === "left" ? idx - 1 : idx + 1;
  if (targetIdx <= 0 || targetIdx >= pinned.length) return [...pinned];
  const next = [...pinned];
  [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
  return next;
}

/** Moves `fromKey` to occupy `toKey`'s original slot (standard array-move
 *  reorder semantics, Story 7.10 AC-1/AC-4, fix request: matches
 *  dnd-kit/react-beautiful-dnd's convention). `toKey`'s ORIGINAL index (in
 *  `order`, before `fromKey` is removed) is used as the insertion point -
 *  NOT its post-removal index - so a FORWARD drag (fromKey left of toKey)
 *  lands `fromKey` AFTER toKey, while a BACKWARD drag (fromKey right of
 *  toKey) lands it BEFORE. This is what makes dragging a column onto its
 *  immediate neighbor a real swap in EITHER direction; the "insert before,
 *  post-removal index" definition this replaced degenerated to a no-op for
 *  the single most common gesture - dragging a column onto the neighbor
 *  directly to its right, which is already "before" that neighbor. Title
 *  never moves (a `fromKey` of "title" is a no-op) and nothing is ever
 *  inserted before Title - a drop onto/before Title clamps to "just after
 *  Title" (index 1). Always returns a NEW array. */
export function reorderColumns(order: ColumnKey[], fromKey: ColumnKey, toKey: ColumnKey): ColumnKey[] {
  const pinned = pinTitleFirst(order);
  if (fromKey === "title" || fromKey === toKey || !pinned.includes(fromKey)) return [...pinned];
  const toIdx = pinned.indexOf(toKey);
  const next = [...pinned];
  next.splice(pinned.indexOf(fromKey), 1);
  const insertAt = Math.max(toIdx, 1);
  next.splice(insertAt, 0, fromKey);
  return next;
}
