// useMemoPlacement — the memo placement gesture (Story 2.9), encapsulated
// (Story 5.0). With memo armed, a single primary-button pointerdown on a page CARD
// places a default-size box at that point (NOT a drag, NOT a text selection),
// selects it, and the layer focuses its textarea. Document-level (AP-1),
// phase-gated; only acts while memo is armed. The box rect = the active memo-size
// preset (scale-1.0 px) at the click, normalized against the page. Clicking an
// EXISTING memo selects it (the layer + selection seam) — placement is gated off
// `.annotation-memo` so a second overlapping box isn't dropped on it.
//
// First-click-deselects (user fix 2026-06-30): if a mark is currently selected,
// an empty-space click DESELECTS it rather than placing a new memo — so clicking
// away from a memo commits/dismisses it (drawing the next memo takes a second
// click). The actual clear is `useSelection`'s empty-space handler; this gesture
// just SKIPS placing while something is selected. That handler runs in the capture
// phase, so this listener is ALSO capture-phase (and registered first, at mount)
// to read `selectedId` BEFORE the clear lands — otherwise it would see null and
// place anyway.

import { useEffect } from "react";
import { normalizeRect, pickPage } from "../../anchor";
import { useAnnotationStore } from "../../store";
import { newId } from "../../uuid";
import { buildMemoAnnotation } from "../create";
import { isExempt, type GestureContext } from "./shared";

export function useMemoPlacement(ctx: GestureContext): void {
  const { enabled, docId, armedToolRef, getPagesRef, scaleRef, defaultsRef, addAnnotation, select } = ctx;

  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      if (armedToolRef.current !== "memo" || e.button !== 0 || isExempt(e.target)) return;
      const el = e.target as Element | null;
      // Only over an actual page card; never the gutter/chrome, the quick-box, or
      // an existing memo (that click selects/edits it, not places a new one).
      if (!el?.closest?.(".page-surface") || el.closest?.(".quick-box") || el.closest?.(".annotation-memo"))
        return;
      // A mark is selected → this empty-space click DESELECTS it (via useSelection),
      // not place a new memo. Read here (capture phase, before useSelection clears).
      if (useAnnotationStore.getState().selectedId !== null) return;
      const pages = getPagesRef.current();
      const cardBoxes = pages.map((p) => p.cardEl.getBoundingClientRect());
      const idx = pickPage(
        { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY },
        cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
      );
      if (idx < 0) return;
      const page = pages[idx];
      const cardRect = cardBoxes[idx];
      const scale = scaleRef.current;
      const size = defaultsRef.current.memoSize;
      // Card-local px at the CURRENT scale (size is scale-1.0 px, so multiply by
      // scale); normalizeRect divides by box*scale → a scale-independent rect.
      const x0 = e.clientX - cardRect.left;
      const y0 = e.clientY - cardRect.top;
      const rect = normalizeRect(
        { x0, y0, x1: x0 + size.width * scale, y1: y0 + size.height * scale },
        page.box,
        scale,
      );
      const created = buildMemoAnnotation({ page_index: page.pageIndex, rect }, docId, {
        now: new Date().toISOString(),
        newId,
        color: defaultsRef.current.color,
      });
      addAnnotation(created);
      select(created.id);
      // Don't let the click start a text selection / fall through to another path.
      e.preventDefault();
    };
    // Capture phase (registered at mount, before useSelection's capture clear) so
    // the selectedId read above sees the pre-clear value (see the header note).
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, addAnnotation, select]);
}
