// AnnotationLayer — the per-page overlay VIEW (AD-9). Renders every stored
// annotation anchored to this page, positioned via the anchor service against
// the live page-card box + scale, so it re-derives on every zoom (AC-6) and
// never reflows the canvas (NFR-1: the layer is an absolutely-positioned,
// pointer-transparent sheet over the card). Render keys off `anchor.kind`,
// NEVER off `type` (AD-5).

import { useAnnotationStore } from "../store";
import { denormalizeRect, type PageBox } from "../anchor";
import "./Annotations.css";

export default function AnnotationLayer({
  docId,
  pageIndex,
  box,
  scale,
}: {
  /** The document this card belongs to. Marks are filtered by it so the
   *  singleton store never bleeds one doc's annotations onto another doc with
   *  the same page index (the store is not cleared on doc switch until Epic 3). */
  docId: string;
  /** 0-based page index this layer renders for. */
  pageIndex: number;
  /** The page's scale-1.0 box (render layer's getPageBox, structurally a PageBox). */
  box: PageBox;
  /** Current zoom scale (drives re-derivation, AC-6). */
  scale: number;
}) {
  // Subscribe to the keyed map; filter to this doc + page. (Story 2.2 keeps it
  // simple; a per-page selector is an Epic-3 perf concern.)
  const annotations = useAnnotationStore((s) => s.annotations);
  const marks = [...annotations.values()].filter(
    (a) => a.doc_id === docId && a.anchor.page_index === pageIndex,
  );

  return (
    <div className="annotation-layer" aria-hidden="true" data-testid={`annotation-layer-${pageIndex}`}>
      {marks.map((a) => {
        // Render off the anchor KIND, not the annotation type. Story 2.2 paints
        // the `text` kind (highlight proof); rect/path kinds arrive in 2.4–2.8.
        if (a.anchor.kind !== "text") return null;
        return a.anchor.rects.map((r, i) => {
          const pos = denormalizeRect(r, box, scale);
          return (
            <div
              key={`${a.id}-${i}`}
              className="annotation-highlight"
              data-testid={`annotation-mark-${a.id}`}
              style={{
                left: pos.left,
                top: pos.top,
                width: pos.width,
                height: pos.height,
                backgroundColor: `var(--color-${a.style.color})`,
              }}
            />
          );
        });
      })}
    </div>
  );
}
