// reader/RegionFlashLayer — per-page overlay rendering the transient region
// flash (Story 10.2), the non-annotation generalization of the Story 3.6 Bank
// jump's `--flash` pulse. Mirrors `AnnotationLayer`/`StructureDebugLayer`'s
// per-page contract (`pageIndex, box, scale`) and positions its box via the
// anchor service's `denormalizeRect` directly (AD-9: no new coordinate math;
// this is not a `StructureElement`, so `denormalizeElement` doesn't apply).
//
// The pulse plays when the region's page scrolls INTO VIEW, not at jump time:
// a smooth glide to a far page can take longer than `FLASH_MS`, and the box
// lives inside its (off-screen, content-visibility:auto) page card, so a
// jump-time pulse would run and expire before the reader arrives (Codex review
// M7). An IntersectionObserver on the box starts the visible pulse + the
// `FLASH_MS` store-clear on arrival. Where IntersectionObserver is unavailable
// (jsdom/tests), it falls back to showing immediately.

import { useEffect, useRef, useState } from "react";

import { denormalizeRect, type PageBox } from "@/anchor";
import { useRegionFlashStore } from "@/reader/regionFlash";
import { FLASH_MS } from "@/store";
import "@/reader/RegionFlashLayer.css";

export default function RegionFlashLayer({
  pageIndex,
  box,
  scale,
}: {
  pageIndex: number;
  box: PageBox;
  scale: number;
}) {
  const region = useRegionFlashStore((s) => s.region);
  const active = region != null && region.pageIndex === pageIndex;
  const boxRef = useRef<HTMLDivElement>(null);
  // `shown` = the region's page is on screen, so the pulse is playing.
  const [shown, setShown] = useState(false);

  // Reset + arm visibility detection whenever the flashed region changes.
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setShown(true); // no observer (jsdom/tests): show immediately
      return;
    }
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown(true);
    });
    io.observe(el);
    return () => io.disconnect();
    // region identity (page + rect) drives a re-arm; box/scale changes don't.
  }, [active, region?.pageIndex, region?.rect]);

  // Once the page is visible, pulse for FLASH_MS then clear the store (the
  // fallback timer in `flashRegionAt` only covers a page never reached).
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => useRegionFlashStore.getState().clear(), FLASH_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!active) return null;

  const r = denormalizeRect(region.rect, box, scale);
  return (
    <div
      ref={boxRef}
      className={`region-flash${shown ? " region-flash--active" : ""}`}
      data-testid="region-flash"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        pointerEvents: "none",
      }}
    />
  );
}
