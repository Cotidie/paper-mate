// AnnotationLayer — the per-page overlay VIEW (AD-9). Renders every stored
// annotation anchored to this page, positioned via the anchor service against
// the live page-card box + scale, so it re-derives on every zoom (AC-6) and
// never reflows the canvas (NFR-1: the layer is an absolutely-positioned,
// pointer-transparent sheet over the card).
//
// GEOMETRY keys off `anchor.kind`; STYLE keys off `type` (AD-5 — two different
// axes). A `kind=text` mark's rects + positioning are shared by every text tool;
// what differs is the PAINT: `type=highlight` → an accent fill at ~0.4 opacity
// OVER the run (in the `.annotation-highlights` opacity group); `type=underline`
// → a 2px accent line UNDER the run (full opacity, in `.annotation-underlines`).
// A `kind=path` mark (pen, Story 2.8) is a DIFFERENT geometry: a freehand stroke
// rendered as one filled SVG `<path>` from its normalized `points` (re-derived via
// `denormalizePoint` + the perfect-freehand outline, both shared with the live
// preview). Never infer the anchor SHAPE from `type` — render branches on `kind`.
//
// Story 2.5: the highlight marks become pointer-interactive (the selection hit
// surface, AD-12 Decision A). Each mark rect IS the page-normalized anchor rect
// (positioned by `denormalizeRect`), so `pointer-events:auto` + `cursor:pointer`
// turn it into the hit target: hovering outlines the WHOLE annotation, clicking
// selects it (store `select`), and the selected mark shows a persistent ring.
// Recent-wins: marks render sorted by `created_at` ascending so the newest paints
// last (on top) and wins on overlap. The rest of the layer sheet stays
// `pointer-events:none` so non-highlighted text stays selectable (NFR-1).
//
// Hover AND selection are GROUP-AWARE and live in the store: a two-page highlight
// is two annotations in two per-page layers, so each layer reads the shared
// `hoveredId`/`selectedId` and lights any mark that matches by id OR shares a
// non-null `group_id` — both pages outline/ring as one (`inActiveGroup`).

import type { Annotation } from "../api/client";
import { useAnnotationStore } from "../store";
import { denormalizeRect, denormalizePoint, type PageBox } from "../anchor";
import { strokeOutline, svgPathFromOutline } from "./pen";
import "./Annotations.css";

/** Is `a` part of the active set named by `activeId`? True when it IS that mark,
 *  or shares a non-null `group_id` with it — so a two-page highlight's sibling on
 *  another page lights together (hover outline + selected ring). */
function inActiveGroup(a: Annotation, activeId: string | null, all: Map<string, Annotation>): boolean {
  if (!activeId) return false;
  if (a.id === activeId) return true;
  const active = all.get(activeId);
  return active != null && active.group_id != null && active.group_id === a.group_id;
}

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
  const hoveredId = useAnnotationStore((s) => s.hoveredId);
  const select = useAnnotationStore((s) => s.select);
  const setHovered = useAnnotationStore((s) => s.setHovered);
  const marks = [...annotations.values()]
    .filter((a) => a.doc_id === docId && a.anchor.page_index === pageIndex)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  // Geometry-on-kind / style-on-type split (AD-5). Three groups:
  //  - text + NOT underline → the 0.4-opacity highlight fill group;
  //  - text + underline → the full-opacity underline group (2px line);
  //  - path (pen) → the full-opacity SVG stroke group.
  const textMarks = marks.filter((a) => a.anchor.kind === "text");
  const highlightMarks = textMarks.filter((a) => a.type !== "underline");
  const underlineMarks = textMarks.filter((a) => a.type === "underline");
  const penMarks = marks.filter((a) => a.anchor.kind === "path");

  // Render one annotation's rects as positioned mark divs. `underline` swaps the
  // accent fill for a transparent box with a 2px accent bottom-border (the line
  // under the run); both keep the `.annotation-highlight` base class so the Story
  // 2.5 selection hit-test / hover / selected ring work identically.
  const renderMark = (a: Annotation, underline: boolean) => {
    if (a.anchor.kind !== "text") return null;
    const hovered = inActiveGroup(a, hoveredId, annotations);
    const selected = inActiveGroup(a, selectedId, annotations);
    const cls =
      "annotation-highlight" +
      (underline ? " annotation-highlight--underline" : "") +
      (hovered ? " annotation-highlight--hovered" : "") +
      (selected ? " annotation-highlight--selected" : "");
    return a.anchor.rects.map((r, i) => {
      const pos = denormalizeRect(r, box, scale);
      const paint = underline
        ? { borderBottomColor: `var(--color-${a.style.color})` }
        : { backgroundColor: `var(--color-${a.style.color})` };
      return (
        <div
          key={`${a.id}-${i}`}
          className={cls}
          data-testid={`annotation-mark-${a.id}`}
          onPointerEnter={() => setHovered(a.id)}
          onPointerLeave={() => setHovered(null)}
          onClick={() => select(a.id)}
          style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height, ...paint }}
        />
      );
    });
  };

  // Render one pen mark as a single filled SVG `<path>` (geometry-on-kind = path).
  // Points denormalize to card-local px at the current scale; the stroke diameter
  // also scales (`stroke_width * scale`) so the line stays glued AND thickens with
  // zoom (NFR-3). Outline + path-`d` come from pen.ts (same engine as the live
  // preview). The path is the selection hit surface (Story 2.5 seam): fill-only
  // pointer events + hover/select handlers; hover/selected add an ink SVG stroke.
  const renderPen = (a: Annotation) => {
    if (a.anchor.kind !== "path") return null;
    const hovered = inActiveGroup(a, hoveredId, annotations);
    const selected = inActiveGroup(a, selectedId, annotations);
    const cls =
      "annotation-pen" +
      (hovered ? " annotation-pen--hovered" : "") +
      (selected ? " annotation-pen--selected" : "");
    const pts = a.anchor.points.map((p) => denormalizePoint(p, box, scale));
    const width = (a.style.stroke_width ?? 0) * scale;
    const d = svgPathFromOutline(strokeOutline(pts, width));
    return (
      <path
        key={a.id}
        className={cls}
        data-testid={`annotation-mark-${a.id}`}
        d={d}
        fill={`var(--color-${a.style.color})`}
        onPointerEnter={() => setHovered(a.id)}
        onPointerLeave={() => setHovered(null)}
        onClick={() => select(a.id)}
      />
    );
  };

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
      <div className="annotation-highlights">{highlightMarks.map((a) => renderMark(a, false))}</div>
      {/* Underlines paint full-opacity (a crisp 2px line), so they sit OUTSIDE the
          highlight opacity group. Same rects, same hit surface (NFR-1). */}
      <div className="annotation-underlines">{underlineMarks.map((a) => renderMark(a, true))}</div>
      {/* Pen strokes (kind=path): full-opacity filled vector paths in one SVG sheet
          over the card. Same re-derive-on-zoom invariant; the fill is the hit
          surface (NFR-1). */}
      {penMarks.length > 0 && (
        <svg className="annotation-pens" data-testid={`annotation-pens-${pageIndex}`}>
          {penMarks.map((a) => renderPen(a))}
        </svg>
      )}
    </div>
  );
}
