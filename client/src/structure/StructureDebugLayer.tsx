// structure/StructureDebugLayer — a DEV-ONLY per-page overlay proving the
// structure layer's coordinate placement (Story 10.1 AC #4/#5). NOT shipped
// reader chrome: it renders nothing unless the `?debugStructure=1` flag is set,
// and it is the single client-visible artifact this enabler produces (the real
// consumers — ToC, Figures/Tables index, reading-helper, metadata — are Epic 10
// stories 10-2..10-6).
//
// It mirrors AnnotationLayer's per-page contract exactly (`docId, pageIndex,
// box, scale`) and positions each element via the structure service's
// `denormalizeElement`, which delegates to the anchor service (AD-9). Geometry
// is numeric inline style (React appends px; no raw-px literal — no-raw-values);
// colors/border reference design tokens only.

import { useEffect, useState } from "react";

import { type DocStructure, type StructureElement, getStructure } from "@/api/client";
import { type PageBox } from "@/anchor";
import { EMPTY_STRUCTURE, denormalizeElement, elementsOnPage } from "@/structure";

/** Dev flag: the overlay renders only when `?debugStructure=1` is in the URL.
 *  Guarded for non-browser (test/node) environments. */
export function isStructureDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debugStructure") === "1";
}

/** A structure `type` -> design-token color, so overlapping element kinds are
 *  visually distinguishable. Token refs (not raw hex) satisfy no-raw-values. */
const TYPE_COLOR: Record<StructureElement["type"], string> = {
  heading: "var(--color-annotation-purple)",
  figure: "var(--color-annotation-blue)",
  table: "var(--color-annotation-green)",
  caption: "var(--color-annotation-pink)",
  list: "var(--color-annotation-yellow)",
  paragraph: "var(--color-hairline-strong)",
  footnote: "var(--color-muted)",
  other: "var(--color-muted)",
};

// A tiny module-level cache so N live PageCards don't each fire a fetch for the
// same doc's structure (dev-only; a plain per-doc promise memo).
const structureCache = new Map<string, Promise<DocStructure>>();

function loadStructure(docId: string): Promise<DocStructure> {
  let pending = structureCache.get(docId);
  if (!pending) {
    pending = getStructure(docId).catch(() => EMPTY_STRUCTURE);
    structureCache.set(docId, pending);
  }
  return pending;
}

export default function StructureDebugLayer({
  docId,
  pageIndex,
  box,
  scale,
}: {
  docId: string;
  pageIndex: number;
  box: PageBox;
  scale: number;
}) {
  const enabled = isStructureDebugEnabled();
  const [structure, setStructure] = useState<DocStructure>(EMPTY_STRUCTURE);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadStructure(docId).then((s) => {
      if (!cancelled) setStructure(s);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, docId]);

  if (!enabled) return null;

  const elements = elementsOnPage(structure, pageIndex);
  return (
    <div
      className="structure-debug-layer"
      data-testid="structure-debug-layer"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {elements.map((el) => {
        const r = denormalizeElement(el, box, scale);
        const color = TYPE_COLOR[el.type];
        return (
          <div
            key={el.id}
            data-testid="structure-debug-el"
            data-type={el.type}
            style={{
              position: "absolute",
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              outlineStyle: "solid",
              outlineWidth: "var(--structure-debug-border)",
              outlineColor: color,
              pointerEvents: "none",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                fontSize: "var(--structure-debug-label-size)",
                padding: "var(--structure-debug-label-pad)",
                color: "var(--color-on-primary)",
                background: color,
                lineHeight: 1,
              }}
            >
              {el.type}
              {el.heading_level != null ? el.heading_level : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
