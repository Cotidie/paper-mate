// tableViewPrefs.ts - the Library table's persisted LAYOUT (Story 7.10,
// AD-9/AL-7): order + visibility + widths, client-only, app-global, never in
// `library.json`/`meta.json`. Mirrors `settings/store.ts` (Story 5.1), the
// app's one other `localStorage`-persisted preferences store - a Zustand
// store wrapped in `persist`, same `name`/`version`/`partialize` shape. The
// active SORT is NOT persisted (stays local `useState` in `useTableView`).

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  COLUMNS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveColumn as moveColumnInOrder,
  reorderColumns as reorderColumnsInOrder,
  type ColumnKey,
} from "@/library/tableView";

const DEFAULT_ORDER: ColumnKey[] = COLUMNS.map((c) => c.key);
// File type hidden by default (Story 7.10 fix request; was DOI).
const DEFAULT_HIDDEN: ColumnKey[] = ["file_type"];
const KNOWN_KEYS = new Set<ColumnKey>(DEFAULT_ORDER);

function isColumnKey(value: unknown): value is ColumnKey {
  return typeof value === "string" && KNOWN_KEYS.has(value as ColumnKey);
}

interface ReconciledPrefs {
  order: ColumnKey[];
  hidden: ColumnKey[];
  widths: Partial<Record<ColumnKey, number>>;
}

/** Reconciles a persisted (possibly stale/corrupt/older-shape) `order` /
 *  `hidden` / `widths` against the current `COLUMNS` set (AC-5): an unknown
 *  or removed column key is dropped, a DUPLICATE key is collapsed to its
 *  first occurrence (a corrupt/hand-edited `order` like `["title","authors",
 *  "authors"]` must degrade to one "authors" column, not two - two `<th>`s
 *  sharing one React key would desync the header/cell render), a known key
 *  missing from a persisted `order` is appended (in `DEFAULT_ORDER`'s own
 *  relative sequence, at the end - inserting a newly-added column into the
 *  MIDDLE of a user's already-customized order would be the more surprising
 *  behavior), and Title is force-pinned to index 0 regardless of what was
 *  stored. Each field degrades to its own default independently, so a
 *  corrupt `widths` doesn't also reset `order`. */
function reconcile(order: unknown, hidden: unknown, widths: unknown): ReconciledPrefs {
  const persistedOrder = Array.isArray(order) ? order.filter(isColumnKey) : [];
  const withoutTitle: ColumnKey[] = [];
  const seen = new Set<ColumnKey>();
  for (const key of persistedOrder) {
    if (key === "title" || seen.has(key)) continue;
    seen.add(key);
    withoutTitle.push(key);
  }
  const missing = DEFAULT_ORDER.filter((k) => k !== "title" && !seen.has(k));
  const reconciledOrder: ColumnKey[] = ["title", ...withoutTitle, ...missing];

  const reconciledHidden: ColumnKey[] = Array.isArray(hidden)
    ? hidden.filter((k): k is ColumnKey => isColumnKey(k) && k !== "title")
    : [...DEFAULT_HIDDEN];

  // A persisted width outside the resize clamp range (code-review fix: e.g.
  // a hand-edited `-500` or `1000000`) is dropped, not just type-checked -
  // it would otherwise render at that value before any resize interaction
  // ever re-clamps it, breaking the table layout.
  const reconciledWidths: Partial<Record<ColumnKey, number>> = {};
  if (widths && typeof widths === "object") {
    for (const [key, value] of Object.entries(widths as Record<string, unknown>)) {
      const inRange =
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= MIN_COLUMN_WIDTH &&
        value <= MAX_COLUMN_WIDTH;
      if (isColumnKey(key) && inRange) reconciledWidths[key] = value;
    }
  }

  return { order: reconciledOrder, hidden: reconciledHidden, widths: reconciledWidths };
}

interface TableViewPrefsState extends ReconciledPrefs {
  /** Keyboard reorder (the header popover's "Move left"/"Move right"). */
  moveColumn: (key: ColumnKey, dir: "left" | "right") => void;
  /** Pointer drag-and-drop reorder (drop `fromKey` onto `toKey`'s header). */
  reorderColumns: (fromKey: ColumnKey, toKey: ColumnKey) => void;
  /** Title is never hideable - a no-op, mirrors the old `useTableView`'s guard. */
  toggleHidden: (key: ColumnKey) => void;
  /** Persists only the SETTLED width (drag pointerup / each keyboard step),
   *  never a per-frame drag value. */
  setWidth: (key: ColumnKey, value: number) => void;
  reset: () => void;
}

export const useTableViewPrefs = create<TableViewPrefsState>()(
  persist(
    (set) => ({
      ...reconcile(undefined, undefined, undefined),
      moveColumn(key, dir) {
        set((state) => ({ order: moveColumnInOrder(state.order, key, dir) }));
      },
      reorderColumns(fromKey, toKey) {
        set((state) => ({ order: reorderColumnsInOrder(state.order, fromKey, toKey) }));
      },
      toggleHidden(key) {
        if (key === "title") return;
        set((state) => {
          const next = new Set(state.hidden);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return { hidden: Array.from(next) };
        });
      },
      setWidth(key, value) {
        set((state) => ({ widths: { ...state.widths, [key]: value } }));
      },
      reset() {
        set(reconcile(undefined, undefined, undefined));
      },
    }),
    {
      name: "paper-mate:table-view",
      version: 1,
      partialize: (state) => ({ order: state.order, hidden: state.hidden, widths: state.widths }),
      // Runs once per successful rehydrate (a missing/corrupt localStorage
      // value never reaches here - zustand keeps the default initial state
      // instead - so this only has to reconcile a validly-parsed-but-stale
      // shape, e.g. after a future COLUMNS change).
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ReconciledPrefs> | null | undefined;
        if (!persisted || typeof persisted !== "object") return currentState;
        return { ...currentState, ...reconcile(persisted.order, persisted.hidden, persisted.widths) };
      },
    },
  ),
);
