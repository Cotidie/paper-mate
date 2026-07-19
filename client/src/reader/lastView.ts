// lastView.ts — the reader's persisted LAST-VIEW position (Story 10.7,
// FR-33, AD-8 view-state tier): per-document page + fractional scroll
// offset, client-only, never in `meta.json`. Mirrors `settings/store.ts`
// (Story 5.1) and `library/tableViewPrefs.ts` (Story 7.10), the app's other
// `localStorage`-persisted preference stores — a Zustand store wrapped in
// `persist`, same `name`/`version`/`partialize`/`merge`-reconcile shape.

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** `page` is 1-based; `frac` is a `[0,1]` fraction of the page's rendered
 *  height. No scale/zoom field — the reader always applies its own current
 *  fit/zoom scale on open (AC #6). */
export interface LastView {
  page: number;
  frac: number;
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
    out[docId] = { page, frac: clamp01(frac) };
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
