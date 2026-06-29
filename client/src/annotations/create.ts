// Build `Annotation` entities from page selections (AD-4, AD-5). Pure + DOM-free
// so the two-page `group_id` split (AC-5) and the entity shape are unit-testable
// without a live selection. The TS shape comes from the generated type (AD-3);
// this module never hand-authors it.

import type { Annotation, Point } from "../api/client";
import type { PageSelection } from "../anchor";
import type { AnnotationTool } from "./machine";

export interface BuildOptions {
  /** ISO-8601 UTC timestamp for created_at/updated_at (`new Date().toISOString()`). */
  now: string;
  /** UUID factory (the `newId` util — `crypto.randomUUID` with an insecure-context
   *  `getRandomValues` fallback); injectable for deterministic tests. */
  newId: () => string;
  /** The annotation type (Story 2.2 proof = "highlight"). */
  type: AnnotationTool;
  /** Resolved style color (a token name; Story 2.2 = the default highlight). */
  color: string;
}

/**
 * One `Annotation` per page the selection covers, each with a single-page
 * `text` anchor. A selection that split across two pages shares one `group_id`
 * (UUIDv4); a single-page selection has `group_id = null` (AC-5).
 */
export function buildAnnotations(pages: PageSelection[], docId: string, opts: BuildOptions): Annotation[] {
  const { now, newId, type, color } = opts;
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
    style: { color, stroke_width: null },
    body: null,
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

export interface BuildPenOptions {
  /** ISO-8601 UTC timestamp for created_at/updated_at. */
  now: string;
  /** UUID factory (injectable for deterministic tests). */
  newId: () => string;
  /** Resolved style color (a token name). */
  color: string;
  /** Stroke diameter in scale-1.0 CSS px (the renderer multiplies by scale). */
  strokeWidth: number;
}

/**
 * Build ONE pen `Annotation` from a freehand stroke (AD-5: `pen → path`). Always
 * single-page (a `PathAnchor` has one `page_index`), so `group_id` is null — no
 * two-page split (that is the text-selection path's concern, AR-4). `stroke_width`
 * is path-only style; `body` is null.
 */
export function buildPenAnnotation(stroke: PenStroke, docId: string, opts: BuildPenOptions): Annotation {
  const { now, newId, color, strokeWidth } = opts;
  return {
    id: newId(),
    doc_id: docId,
    type: "pen",
    group_id: null,
    anchor: { kind: "path", page_index: stroke.page_index, points: stroke.points },
    style: { color, stroke_width: strokeWidth },
    body: null,
    created_at: now,
    updated_at: now,
  };
}
