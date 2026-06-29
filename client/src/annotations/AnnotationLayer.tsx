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

import { useEffect, useLayoutEffect, useRef } from "react";
import { Trash } from "@phosphor-icons/react";
import type { Annotation } from "../api/client";
import { useAnnotationStore } from "../store";
import { denormalizeRect, denormalizePoint, type PageBox, type ScreenRect } from "../anchor";
import { strokeOutline, svgPathFromOutline } from "./pen";
import ColorSwatchRow from "./ColorSwatchRow";
import { clampToViewport } from "./position";
import "./Annotations.css";

/** Default pen stroke alpha (transparency). Matches --annotation-highlight-opacity
 *  (0.4) so pre-2.13 marks (alpha=null) render like a highlighter out of the box.
 *  Kept in sync with the CSS token by the comment; used as the `??` fallback on
 *  every pen path (the CSS var can't be read as a number in TSX). */
const PEN_DEFAULT_ALPHA = 0.4;

/** One on-page memo box (Story 2.9): an interactive `<textarea>` positioned via
 *  the denormalized rect. Extracted so each box owns a ref + a layout effect that
 *  re-fits its height to the content — auto-grow must re-run on body/scale change
 *  (zoom, remount), not only on the user's keystroke (`onInput`), or long notes
 *  clip after a re-render (Codex MED). Height is DERIVED, never persisted (NFR-3). */
function MemoBox({
  anno,
  pos,
  cls,
  selected,
  onRetext,
  onSelect,
  onHover,
  onClearSelection,
}: {
  anno: Annotation;
  pos: ScreenRect;
  cls: string;
  selected: boolean;
  onRetext: (id: string, body: string) => void;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onClearSelection: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const body = anno.body ?? "";
  // Re-fit height to content whenever the text OR the box geometry changes (the
  // min-height/width ride the scale, so a zoom re-wraps the text). jsdom has no
  // layout (scrollHeight = 0) → the guard keeps it a no-op there.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [body, pos.width, pos.height]);
  return (
    <textarea
      ref={ref}
      className={cls}
      data-testid={`annotation-mark-${anno.id}`}
      aria-label="Memo"
      value={body}
      autoFocus={selected}
      onChange={(e) => onRetext(anno.id, e.target.value)}
      onKeyDown={(e) => {
        // Esc blurs + deselects the memo from INSIDE the textarea (it is exempt
        // from the document-level tool/selection keys, so Esc would otherwise be
        // swallowed and leave the memo focused — Codex MED). A non-empty memo
        // survives; an empty one is removed by the deselect cleanup.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
          onClearSelection();
        }
      }}
      onPointerEnter={() => onHover(anno.id)}
      onPointerLeave={() => onHover(null)}
      onClick={() => onSelect(anno.id)}
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        minHeight: pos.height,
        borderColor: `var(--color-${anno.style.color})`,
      }}
    />
  );
}

/** The comment's note popup (Story 2.10): the twin of `MemoBox`, but a floating
 *  surface off the pin (not the on-page box). A `<textarea>` bound to `body` +
 *  a `ColorSwatchRow` (recolor tints the fill AND the pin) + a delete. Anchored at
 *  the pin's screen point (`pos`); CSS nudges it below the pin. Mounts only while
 *  the comment is selected → mount = open, unmount = close: it focuses its textarea
 *  on open (AC2) and RETURNS focus to the prior element on close (the unmount
 *  cleanup). Owns its ref + the auto-grow layout effect (like `MemoBox`). */
function CommentBubble({
  anno,
  pos,
  onRetext,
  onRecolor,
  onDelete,
  onClearSelection,
}: {
  anno: Annotation;
  pos: ScreenRect;
  onRetext: (id: string, body: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  onClearSelection: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const body = anno.body ?? "";
  // Focus moves INTO the textarea on open; on close (unmount) it RETURNS to the
  // element focused before the bubble opened (UX-DR8/DR17). Runs once per open.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  // Auto-grow the textarea to its content whenever the text OR position changes
  // (zoom re-anchors it). jsdom has no layout (scrollHeight 0) → guarded no-op.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [body, pos.left, pos.top]);
  // Keep the bubble fully on-screen (Codex MED): the bubble is anchored at the
  // pin's page-local point + a downward transform, so a pin near the right/bottom
  // edge would push the textarea/actions partly out of the viewport. Measure the
  // rendered rect and nudge the inline left/top by the viewport-overflow DELTA
  // (a pure translation, so it works in page-local coords). jsdom has no layout
  // (rect all-zero) → the clamp is a no-op there.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const c = clampToViewport(r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight);
    const dx = c.x - r.left;
    const dy = c.y - r.top;
    if (dx !== 0) el.style.left = `${pos.left + dx}px`;
    if (dy !== 0) el.style.top = `${pos.top + dy}px`;
  }, [body, pos.left, pos.top]);
  return (
    <div
      ref={boxRef}
      className="comment-bubble"
      data-testid={`comment-bubble-${anno.id}`}
      style={{ left: pos.left, top: pos.top }}
      // Esc dismisses from ANY control in the bubble, not just the textarea
      // (Codex MED): the swatch/delete buttons are exempt from the document-level
      // selection keys, so Esc on them would otherwise do nothing. Handling it on
      // the container catches every focused child.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur?.();
          onClearSelection();
        }
      }}
    >
      <textarea
        ref={ref}
        className="comment-bubble__text"
        data-testid={`comment-body-${anno.id}`}
        aria-label="Comment"
        value={body}
        onChange={(e) => onRetext(anno.id, e.target.value)}
      />
      <div className="comment-bubble__actions">
        <ColorSwatchRow value={anno.style.color} onPick={onRecolor} ariaLabel="Comment color" />
        <button
          type="button"
          className="comment-bubble__delete"
          data-testid={`comment-delete-${anno.id}`}
          aria-label="Delete"
          title="Delete (Del)"
          onClick={onDelete}
        >
          <Trash aria-hidden />
        </button>
      </div>
    </div>
  );
}

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
  const clearSelection = useAnnotationStore((s) => s.clearSelection);
  const setHovered = useAnnotationStore((s) => s.setHovered);
  const retextAnnotation = useAnnotationStore((s) => s.retextAnnotation);
  // Story 2.10: a selected comment's bubble recolors/deletes the comment itself
  // (the bubble REPLACES the generic selection quick-box, Decision 4), so the
  // layer owns those actions for comments. Recolor sets the active default too
  // (last-choice-wins, like every other tool).
  const recolorAnnotation = useAnnotationStore((s) => s.recolorAnnotation);
  const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
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
  // Memo (Story 2.9): kind=rect + type=memo. Rendered as an interactive
  // <textarea>, not a paint sheet — so it lives in its OWN group, OUTSIDE the
  // decorative aria-hidden layer (a focusable control must not sit in an
  // aria-hidden subtree).
  const memoMarks = marks.filter((a) => a.anchor.kind === "rect" && a.type === "memo");
  // Region fills (Story 2.11): kind=rect + type ∈ {highlight, comment}. A region
  // highlight is ONLY here (no text anchor → not in highlightMarks); a region
  // comment also appears in commentMarks for its pin. Render the ~0.4 fill here;
  // do NOT duplicate the pin. Kind=rect memos are excluded (their own group above).
  const regionMarks = marks.filter(
    (a) => a.anchor.kind === "rect" && (a.type === "highlight" || a.type === "comment"),
  );
  // Comment (Story 2.10): a `type=comment` mark of EITHER kind. A `kind=text`
  // comment ALSO appears in `highlightMarks` above (type !== "underline"), so its
  // ~0.4 fill paints for free — do NOT add a second fill path. Here we render only
  // the comment-specific chrome: a round PIN (both kinds) + the bubble when
  // selected, in their own NOT-aria-hidden group (focusable controls).
  const commentMarks = marks.filter((a) => a.type === "comment");

  // The ids a comment recolor/retext touches: the comment + its group siblings
  // (a two-page text comment recolors AND retexts together, AR-4). Scoped to THIS
  // doc + type=comment (Codex MED): the store is a singleton across doc switches
  // (until Epic 3), so a matching group_id in another doc must never be touched
  // from this doc's bubble. Delete is already group-aware in the store.
  const commentGroupIds = (a: Annotation): string[] => {
    if (!a.group_id) return [a.id];
    const ids: string[] = [];
    for (const x of annotations.values()) {
      if (x.group_id === a.group_id && x.doc_id === a.doc_id && x.type === "comment") ids.push(x.id);
    }
    return ids;
  };

  // Render one region mark as a single positioned fill div (geometry-on-kind = rect,
  // style-on-type: both highlight and comment get the ~0.4 fill from the highlights
  // opacity group; the comment's pin is rendered separately in renderComment).
  // The .annotation-highlight class gives it the 2.5 selection hit-test, hover ring,
  // and selected ring, so recolor/delete from the selection quick-box work for free.
  const renderRegion = (a: Annotation) => {
    if (a.anchor.kind !== "rect") return null;
    const hovered = inActiveGroup(a, hoveredId, annotations);
    const selected = inActiveGroup(a, selectedId, annotations);
    const cls =
      "annotation-highlight annotation-region" +
      (hovered ? " annotation-highlight--hovered" : "") +
      (selected ? " annotation-highlight--selected" : "");
    const pos = denormalizeRect(a.anchor.rect, box, scale);
    return (
      <div
        key={a.id}
        className={cls}
        data-testid={`annotation-mark-${a.id}`}
        onPointerEnter={() => setHovered(a.id)}
        onPointerLeave={() => setHovered(null)}
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
  };

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
        fillOpacity={a.style.alpha ?? PEN_DEFAULT_ALPHA}
        onPointerEnter={() => setHovered(a.id)}
        onPointerLeave={() => setHovered(null)}
        onClick={() => select(a.id)}
      />
    );
  };

  // Render one memo as an interactive <textarea> positioned via denormalizeRect
  // (geometry-on-kind = rect). The box rides the normalized rect (left/top/width
  // and a min-height) so it stays glued + scales on zoom (NFR-3); typing grows it
  // downward without reflowing the page (absolute overlay). The accent (border)
  // color comes from style.color (inline); the body text stays ink. The box is
  // the selection hit surface (Story 2.5 seam): pointer-events + select/hover.
  // value = a.body, every edit writes through retextAnnotation. Autofocus when it
  // is the selected memo so a just-placed box is ready to type into.
  const renderMemo = (a: Annotation) => {
    if (a.anchor.kind !== "rect") return null;
    const hovered = inActiveGroup(a, hoveredId, annotations);
    const selected = inActiveGroup(a, selectedId, annotations);
    const cls =
      "annotation-memo" +
      (hovered ? " annotation-memo--hovered" : "") +
      (selected ? " annotation-memo--selected" : "");
    return (
      <MemoBox
        key={a.id}
        anno={a}
        pos={denormalizeRect(a.anchor.rect, box, scale)}
        cls={cls}
        selected={selected}
        onRetext={(id, body) => retextAnnotation(id, body, new Date().toISOString())}
        onSelect={select}
        onHover={setHovered}
        onClearSelection={clearSelection}
      />
    );
  };

  // Render one comment's PIN (both kinds) + its bubble when selected
  // (geometry-on-kind: a text comment anchors at its first rect's start; a rect
  // comment at the rect's top-left). The pin is a round <button> (keyboard-
  // reachable, the click selects the comment); the fill (text comments only) is
  // painted by the highlight group. The bubble mounts only for the EXACTLY-selected
  // annotation (not group siblings), so a two-page comment shows one bubble.
  const renderComment = (a: Annotation) => {
    let anchor: ScreenRect | null = null;
    if (a.anchor.kind === "text") {
      if (a.anchor.rects.length === 0) return null;
      anchor = denormalizeRect(a.anchor.rects[0], box, scale);
    } else if (a.anchor.kind === "rect") {
      anchor = denormalizeRect(a.anchor.rect, box, scale);
    }
    if (!anchor) return null;
    const hovered = inActiveGroup(a, hoveredId, annotations);
    const selected = inActiveGroup(a, selectedId, annotations);
    const cls =
      "annotation-comment-pin" +
      (hovered ? " annotation-comment-pin--hovered" : "") +
      (selected ? " annotation-comment-pin--selected" : "");
    return (
      <div key={a.id} className="annotation-comment" data-comment-id={a.id}>
        <button
          type="button"
          className={cls}
          data-testid={`annotation-comment-pin-${a.id}`}
          aria-label="Comment"
          style={{
            left: anchor.left,
            top: anchor.top,
            backgroundColor: `var(--color-${a.style.color})`,
          }}
          onPointerEnter={() => setHovered(a.id)}
          onPointerLeave={() => setHovered(null)}
          onClick={() => select(a.id)}
        />
        {a.id === selectedId && (
          <CommentBubble
            anno={a}
            pos={anchor}
            onRetext={(_id, body) => {
              // Group-aware (Codex HIGH): a two-page comment is grouped siblings;
              // write the same body to ALL of them so reopening the other page's
              // pin shows the note, not a stale/empty one (matches recolor/delete).
              const now = new Date().toISOString();
              for (const gid of commentGroupIds(a)) retextAnnotation(gid, body, now);
            }}
            onRecolor={(color) => {
              recolorAnnotation(commentGroupIds(a), color, new Date().toISOString());
              setActiveColor(color);
            }}
            onDelete={() => deleteAnnotation(a.id)}
            onClearSelection={clearSelection}
          />
        )}
      </div>
    );
  };

  return (
    <>
      {/* The mark sheet stays decorative (aria-hidden): the highlight/underline/pen
          marks duplicate the selectable text underneath and exposing every rect
          fragment as a control would be noisier than helpful. Selection is a
          pointer affordance for now; Del/Esc work once selected (document-level
          keys), and a keyboard-reachable list comes with the Epic-3 Annotation
          Bank. Memos are EXCLUDED from this group (below): they are real typed
          content, not decoration, so they must stay accessible. */}
      <div className="annotation-layer" aria-hidden="true" data-testid={`annotation-layer-${pageIndex}`}>
      {/* Highlights share ONE opacity group: marks paint opaque and the group is
          composited once at the highlight opacity, so overlapping marks never
          compound into a darker/thicker band and the most recent (last in DOM)
          wins on shared text (AC #3). `isolation` keeps the group's blending
          self-contained. */}
      <div className="annotation-highlights">{highlightMarks.map((a) => renderMark(a, false))}</div>
      {/* Region fills (Story 2.11, kind=rect): a sibling opacity group at the same
          0.4 level so region highlights and region-comment area fills composite
          identically to text highlights. Conditionally rendered so the element is
          absent when there are no regions (test assertion: no region group). */}
      {regionMarks.length > 0 && (
        <div className="annotation-highlights annotation-regions" data-testid={`annotation-regions-${pageIndex}`}>
          {regionMarks.map((a) => renderRegion(a))}
        </div>
      )}
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
      {/* Memos (kind=rect): interactive <textarea> boxes in their OWN, NOT
          aria-hidden, group — they are typed content, not decoration, and a
          focusable control cannot live in an aria-hidden subtree. The group is
          pointer-transparent so page text between memos stays selectable (NFR-1);
          each box opts back in. */}
      {memoMarks.length > 0 && (
        <div className="annotation-memos" data-testid={`annotation-memos-${pageIndex}`}>
          {memoMarks.map((a) => renderMemo(a))}
        </div>
      )}
      {/* Comments (Story 2.10): round pins + the selected comment's bubble, in
          their OWN, NOT aria-hidden, group (focusable controls cannot live in the
          decorative aria-hidden sheet — same rule as memos). Pointer-transparent
          group; the pin/bubble opt back in so page text between pins stays
          selectable (NFR-1). The ~0.4 fill (text comments) is in the highlight
          group above; this group is the pin + bubble only. */}
      {commentMarks.length > 0 && (
        <div className="annotation-comments" data-testid={`annotation-comments-${pageIndex}`}>
          {commentMarks.map((a) => renderComment(a))}
        </div>
      )}
    </>
  );
}
