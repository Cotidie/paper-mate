// usePageNav — Reader's page-navigation concern (Story 5.3 extraction, mirrors
// the Story 5.0 `annotations/gestures/*` pattern). PgUp/PgDn (+ Ctrl Up/Down
// aliases) and the no-reflow scroll mechanic shared by page-nav, the ToC jump,
// and the Annotation Bank jump (Story 3.6).

import { useCallback, type RefObject } from "react";
import { pageNavTarget } from "../render";

export interface PageNavApi {
  scrollToPage: (pageNumber: number) => void;
  jumpToAnnotation: (pageIndex: number, topFraction: number) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

// The margin (a fraction of the scroll CONTAINER's — the viewport's —
// clientHeight, not the target card's) kept between the viewport top and a
// Bank-jumped mark, so it lands a little inside the view rather than pinned
// flush to the edge (Story 3.6, AC-4). Deliberately viewport-relative, not
// card-relative: at high zoom a page card can be many times taller than the
// viewport, so a card-relative margin could overshoot the visible area
// (Codex review finding).
const JUMP_MARGIN_FRACTION = 0.15;

export function usePageNav(opts: {
  scrollRef: RefObject<HTMLDivElement | null>;
  cards: RefObject<Map<number, HTMLDivElement>>;
  pageCount: number;
  currentPage: number;
}): PageNavApi {
  const { scrollRef, cards, pageCount, currentPage } = opts;

  // Scroll a page card's top (+ a card-relative `extraTop` px offset) into the
  // viewport — offset-only, so nothing reflows (NFR-1). Honors
  // `prefers-reduced-motion` (smooth → instant) and refocuses the canvas after
  // (so PgUp/PgDn nav / a next Bank jump stays live — a ToC row click or Bank
  // row click unmounts its panel, dropping focus to <body>; `preventScroll` so
  // the focus call can't fight the smooth scroll). No-ops where layout/scrollTo
  // is unavailable (jsdom). No anchor/coordinate math (AR-9). Shared by
  // `scrollToPage` (PgUp/PgDn + ToC, `extraTop=0`) and `jumpToAnnotation`
  // (Annotation Bank, Story 3.6) so there is one scroll mechanic, not two.
  const scrollCardIntoView = useCallback(
    (card: HTMLDivElement, extraTop: number) => {
      const container = scrollRef.current;
      if (!container || typeof container.scrollTo !== "function") return;
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      container.scrollTo({ top: card.offsetTop + extraTop, behavior: reduceMotion ? "auto" : "smooth" });
      container.focus?.({ preventScroll: true });
    },
    [scrollRef],
  );

  // Scroll a 1-based page to the top of the viewport (PgUp/PgDn + the ToC jump,
  // Story 1.9): clamp the target, find its card, scroll it flush to the top.
  const scrollToPage = useCallback(
    (pageNumber: number) => {
      const target = Math.min(pageCount, Math.max(1, pageNumber));
      const card = cards.current.get(target);
      if (card) scrollCardIntoView(card, 0);
    },
    [pageCount, cards, scrollCardIntoView],
  );

  // Scroll to a fractional position within a page (Annotation Bank row click,
  // Story 3.6): clamp the 0-based `pageIndex` to a real page, then add
  // `topFraction * card.clientHeight` (a page-normalized, zoom-independent
  // fraction from `bank.ts` — AD-9: no anchor/coordinate math here) less the
  // top margin above.
  const jumpToAnnotation = useCallback(
    (pageIndex: number, topFraction: number) => {
      const pageNumber = Math.min(pageCount, Math.max(1, pageIndex + 1));
      const card = cards.current.get(pageNumber);
      if (!card) return;
      const margin = (scrollRef.current?.clientHeight ?? 0) * JUMP_MARGIN_FRACTION;
      scrollCardIntoView(card, topFraction * card.clientHeight - margin);
    },
    [pageCount, cards, scrollRef, scrollCardIntoView],
  );

  // PgUp/PgDn (and Ctrl+Down/Ctrl+Up aliases): move one page. Scroll the target
  // card's top to the canvas top and suppress the browser's native page-scroll
  // so it never double-scrolls (AC-3). (Zoom keys are handled document-level in
  // useZoomControl, not here, so they work without canvas focus.)
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl ONLY (no Shift/Alt/Meta) so adjacent chords aren't swallowed — most
    // notably Ctrl+Shift+Arrow, the extend-text-selection chord over the page's
    // text layer. Matches the app's Ctrl-only keyboard map.
    const ctrlArrow = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
    const forward = e.key === "PageDown" || (ctrlArrow && e.key === "ArrowDown");
    const backward = e.key === "PageUp" || (ctrlArrow && e.key === "ArrowUp");
    if (!forward && !backward) return;
    e.preventDefault();
    const delta = forward ? 1 : -1;
    scrollToPage(pageNavTarget(currentPage, delta, pageCount));
  }

  return { scrollToPage, jumpToAnnotation, handleKeyDown };
}
