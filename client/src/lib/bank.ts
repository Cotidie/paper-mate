// bank.ts — the pure derivation behind the Annotation Bank (Story 3.6). Turns
// the store's raw annotation set into the ordered, group-deduped, doc-filtered
// row list `BankPanel` renders. A leaf module (AD-9): imports only `api/`
// types + the `anchor/` bbox helper, no store/DOM — so it is unit-testable
// with plain data, mirroring the anchor/render "pure math vs DOM wiring" split.

import type { Annotation } from "@/api/client";
import { pointsBounds } from "@/anchor";

/** One Bank row: the display-ready projection of an annotation (or, for a
 *  two-page group, its earliest sibling). `topFraction` is a `[0,1]` page-box
 *  fraction (zoom-independent, AD-4) — `Reader.jumpToAnnotation` multiplies it
 *  by the live card height. */
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

/** The mark's top edge as a `[0,1]` page fraction, for the jump target: the
 *  min rect `y0` for a (possibly multi-line) text run, the rect's own `y0`
 *  for a region/memo/comment box, or the pen stroke's bbox `y0` (reusing the
 *  anchor service's `pointsBounds` — no coordinate math here, AD-9). */
function topFractionOf(a: Annotation): number {
  const anchor = a.anchor;
  if (anchor.kind === "rect") return anchor.rect.y0;
  if (anchor.kind === "path") return pointsBounds(anchor.points).y0;
  return anchor.rects.length > 0 ? Math.min(...anchor.rects.map((r) => r.y0)) : 0;
}

function toBankItem(a: Annotation): BankItem {
  const { snippet, isPlaceholder } = snippetOf(a);
  return {
    id: a.id,
    type: a.type,
    colorToken: a.style.color,
    snippet,
    isPlaceholder,
    page: a.anchor.page_index + 1,
    pageIndex: a.anchor.page_index,
    topFraction: topFractionOf(a),
  };
}

/**
 * The Bank's row list (AC #1): every `docId` annotation of any of the five
 * types, ordered `created_at` ascending (AR-12, matching `store.all()`),
 * with a two-page group (shared non-null `group_id`) collapsed to ONE row,
 * the first (earliest) sibling encountered after sorting, so the jump lands
 * on its own page/anchor. Callers that want a subset (e.g. `BankPanel`'s
 * type filter) narrow the result with `filterBankItems`.
 */
export function bankItems(annotations: Iterable<Annotation>, docId: string): BankItem[] {
  const ordered = [...annotations]
    .filter((a) => a.doc_id === docId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const seenGroups = new Set<string>();
  const rows: BankItem[] = [];
  for (const a of ordered) {
    if (a.group_id != null) {
      if (seenGroups.has(a.group_id)) continue;
      seenGroups.add(a.group_id);
    }
    rows.push(toBankItem(a));
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
