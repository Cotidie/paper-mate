// Build `Annotation` entities from page selections (AD-4, AD-5). Pure + DOM-free
// so the two-page `group_id` split (AC-5) and the entity shape are unit-testable
// without a live selection. The TS shape comes from the generated type (AD-3);
// this module never hand-authors it.
//
// Story 5.0: the five near-twin `Build*Options` interfaces collapse onto ONE
// `CreateBase` (the shared `now`/`newId`/`color` every tool injects) plus per-tool
// extensions that carry ONLY that tool's extra fields (text → `type`/`body`, pen →
// `strokeWidth`/`alpha`). The three identical `{ page_index, rect }` placements
// (memo, comment-pin, region) collapse onto one `RectPlacement`. No behavior or
// contract change: the builders assemble the same `Annotation` shape as before.

import type { Annotation, Point, Rect } from "@/api/client";
import type { PageSelection } from "@/anchor";
import type { AnnotationTool } from "./machine";

/** The fields every create request shares: the injected clock + id factory
 *  (deterministic tests) and the resolved style color (a token name). Each tool's
 *  request extends this with only its own extra fields. */
export interface CreateBase {
  /** ISO-8601 UTC timestamp for created_at/updated_at (`new Date().toISOString()`). */
  now: string;
  /** UUID factory (the `newId` util — `crypto.randomUUID` with an insecure-context
   *  `getRandomValues` fallback); injectable for deterministic tests. */
  newId: () => string;
  /** Resolved style color (a token name; e.g. the default highlight). */
  color: string;
}

/** A single page's rect placement (memo box, comment pin, region) — the page it
 *  landed on + its normalized `[0,1]` rect (AD-4). Feeds a `RectAnchor`. The three
 *  rect tools share this exact shape; what differs is the built `type`/`body`. For
 *  a memo the rect dimensions ARE the box size (the `SizeRow` preset, baked at
 *  placement — there is no separate size field, AD-5); a comment pin uses a
 *  degenerate (point) rect; a region uses the canonicalized drag bounds. */
export interface RectPlacement {
  page_index: number;
  rect: Rect;
}

/** The text-anchor create request (highlight / underline / comment via drag). */
export interface TextCreateRequest extends CreateBase {
  /** The annotation type (a text-anchor tool: highlight / underline / comment). */
  type: AnnotationTool;
  /** Optional `body` for the built marks (Story 2.10). Highlight/underline omit it
   *  (→ null); the comment DRAG path passes `""` so a `kind=text` comment carries a
   *  non-null body (AD-5: `body` non-null for comment) the bubble then edits. */
  body?: string;
}

/**
 * One `Annotation` per page the selection covers, each with a single-page
 * `text` anchor. A selection that split across two pages shares one `group_id`
 * (UUIDv4); a single-page selection has `group_id = null` (AC-5). `body` defaults
 * to null (highlight/underline); a comment drag passes `""` (Story 2.10).
 */
export function buildAnnotations(pages: PageSelection[], docId: string, opts: TextCreateRequest): Annotation[] {
  const { now, newId, type, color, body } = opts;
  const groupId = pages.length > 1 ? newId() : null;
  return pages.map((page) => ({
    id: newId(),
    doc_id: docId,
    type,
    group_id: groupId,
    anchor: {
      kind: "text",
      page_index: page.page_index,
      rects: page.rects,
      text: page.text,
    },
    style: { color, stroke_width: null, alpha: null },
    body: body ?? null,
    created_at: now,
    updated_at: now,
  }));
}

/** One drawn freehand stroke on a single page: the page it landed on + the
 *  normalized `[0,1]` `points` (AD-4). Feeds a `PathAnchor`. */
export interface PenStroke {
  page_index: number;
  points: Point[];
}

/** The pen create request: the shared base + the path-only style fields. */
export interface PenCreateRequest extends CreateBase {
  /** Stroke diameter in scale-1.0 CSS px (the renderer multiplies by scale). */
  strokeWidth: number;
  /** Stroke transparency 0..1 (Story 2.13). Default = highlighter opacity. */
  alpha: number;
}

/**
 * Build ONE pen `Annotation` from a freehand stroke (AD-5: `pen → path`). Always
 * single-page (a `PathAnchor` has one `page_index`), so `group_id` is null — no
 * two-page split (that is the text-selection path's concern, AR-4). `stroke_width`
 * and `alpha` are path-only style; `body` is null.
 */
export function buildPenAnnotation(stroke: PenStroke, docId: string, opts: PenCreateRequest): Annotation {
  const { now, newId, color, strokeWidth, alpha } = opts;
  return {
    id: newId(),
    doc_id: docId,
    type: "pen",
    group_id: null,
    anchor: { kind: "path", page_index: stroke.page_index, points: stroke.points },
    style: { color, stroke_width: strokeWidth, alpha },
    body: null,
    created_at: now,
    updated_at: now,
  };
}

/** The memo create request: the shared base + its opacity (user feature
 *  request, the memo twin of pen's alpha — the fill's blend-toward-white
 *  strength, MemoBox.tsx). */
export interface MemoCreateRequest extends CreateBase {
  /** Fill transparency 0..1 (1 = fully saturated color, no white blend). */
  alpha: number;
}

/**
 * Build ONE memo `Annotation` (AD-5: `memo → rect`). The FIRST `kind=rect` mark
 * and the FIRST mark with a non-null `body`: it starts as `""` and updates as the
 * user types (via `retextAnnotation`). Always single-page (a `RectAnchor` has one
 * `page_index`), so `group_id` is null. `stroke_width` is path-only style, so it
 * stays null; the size lives in the rect, not in style.
 */
export function buildMemoAnnotation(memo: RectPlacement, docId: string, opts: MemoCreateRequest): Annotation {
  const { now, newId, color, alpha } = opts;
  return {
    id: newId(),
    doc_id: docId,
    type: "memo",
    group_id: null,
    anchor: { kind: "rect", page_index: memo.page_index, rect: memo.rect },
    style: { color, stroke_width: null, alpha },
    body: "",
    created_at: now,
    updated_at: now,
  };
}

/**
 * Build ONE region highlight `Annotation` (AD-5: `highlight → rect`, AR-5).
 * The first mark built from a free rectangle drag (pen drags a path; box-highlight
 * builds a bounding rect). Always single-page (`group_id` null); `stroke_width`
 * is path-only, so null; `body` is null (a region highlight has no body).
 */
export function buildRegionAnnotation(region: RectPlacement, docId: string, opts: CreateBase): Annotation {
  const { now, newId, color } = opts;
  return {
    id: newId(),
    doc_id: docId,
    type: "highlight",
    group_id: null,
    anchor: { kind: "rect", page_index: region.page_index, rect: region.rect },
    style: { color, stroke_width: null, alpha: null },
    body: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Build ONE `kind=rect` comment `Annotation` (AD-5: `comment → rect`). The twin of
 * `buildMemoAnnotation` but `type="comment"`: the rect is a small anchor for the
 * pin (no box is drawn, no fill). `body` starts as `""` (non-null, like memo) and
 * updates as the user types into the bubble (via `retextAnnotation`). Always
 * single-page, so `group_id` is null; `stroke_width` is path-only, so it stays null.
 */
export function buildCommentPin(pin: RectPlacement, docId: string, opts: CreateBase): Annotation {
  const { now, newId, color } = opts;
  return {
    id: newId(),
    doc_id: docId,
    type: "comment",
    group_id: null,
    anchor: { kind: "rect", page_index: pin.page_index, rect: pin.rect },
    style: { color, stroke_width: null, alpha: null },
    body: "",
    created_at: now,
    updated_at: now,
  };
}
