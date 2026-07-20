// reader/RegionFlashLayer — per-page overlay rendering the transient region
// flash (Story 10.2), the non-annotation generalization of the Story 3.6 Bank
// jump's `--flash` pulse. Mirrors `AnnotationLayer`/`StructureDebugLayer`'s
// per-page contract (`pageIndex, box, scale`) and positions its box via the
// anchor service's `denormalizeRect` directly (AD-9: no new coordinate math;
// this is not a `StructureElement`, so `denormalizeElement` doesn't apply).

import { denormalizeRect, type PageBox } from "@/anchor";
import { useRegionFlashStore } from "@/reader/regionFlash";
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
  if (!region || region.pageIndex !== pageIndex) return null;

  const r = denormalizeRect(region.rect, box, scale);
  return (
    <div
      className="region-flash"
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
