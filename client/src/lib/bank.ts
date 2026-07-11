// bank.ts — the pure derivation behind the Annotation Bank (Story 3.6). Turns
// the store's raw annotation set into the ordered, group-deduped, doc-filtered
// row list `BankPanel` renders. A leaf module (AD-9): imports only `api/`
// types + the `anchor/` bbox helper, no store/DOM — so it is unit-testable
// with plain data, mirroring the anchor/render "pure math vs DOM wiring" split.

import type { Annotation } from "@/api/client";
import { pointsBounds } from "@/anchor";

/** One Bank row: the display-ready projection of an annotation (or, for a
 *  two-page group, its earliest sibling). `topFraction`/`leftFraction` are
 *  `[0,1]` page-box fractions (zoom-independent, AD-4) from the mark's
 *  top-most rect — `Reader.jumpToAnnotation` multiplies `topFraction` by the
 *  live card height; `leftFraction` feeds the reading-order sort (Story 8.3). */
export interface BankItem {
  id: string;
  type: Annotation["type"];
  colorToken: string;
  snippet: string;
  /** True when `snippet` is a fallback label (e.g. "Region"), not real content. */
  isPlaceholder: boolean;
  page: number;
  pageIndex: number;
  topFraction: number;
  /** The mark's left edge, paired with `topFraction` from the SAME rect (the
   *  reading start). Used only for the reading-order sort's same-row tie-break. */
  leftFraction: number;
}

/** Fallback label shown when a mark has no readable text of its own (an empty
 *  memo/comment body) or none was ever possible (a region highlight / pen
 *  stroke has no anchored text at all). Exported: `BankPanel` reuses it to
 *  build each row's accessible name (the type name, not just the snippet). */
export const TYPE_LABEL: Record<Annotation["type"], string> = {
  highlight: "Highlight",
  underline: "Underline",
  pen: "Pen stroke",
  memo: "Memo",
  comment: "Comment",
};

/** The five-value type universe (Story 8.2 AC #1), in the Bank's canonical
 *  display order. The single source `BankPanel` builds its filter chips from
 *  and tests assert against, so nobody re-lists the enum inline. */
export const BANK_FILTER_TYPES: readonly Annotation["type"][] = ["highlight", "underline", "pen", "memo", "comment"];

/** The filter's default on every Bank open (AC #2): comments only. */
export const DEFAULT_BANK_FILTER: ReadonlySet<Annotation["type"]> = new Set(["comment"]);

/** Trim outer whitespace and collapse internal newlines to a single space, so
 *  a multi-line note reads as one line in the row (visual truncation is CSS
 *  line-clamp, not string-slicing here — the full text stays available). */
function collapse(text: string): string {
  return text.trim().replace(/\n+/g, " ");
}

/** The row's display text. `memo`/`comment` prefer `body` (a note reads better
 *  than the anchored run) over any `kind=text` anchor; a region highlight
 *  (`kind=rect`) or a pen stroke (`kind=path`) has no text at all. Every branch
 *  that comes up empty falls back to `TYPE_LABEL` so no row is ever blank. */
function snippetOf(a: Annotation): { snippet: string; isPlaceholder: boolean } {
  if (a.type === "memo" || a.type === "comment") {
    const body = collapse(a.body ?? "");
    return body ? { snippet: body, isPlaceholder: false } : { snippet: TYPE_LABEL[a.type], isPlaceholder: true };
  }
  const anchor = a.anchor;
  if (anchor.kind === "path") return { snippet: TYPE_LABEL.pen, isPlaceholder: true };
  if (anchor.kind === "rect") return { snippet: "Region", isPlaceholder: true };
  const text = collapse(anchor.text);
  return text ? { snippet: text, isPlaceholder: false } : { snippet: TYPE_LABEL[a.type], isPlaceholder: true };
}

/** The mark's top-left corner as `[0,1]` page fractions, both from the SAME
 *  rect (D3: the reading start, not a Frankenstein of separate min-`y0` and
 *  min-`x0`). For a (possibly multi-line) text run this is the rect with the
 *  minimum `y0`; for a region/memo/comment box it is the rect's own
 *  `{x0,y0}`; for a pen stroke it is the bbox top-left (reusing the anchor
 *  service's `pointsBounds` — no coordinate math here, AD-9). Empty `rects`
 *  falls back to `{top: 0, left: 0}`. `top` is the jump target
 *  (`topFraction`) and MUST equal the old `topFractionOf`'s min-`y0`. */
function anchorTopLeft(a: Annotation): { top: number; left: number } {
  const anchor = a.anchor;
  if (anchor.kind === "rect") return { top: anchor.rect.y0, left: anchor.rect.x0 };
  if (anchor.kind === "path") {
    const bounds = pointsBounds(anchor.points);
    return { top: bounds.y0, left: bounds.x0 };
  }
  if (anchor.rects.length === 0) return { top: 0, left: 0 };
  const topRect = anchor.rects.reduce((min, r) => (r.y0 < min.y0 ? r : min));
  return { top: topRect.y0, left: topRect.x0 };
}

function toBankItem(a: Annotation): BankItem {
  const { snippet, isPlaceholder } = snippetOf(a);
  const { top, left } = anchorTopLeft(a);
  return {
    id: a.id,
    type: a.type,
    colorToken: a.style.color,
    snippet,
    isPlaceholder,
    page: a.anchor.page_index + 1,
    pageIndex: a.anchor.page_index,
    topFraction: top,
    leftFraction: left,
  };
}

/** Same-row tolerance for the reading-order Y comparison (D2): two rects
 *  whose `top` differ by less than this count as one "row" and order by
 *  `left` instead — a typical line-height is ~0.015 of the page box, so this
 *  catches same-line marks without merging adjacent lines. Validated against
 *  a real paper in Task 5 live smoke; tune here if it proves off. */
const READING_ORDER_Y_EPSILON = 0.01;

/** page ascending, then epsilon-banded top (same "row" ties go to `left`
 *  ascending), then `created_at` as the final deterministic tie-break. */
function readingOrderCompare(
  a: { pageIndex: number; top: number; left: number; createdAt: string },
  b: { pageIndex: number; top: number; left: number; createdAt: string },
): number {
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
  if (Math.abs(a.top - b.top) > READING_ORDER_Y_EPSILON) return a.top - b.top;
  if (a.left !== b.left) return a.left - b.left;
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * The Bank's row list (AC #1): every `docId` annotation of any of the five
 * types, ordered in reading order (FR-24, AR-12) — page ascending, then
 * top-to-bottom, then left-to-right for same-row ties, with `created_at` as
 * the final deterministic tie-break — with a two-page group (shared
 * non-null `group_id`) collapsed to ONE row, the first sibling encountered
 * after sorting (i.e. its earliest-page, top-most one, AC #2), so the jump
 * lands on its own page/anchor. Callers that want a subset (e.g.
 * `BankPanel`'s type filter) narrow the result with `filterBankItems`.
 */
export function bankItems(annotations: Iterable<Annotation>, docId: string): BankItem[] {
  const ordered = [...annotations]
    .filter((a) => a.doc_id === docId)
    .map((a) => ({ annotation: a, item: toBankItem(a) }))
    .sort((x, y) =>
      readingOrderCompare(
        { pageIndex: x.item.pageIndex, top: x.item.topFraction, left: x.item.leftFraction, createdAt: x.annotation.created_at },
        { pageIndex: y.item.pageIndex, top: y.item.topFraction, left: y.item.leftFraction, createdAt: y.annotation.created_at },
      ),
    );

  const seenGroups = new Set<string>();
  const rows: BankItem[] = [];
  for (const { annotation: a, item } of ordered) {
    if (a.group_id != null) {
      if (seenGroups.has(a.group_id)) continue;
      seenGroups.add(a.group_id);
    }
    rows.push(item);
  }
  return rows;
}

/**
 * Narrows a row list to the active types (Story 8.2 AC #2, #4). Pure and
 * order-preserving: this is view state only, it never reorders or mutates,
 * so it composes with the Story 8.3 reading-order sort regardless of which
 * runs first.
 */
export function filterBankItems(items: BankItem[], activeTypes: ReadonlySet<Annotation["type"]>): BankItem[] {
  return items.filter((item) => activeTypes.has(item.type));
}
