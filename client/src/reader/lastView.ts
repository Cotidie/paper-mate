// lastView.ts — the reader's persisted LAST-VIEW position (Story 10.7,
// FR-33, AD-8 view-state tier): per-document page + fractional scroll
// offset, client-only, never in `meta.json`. Mirrors `settings/store.ts`
// (Story 5.1) and `library/tableViewPrefs.ts` (Story 7.10), the app's other
// `localStorage`-persisted preference stores — a Zustand store wrapped in
// `persist`, same `name`/`version`/`partialize`/`merge`-reconcile shape.

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** `page` is 1-based; `frac` is a `[0,1]` fraction of the page's rendered
 *  height. `scale` (optional) is the raw pixel scale factor the reader was
 *  zoomed to when captured (the same value `useZoomControl`'s `scale` state
 *  holds, not a rounded percent) — when present, reopening restores this
 *  exact zoom instead of recomputing fit-to-width; when absent (an entry
 *  captured before this field existed, or a corrupt/dropped value), the
 *  reader falls back to fit-to-width as before. `page`/`frac` stay the
 *  scale-independent landing mechanism regardless — `scale` is purely a
 *  "restore my last zoom too" nicety layered on top. */
export interface LastView {
  page: number;
  frac: number;
  scale?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Reconciles a persisted (possibly stale/corrupt/hand-edited) `positions`
 *  map (AC #3): drop the whole thing if it is not a plain object; per entry,
 *  keep it ONLY when `page` is a finite integer `>= 1` AND `frac` is a
 *  finite number, clamping `frac` into `[0,1]`. A malformed entry is
 *  dropped, never poisoning its siblings (mirrors `tableViewPrefs.reconcile`'s
 *  per-field-degrades-independently discipline). `page` is NOT clamped to a
 *  max here — this store doesn't know a doc's `page_count`; the render-time
 *  clamp in `usePageNav.restoreView` handles a page beyond the doc. */
export function reconcile(positions: unknown): Record<string, LastView> {
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) return {};
  const out: Record<string, LastView> = {};
  for (const [docId, value] of Object.entries(positions as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { page, frac } = value as { page?: unknown; frac?: unknown };
    if (typeof page !== "number" || !Number.isFinite(page) || !Number.isInteger(page) || page < 1) continue;
    if (typeof frac !== "number" || !Number.isFinite(frac)) continue;
    // `scale` degrades independently of page/frac (same discipline as every
    // other field here): an out-of-range/corrupt scale is simply dropped
    // (the entry survives without it, falling back to fit-to-width on
    // restore) rather than invalidating the whole entry.
    const { scale } = value as { scale?: unknown };
    const validScale = typeof scale === "number" && Number.isFinite(scale) && scale > 0;
    out[docId] = { page, frac: clamp01(frac), ...(validScale ? { scale } : {}) };
  }
  return out;
}

/** The inverse of `usePageNav`'s restore math (`card.offsetTop +
 *  frac * clientHeight`): given the scroll container's `scrollTop` and a
 *  page card's `offsetTop`/`clientHeight`, returns the `[0,1]` fraction of
 *  the card currently at the viewport top. Pure, DOM-free (AD-9) — homed
 *  here rather than `render/index.ts` to stay out of the `@/render`
 *  `vi.mock` barrels (CLAUDE.md engineering principle). */
export function viewOffsetFraction(
  scrollTop: number,
  cardOffsetTop: number,
  cardClientHeight: number,
): number {
  if (cardClientHeight <= 0) return 0;
  return clamp01((scrollTop - cardOffsetTop) / cardClientHeight);
}

interface LastViewState {
  positions: Record<string, LastView>;
  /** Writes `positions[docId]` (the debounced-scroll + unmount-flush capture
   *  path, `useRememberedView`). */
  remember: (docId: string, view: LastView) => void;
  /** Deletes `positions[docId]`. Not wired to any caller this story — exported
   *  for a future Library delete/purge caller. */
  forget: (docId: string) => void;
}

export const useLastViewStore = create<LastViewState>()(
  persist(
    (set) => ({
      positions: {},
      remember(docId, view) {
        set((state) => ({ positions: { ...state.positions, [docId]: view } }));
      },
      forget(docId) {
        set((state) => {
          const next = { ...state.positions };
          delete next[docId];
          return { positions: next };
        });
      },
    }),
    {
      name: "paper-mate:last-view",
      version: 1,
      partialize: (state) => ({ positions: state.positions }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as { positions?: unknown } | null | undefined;
        if (!persisted || typeof persisted !== "object") return currentState;
        return { ...currentState, positions: reconcile(persisted.positions) };
      },
    },
  ),
);
