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

import { useRef } from "react";
import { ChatCircle } from "@phosphor-icons/react";
import type { Annotation } from "../api/client";
import { useAnnotationStore } from "../store";
import { denormalizeRect, denormalizePoint, pointsBounds, type PageBox, type ScreenRect } from "../anchor";
import { strokeOutline, svgPathFromOutline } from "./pen";
import MemoBox from "./MemoBox";
import CommentBubble from "./CommentBubble";
import "./Annotations.css";

/** Default pen stroke alpha (transparency). Matches --annotation-highlight-opacity
 *  (0.4) so pre-2.13 marks (alpha=null) render like a highlighter out of the box.
 *  Kept in sync with the CSS token by the comment; used as the `??` fallback on
 *  every pen path (the CSS var can't be read as a number in TSX). */
const PEN_DEFAULT_ALPHA = 0.4;

/** Is `a` part of the active set named by `activeId`? True when it IS that mark,
 *  or shares a non-null `group_id` with it — so a two-page highlight's sibling on
 *  another page lights together (hover outline + selected ring). */
function inActiveGroup(a: Annotation, activeId: string | null, all: Map<string, Annotation>): boolean {
  if (!activeId) return false;
  if (a.id === activeId) return true;
  const active = all.get(activeId);
  return active != null && active.group_id != null && active.group_id === a.group_id;
}

/** Build a mark's class string from its base + hover/selected/flash modifiers
 *  (Story 5.0: the one helper for the suffixing that was copy-pasted into all
 *  five render funcs; Story 3.6 adds `flashed`, the Annotation Bank jump's
 *  brief emphasis, following the exact same pattern). `classList` is the full
 *  static class (may carry extra classes like `annotation-region`/`--underline`);
 *  `modifierRoot` is the BEM root the `--hovered`/`--selected`/`--flash` suffixes
 *  attach to (often a prefix of `classList`). */
function markClass(
  classList: string,
  modifierRoot: string,
  hovered: boolean,
  selected: boolean,
  flashed: boolean,
): string {
  return (
    classList +
    (hovered ? ` ${modifierRoot}--hovered` : "") +
    (selected ? ` ${modifierRoot}--selected` : "") +
    (flashed ? ` ${modifierRoot}--flash` : "")
  );
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
  // The Annotation Bank's jump target (Story 3.6): a transient, group-aware
  // emphasis rendered exactly like hover/select — see markState below.
  const flashId = useAnnotationStore((s) => s.flashId);
  // Transient move/resize preview (Story 3.1): while a drag is in flight, render
  // the dragged mark + its frame at this anchor instead of the committed one.
  const dragPreview = useAnnotationStore((s) => s.dragPreview);
  const select = useAnnotationStore((s) => s.select);
  const clearSelection = useAnnotationStore((s) => s.clearSelection);
  const setHovered = useAnnotationStore((s) => s.setHovered);
  const retextAnnotation = useAnnotationStore((s) => s.retextAnnotation);
  const retextAnnotations = useAnnotationStore((s) => s.retextAnnotations);
  // Text-edit session coalescing (Story 3.2, AC-4): a memo or comment textarea
  // editing session (focus→blur) must land as ONE undo step, not one per keystroke.
  // On focus: pause the temporal store and save the pre-session annotations Map.
  // On blur: resume + push the pre-session snapshot to pastStates so one undo
  // returns to the state before the editing session started. If nothing changed
  // (no keystrokes), the Map ref is unchanged and we skip the push.
  const textSessionRef = useRef<Map<string, Annotation> | null>(null);
  const startTextEditSession = () => {
    textSessionRef.current = useAnnotationStore.getState().annotations;
    useAnnotationStore.temporal.getState().pause();
  };
  const commitTextEditSession = () => {
    useAnnotationStore.temporal.getState().resume();
    const pre = textSessionRef.current;
    textSessionRef.current = null;
    if (!pre) return;
    const current = useAnnotationStore.getState().annotations;
    if (current === pre) return; // nothing changed, skip
    const { pastStates } = useAnnotationStore.temporal.getState();
    useAnnotationStore.temporal.setState({
      pastStates: [...pastStates.slice(-99), { annotations: pre }],
      futureStates: [],
    });
  };
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

  // A mark's hover/selected/flashed state, group-aware (a two-page mark lights
  // as one). The shared preamble every render func used to recompute inline
  // (Story 5.0; `flashed` added Story 3.6 — the Bank jump's target emphasis).
  const markState = (a: Annotation) => ({
    hovered: inActiveGroup(a, hoveredId, annotations),
    selected: inActiveGroup(a, selectedId, annotations),
    flashed: inActiveGroup(a, flashId, annotations),
  });

  // While a move/resize drag is in flight, render the dragged mark (and its edit
  // frame) at the transient preview geometry instead of the committed anchor, so it
  // follows the pointer without a per-pointermove store commit (Story 3.1).
  const effAnchor = (a: Annotation): Annotation["anchor"] =>
    dragPreview && dragPreview.id === a.id ? dragPreview.anchor : a.anchor;

  // A mark that gets drag-handle move/resize in Story 3.1: pen (path) + rect
  // memo/region. Comments (bubble-edited) and text marks (Story 3.8 re-resolves
  // their run) are excluded — moving a text rect would desync anchor.text.
  const isEditable = (a: Annotation): boolean =>
    a.anchor.kind === "path" || (a.anchor.kind === "rect" && a.type !== "comment");

  // The one selected mark on THIS page that shows an edit frame (single selection).
  const editMark = marks.find((a) => a.id === selectedId && isEditable(a)) ?? null;

  // Render one region mark as a single positioned fill div (geometry-on-kind = rect,
  // style-on-type: both highlight and comment get the ~0.4 fill from the highlights
  // opacity group; the comment's pin is rendered separately in renderComment).
  // The .annotation-highlight class gives it the 2.5 selection hit-test, hover ring,
  // and selected ring, so recolor/delete from the selection quick-box work for free.
  const renderRegion = (a: Annotation) => {
    const anchor = effAnchor(a);
    if (anchor.kind !== "rect") return null;
    const { hovered, selected, flashed } = markState(a);
    const cls = markClass(
      "annotation-highlight annotation-region",
      "annotation-highlight",
      hovered,
      selected,
      flashed,
    );
    const pos = denormalizeRect(anchor.rect, box, scale);
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
    const { hovered, selected, flashed } = markState(a);
    const cls = markClass(
      "annotation-highlight" + (underline ? " annotation-highlight--underline" : ""),
      "annotation-highlight",
      hovered,
      selected,
      flashed,
    );
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
    const anchor = effAnchor(a);
    if (anchor.kind !== "path") return null;
    const { hovered, selected, flashed } = markState(a);
    const cls = markClass("annotation-pen", "annotation-pen", hovered, selected, flashed);
    const pts = anchor.points.map((p) => denormalizePoint(p, box, scale));
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
    const anchor = effAnchor(a);
    if (anchor.kind !== "rect") return null;
    const { hovered, selected, flashed } = markState(a);
    const cls = markClass("annotation-memo", "annotation-memo", hovered, selected, flashed);
    return (
      <MemoBox
        key={a.id}
        anno={a}
        pos={denormalizeRect(anchor.rect, box, scale)}
        cls={cls}
        selected={selected}
        onRetext={(id, body) => retextAnnotation(id, body, new Date().toISOString())}
        onSelect={select}
        onHover={setHovered}
        onClearSelection={clearSelection}
        onTextFocus={startTextEditSession}
        onTextBlur={commitTextEditSession}
      />
    );
  };

  // Render one comment's PIN (both kinds) + its bubble when selected
  // (geometry-on-kind: a text comment anchors at its first rect's start; a rect
  // comment at the rect's top-left). The pin is a round <button> (keyboard-
  // reachable, the click selects the comment) holding a ChatCircle glyph, white
  // body + black border, straddling the run's top edge (half above, half over
  // it) at --comment-pin-opacity (~0.6) — going to full opacity on hover/select,
  // with NO outline ring (fix request: the ring read as a distracting box
  // around the icon; the opacity jump alone is the hover/selected tell) — so
  // engaging the comment reveals it clearly while it stays subtle at rest. A
  // fixed white/black badge reads as a comment marker regardless of the mark's
  // own accent color, which the highlight fill underneath already carries.
  // Built from two stacked same-size glyphs (`fill` white behind, `regular`
  // black on top) since no single Phosphor weight is two-tone; the
  // straddle-position + opacity + no-ring are CSS-only
  // (`.annotation-comment-pin`/`__icon-stack`), so the anchor math here is
  // unchanged and the comment bubble (which hangs off the SAME anchor point)
  // is unaffected. The highlight fill (text comments only) is painted by the
  // highlight group. The bubble mounts only for the EXACTLY-selected
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
    const { hovered, selected, flashed } = markState(a);
    const cls = markClass("annotation-comment-pin", "annotation-comment-pin", hovered, selected, flashed);
    return (
      <div key={a.id} className="annotation-comment" data-comment-id={a.id}>
        <button
          type="button"
          className={cls}
          data-testid={`annotation-comment-pin-${a.id}`}
          aria-label="Comment"
          style={{ left: anchor.left, top: anchor.top }}
          onPointerEnter={() => setHovered(a.id)}
          onPointerLeave={() => setHovered(null)}
          onClick={() => select(a.id)}
        >
          <span className="annotation-comment-pin__icon-stack" aria-hidden>
            <ChatCircle weight="fill" className="annotation-comment-pin__icon annotation-comment-pin__icon--fill" />
            <ChatCircle weight="regular" className="annotation-comment-pin__icon annotation-comment-pin__icon--outline" />
          </span>
        </button>
        {a.id === selectedId && (
          <CommentBubble
            anno={a}
            pos={anchor}
            onRetext={(_id, body) => {
              // Group-aware (Codex HIGH): a two-page comment is grouped siblings;
              // write the same body to ALL of them so reopening the other page's
              // pin shows the note, not a stale/empty one (matches recolor/delete).
              // retextAnnotations batches all group ids in ONE set() (Story 3.2, AC-4).
              retextAnnotations(commentGroupIds(a), body, new Date().toISOString());
            }}
            onRecolor={(color) => {
              recolorAnnotation(commentGroupIds(a), color, new Date().toISOString());
              setActiveColor(color);
            }}
            onDelete={() => deleteAnnotation(a.id)}
            onClearSelection={clearSelection}
            onTextFocus={startTextEditSession}
            onTextBlur={commitTextEditSession}
          />
        )}
      </div>
    );
  };

  // The edit frame for the selected pen/memo/region mark: a move grip + four
  // corner resize handles over its (preview-aware) bounding box. The handles carry
  // data-edit-handle + data-edit-id; useEditGesture turns a drag on one into a
  // geometry edit. Positioned via the anchor service so it rides zoom (NFR-3); the
  // handles are <button>s so the document-level deselect/create handlers skip them
  // (isExempt), keeping the mark selected during the drag.
  const renderEditFrame = (a: Annotation) => {
    const anchor = effAnchor(a);
    let fb: ScreenRect | null = null;
    if (anchor.kind === "rect") fb = denormalizeRect(anchor.rect, box, scale);
    else if (anchor.kind === "path") fb = denormalizeRect(pointsBounds(anchor.points), box, scale);
    if (!fb) return null;
    return (
      <div
        className="annotation-edit-frame"
        data-testid={`annotation-edit-frame-${a.id}`}
        style={{ left: fb.left, top: fb.top, width: fb.width, height: fb.height }}
      >
        {(["move", "nw", "ne", "sw", "se"] as const).map((hh) => (
          <button
            key={hh}
            type="button"
            className={`edit-handle edit-handle--${hh}`}
            data-edit-handle={hh}
            data-edit-id={a.id}
            data-testid={`edit-handle-${hh}-${a.id}`}
            aria-label={hh === "move" ? "Move annotation" : "Resize annotation"}
          />
        ))}
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
      {/* Edit frame (Story 3.1): the move grip + corner resize handles for the
          selected pen/memo/region mark. Its own NOT-aria-hidden, pointer-transparent
          group (focusable handle controls); each handle opts back into pointers. */}
      {editMark && (
        <div className="annotation-edit-frames" data-testid={`annotation-edit-frames-${pageIndex}`}>
          {renderEditFrame(editMark)}
        </div>
      )}
    </>
  );
}
