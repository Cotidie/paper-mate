// useRememberedView — Reader's remember/restore-last-view concern (Story
// 10.7, FR-33), mirrors the `usePageNav`/`useZoomControl` extraction
// pattern. Ties `lastView.ts`'s persisted store to the live scroll geometry:
// reads the remembered position ONCE at open, restores it before enabling
// capture (the AC #5 clobber guard — see the Dev Notes "clobber hazard"),
// then debounce-captures the live scroll position and flushes on unmount /
// doc switch.

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLastViewStore, viewOffsetFraction, type LastView } from "./lastView";

const CAPTURE_DEBOUNCE_MS = 400;

export function useRememberedView(opts: {
  scrollRef: RefObject<HTMLDivElement | null>;
  cards: RefObject<Map<number, HTMLDivElement>>;
  currentPage: number;
  pageCount: number;
  docId: string;
  active: boolean;
  restoreView: (pageNumber: number, frac: number) => void;
}): void {
  const { scrollRef, cards, currentPage, docId, active, restoreView } = opts;

  // Read-once ref (NOT a live subscription): a capture write can never
  // mutate the value restore is about to consume (AC #5).
  const pendingRef = useRef<LastView | undefined>(useLastViewStore.getState().positions[docId]);
  const restoredDocRef = useRef(docId);
  const restoredRef = useRef(false);
  // Mirrors `currentPage` into a ref so the capture effect (below) can read
  // the LIVE page-in-view without depending on it — depending on it would
  // tear down and re-attach the scroll listener on every page crossing
  // (a synchronous flush-capture each time), putting real work back on the
  // scroll hot path (NFR-2). The effect mounts once per doc-open instead.
  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Reset on doc switch: re-arm restore + re-read the remembered position for
  // the new doc, so switching papers without unmounting still restores.
  if (restoredDocRef.current !== docId) {
    restoredDocRef.current = docId;
    restoredRef.current = false;
    pendingRef.current = useLastViewStore.getState().positions[docId];
  }

  // Restore, before paint (useLayoutEffect so page 1 never visibly flashes,
  // AC #4). Runs once per doc open; every page card is already registered by
  // the time this parent layout effect runs (child ref callbacks commit
  // before parent layout effects).
  useLayoutEffect(() => {
    if (!active || restoredRef.current) return;
    restoredRef.current = true;
    const pos = pendingRef.current;
    if (pos) restoreView(pos.page, pos.frac);
    // `docId` is read only to re-run this effect on a doc switch that
    // doesn't unmount the hook (the render-phase reset above just cleared
    // `restoredRef`) — restore itself always targets `pendingRef.current`.
  }, [active, docId, restoreView]);

  // Capture: debounced scroll listener, enabled only AFTER restore has run
  // (AC #5). Flushes synchronously on cleanup (unmount / doc switch / active
  // flips false) so Back-to-Library / switching documents always persists
  // the exact last spot, even inside the debounce window.
  useEffect(() => {
    const container = scrollRef.current;
    if (!active || !container) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const capture = () => {
      const page = currentPageRef.current;
      const card = cards.current.get(page);
      if (!card) return;
      const frac = viewOffsetFraction(container.scrollTop, card.offsetTop, card.clientHeight);
      useLastViewStore.getState().remember(docId, { page, frac });
    };

    const onScroll = () => {
      if (!restoredRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(capture, CAPTURE_DEBOUNCE_MS);
    };

    container.addEventListener("scroll", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
      if (restoredRef.current) capture();
    };
  }, [active, docId, scrollRef, cards]);
}
