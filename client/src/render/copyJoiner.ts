// render/copyJoiner — Story 8.1's clipboard rewrite: when a copy's selection is
// a single contiguous run entirely inside our registered text layers, replace
// the clipboard text with the paragraph-joined form (soft-wrapped PDF lines
// collapsed to one line) via `paragraphCopy.ts`. Anything else falls through
// to native copy untouched. Stateless — one function the composing controller
// binds to the `copy` event (AD-9: no anchor/annotations/store import).

import { joinParagraphLines, measureSelectedLines } from "./paragraphCopy";
import type { TextLayerRegistry } from "./textLayerRegistry";

export function interceptParagraphCopy(event: ClipboardEvent, registry: TextLayerRegistry): void {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  // A discontiguous multi-range selection (e.g. Firefox ctrl+drag) is rare,
  // and the join heuristic operates over a single contiguous range's lines.
  // Rather than silently keep only the first range, fall through to native
  // copy so nothing is dropped.
  if (selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);

  // AC-5: only act when the range is entirely within OUR registered text
  // layers. Anything else (a memo/comment editor, Bank text, app chrome, or a
  // mixed selection spanning one of those) falls through to native copy
  // untouched — no preventDefault.
  if (!registry.rangeStaysWithinTextLayers(range)) return;

  const lines = measureSelectedLines(selection);
  if (lines.length === 0) return;
  const joined = joinParagraphLines(lines);
  if (!joined) return;

  event.clipboardData?.setData("text/plain", joined);
  event.preventDefault();
}
