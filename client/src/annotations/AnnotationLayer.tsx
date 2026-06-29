// AnnotationLayer — the per-page overlay VIEW (AD-9). Renders every stored
// annotation anchored to this page, positioned via the anchor service against
// the live page-card box + scale, so it re-derives on every zoom (AC-6) and
// never reflows the canvas (NFR-1: the layer is an absolutely-positioned,
// pointer-transparent sheet over the card). Render keys off `anchor.kind`,
// NEVER off `type` (AD-5).
//
// Story 2.5: the highlight marks become pointer-interactive (the selection hit
// surface, AD-12 Decision A). Each mark rect IS the page-normalized anchor rect
// (positioned by `denormalizeRect`), so `pointer-events:auto` + `cursor:pointer`
// turn it into the hit target: hovering outlines the WHOLE annotation (a per-
// layer transient `hoveredId`), clicking selects it (store `select`), and the
// `selectedId` mark shows a persistent ring. Recent-wins: marks render sorted by
// `created_at` ascending so the newest paints last (on top) and wins on overlap.
// The rest of the layer sheet stays `pointer-events:none` so non-highlighted
// text stays selectable (NFR-1).

import { useState } from "react";
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
  // simple; a per-page selector is an Epic-3 perf concern.) Recent-wins: sort by
  // created_at ascending so the newest paints LAST (on top) and receives the
  // pointer on overlap, matching the opacity-group "topmost wins on shared text".
  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedId = useAnnotationStore((s) => s.selectedId);
  const select = useAnnotationStore((s) => s.select);
  const marks = [...annotations.values()]
    .filter((a) => a.doc_id === docId && a.anchor.page_index === pageIndex)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Transient hover state — local to this layer, never written to the store
  // (selection is the store's job). Outlines the WHOLE hovered annotation.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    // The layer sheet stays decorative (aria-hidden): the marks duplicate the
    // selectable text underneath and exposing every rect fragment as a control
    // would be noisier than helpful. Selection is a pointer affordance for now;
    // Del/Esc work once selected (document-level keys), and a keyboard-reachable
    // list comes with the Epic-3 Annotation Bank. (Choice noted in the story.)
    <div className="annotation-layer" aria-hidden="true" data-testid={`annotation-layer-${pageIndex}`}>
      {/* Highlights share ONE opacity group: marks paint opaque and the group is
          composited once at the highlight opacity, so overlapping marks never
          compound into a darker/thicker band and the most recent (last in DOM)
          wins on shared text (AC #3). `isolation` keeps the group's blending
          self-contained. */}
      <div className="annotation-highlights">
        {marks.map((a) => {
          // Render off the anchor KIND, not the annotation type. Story 2.2 paints
          // the `text` kind (highlight); rect/path kinds arrive in 2.6–2.10.
          if (a.anchor.kind !== "text") return null;
          const hovered = a.id === hoveredId;
          const selected = a.id === selectedId;
          const cls =
            "annotation-highlight" +
            (hovered ? " annotation-highlight--hovered" : "") +
            (selected ? " annotation-highlight--selected" : "");
          return a.anchor.rects.map((r, i) => {
            const pos = denormalizeRect(r, box, scale);
            return (
              <div
                key={`${a.id}-${i}`}
                className={cls}
                data-testid={`annotation-mark-${a.id}`}
                onPointerEnter={() => setHoveredId(a.id)}
                onPointerLeave={() => setHoveredId((h) => (h === a.id ? null : h))}
                onClick={() => select(a.id)}
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
    </div>
  );
}
