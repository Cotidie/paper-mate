// Build `Annotation` entities from page selections (AD-4, AD-5). Pure + DOM-free
// so the two-page `group_id` split (AC-5) and the entity shape are unit-testable
// without a live selection. The TS shape comes from the generated type (AD-3);
// this module never hand-authors it.

import type { Annotation } from "../api/client";
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
