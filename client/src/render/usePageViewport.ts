// render/usePageViewport — the SINGLE IntersectionObserver for the reader.
// It owns the live registry of page-card nodes and drives BOTH the page-in-view
// tracking AND the per-card paint/release window from one observer (AR-9). This
// replaces the two observers Story 1.4/1.3 left split across `Reader` (page
// tracking) and each `PageCard` (own visibility). It is pure pdf.js/viewport
// plumbing: it knows NOTHING about annotations (no anchor/, annotations/, store/
// import; no normalize/denormalize math) — AD-9.
//
// Imported by `Reader` via this sub-path, NOT through the `render/` barrel, so a
// `vi.mock("./render")` in the Reader tests leaves this real hook in place; the
// hook's no-IntersectionObserver fallback then reproduces today's jsdom behavior
// (all cards live, page 1).

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  currentPageInView,
  pageWindow,
  WINDOW_RADIUS,
  type PageExtent,
  type PageWindow,
} from "./index";

export interface PageViewport {
  /** Register/deregister a page card's node (1-based) for tracking + nav. */
  registerCard: (pageNumber: number, el: HTMLDivElement | null) => void;
  /** Live map of mounted cards (1-based → node), read for PgUp/PgDn + zoom anchor. */
  cards: RefObject<Map<number, HTMLDivElement>>;
  /** 1-based page currently in view (defaults to 1). */
  currentPage: number;
  /** Whether a page is inside the live ±WINDOW_RADIUS paint window. */
  isLive: (pageNumber: number) => boolean;
}

/**
 * Track the page in view and the live paint window off a single
 * IntersectionObserver on the scroll container. `active` gates the observer to
 * when a document is ready. The observer fires only when a card crosses the
 * viewport edge (off the scroll hot path, NFR-2); each fire reads the live card
 * rects, picks the top-most visible page, and recomputes the ±radius window.
 */
export function usePageViewport(
  scrollRef: RefObject<HTMLDivElement | null>,
  pageCount: number,
  active: boolean,
): PageViewport {
  const cards = useRef<Map<number, HTMLDivElement>>(new Map());
  // Reverse lookup for the IO callback (entry.target -> pageNumber), kept in
  // lockstep with `cards` so recompute() never has to scan the whole registry.
  const elToPage = useRef<WeakMap<HTMLDivElement, number>>(new WeakMap());
  const [currentPage, setCurrentPage] = useState(1);
  const [live, setLive] = useState<PageWindow>(() => pageWindow(1, WINDOW_RADIUS, pageCount));
  // Capture support once: in jsdom (and SSR) there is no IntersectionObserver,
  // so the observer effect no-ops and every card stays live (eager paint), as
  // the pre-refactor PageCard did. `currentPage` then stays at its default 1.
  const supportsIO = typeof IntersectionObserver !== "undefined";

  const registerCard = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) {
      cards.current.set(pageNumber, el);
      elToPage.current.set(el, pageNumber);
    } else {
      const existing = cards.current.get(pageNumber);
      if (existing) elToPage.current.delete(existing);
      cards.current.delete(pageNumber);
    }
  }, []);

  useEffect(() => {
    if (!active || !supportsIO) return;
    const container = scrollRef.current;
    if (!container) return;

    let frame = 0;
    // Pages IO currently reports as intersecting the container's viewport — the
    // only candidates `currentPageInView` needs. Tracking membership from each
    // IO delivery (instead of re-measuring every registered card every fire)
    // avoids an O(N) getBoundingClientRect sweep that forces layout on far-off
    // content-visibility:auto cards whose layout a tab-hide/return cycle can
    // discard (Story 8.7 tab-switch-resume diagnosis).
    const intersecting = new Set<number>();
    const recompute = () => {
      frame = 0;
      const view = container.getBoundingClientRect();
      const extents: PageExtent[] = [];
      for (const pageNumber of intersecting) {
        const el = cards.current.get(pageNumber);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        extents.push({ pageNumber, top: r.top, bottom: r.bottom });
      }
      const page = currentPageInView(extents, view.top, view.bottom);
      setCurrentPage(page);
      setLive(pageWindow(page, WINDOW_RADIUS, pageCount));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(recompute);
    };

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pageNumber = elToPage.current.get(entry.target as HTMLDivElement);
        if (pageNumber === undefined) continue;
        if (entry.isIntersecting) intersecting.add(pageNumber);
        else intersecting.delete(pageNumber);
      }
      schedule();
    }, { root: container });
    for (const el of cards.current.values()) io.observe(el);
    schedule(); // establish the initial page + window once cards are laid out

    // Re-establish the window as soon as the tab becomes visible again, rather
    // than deferring that cost to the user's first post-return scroll/zoom
    // (AC1: no stall on the first interaction). Document-level listener,
    // cleaned up on unmount — same shape as usePanControl's Space-release
    // handler, not overloading it (CLAUDE.md document-level handler rule).
    const onVisible = () => {
      if (!document.hidden) schedule();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      io.disconnect();
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, supportsIO, pageCount, scrollRef]);

  const isLive = useCallback(
    (pageNumber: number) => !supportsIO || (pageNumber >= live.start && pageNumber <= live.end),
    [supportsIO, live],
  );

  return { registerCard, cards, currentPage, isLive };
}
