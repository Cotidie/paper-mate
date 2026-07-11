// render/paragraphCopy — Story 8.1: joins a soft-wrapped paragraph's per-line
// `<br role="presentation">`-separated text (Story 4.1's `textSelection.ts`
// reproduces pdf.js's one-`<br>`-per-line layout so inter-line whitespace
// survives `selection.toString()`) back into continuous prose on copy,
// without losing a genuine paragraph break.
//
// pdf.js's `hasEOL` (the source of every `<br>`) fires on EVERY visually
// distinct line — a soft wrap and a real paragraph end look identical in the
// PDF's own data. A PDF carries no paragraph-boundary metadata at all, so
// this module rebuilds the distinction from geometry: consecutive lines'
// Y-gap vs the selection's own line-height, left-edge indent, and whether a
// line is filled to the column's right edge or ends in terminal punctuation.
// Thresholds are unitless ratios of the MEASURED line-height (never a raw
// px constant): px scales with zoom/DPR/font-size across papers, so a fixed
// px threshold that fits one paper's type size is wrong for the next.
//
// Split per the project's measure-vs-decide convention: `joinParagraphLines`
// is a pure function over already-measured geometry (jsdom-testable);
// `measureSelectedLines` is the thin DOM adapter that reads real
// `getBoundingClientRect()`s (jsdom returns zeroed rects — live-smoke only).

/** One visual line's measured geometry, in DOM/reading order. */
export interface LineGeom {
  text: string;
  top: number;
  left: number;
  right: number;
  fontSize: number;
}

// Ratios of the selection's measured line-height (see `lineHeightOf`).
const COLUMN_JUMP_RATIO = 0.5; // top moves backward at least this much of a line-height → new column
const BIG_GAP_RATIO = 1.4; // Y-gap this many line-heights or more → blank-line-style break
const INDENT_RATIO = 0.4; // left shifts right of the paragraph's body-left by this much → new paragraph
const SHORT_LINE_RATIO = 1.5; // right edge falls this far short of the column-right → unfilled line
const TERMINAL_PUNCTUATION = /[.!?:;]$/;
// A wrap that breaks mid-word: a letter immediately followed by a hyphen at
// line end. De-hyphenate on join (`"charac-"` + `"terizing"` → `"characterizing"`)
// rather than leaving `"charac- terizing"` or `"charac-terizing"` — the
// hyphen was only ever a line-wrap artifact, not part of the word.
const HYPHEN_WRAP = /\p{L}-$/u;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0];
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }
  return best;
}

/**
 * The selection's typical single-line-to-next-line Y advance: the median of
 * consecutive positive top-deltas. Falls back to the modal font-size (× a
 * standard ~1.2 single-spacing ratio) when there aren't enough gaps to take a
 * median from (a two-line selection has only one gap, which IS the
 * line-height whether it's a wrap or a break — the font-size fallback only
 * matters for a one-line selection, where there's no gap at all).
 */
function lineHeightOf(lines: LineGeom[]): number {
  const gaps = lines
    .slice(1)
    .map((line, i) => line.top - lines[i].top)
    .filter((gap) => gap > 0);
  if (gaps.length > 0) return median(gaps);
  const fontSize = mode(lines.map((line) => line.fontSize).filter((size) => size > 0));
  return fontSize > 0 ? fontSize * 1.2 : 1;
}

/**
 * Joins already-measured per-line geometry into the clipboard string: a soft
 * wrap becomes a single space (or a de-hyphenated join), a genuine break
 * becomes `\n`. An ambiguous line (no break signal fires) defaults to JOIN —
 * matching normal reader/browser copy, since the common wrapped-paragraph
 * case is the visible win this story exists for.
 */
export function joinParagraphLines(lines: LineGeom[]): string {
  if (lines.length === 0) return "";

  const lineHeight = lineHeightOf(lines) || 1;
  const parts: string[] = [lines[0].text];
  let bodyLeft = lines[0].left;
  let columnRight = lines[0].right;

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    const gap = cur.top - prev.top;

    const columnJump = gap < -COLUMN_JUMP_RATIO * lineHeight;
    const bigGap = gap > BIG_GAP_RATIO * lineHeight;
    const indented = cur.left > bodyLeft + INDENT_RATIO * lineHeight;
    const shortAndTerminal =
      columnRight - prev.right > SHORT_LINE_RATIO * lineHeight &&
      TERMINAL_PUNCTUATION.test(prev.text.trimEnd());
    const isBreak = columnJump || bigGap || indented || shortAndTerminal;

    if (isBreak) {
      parts.push("\n" + cur.text);
      bodyLeft = cur.left;
      columnRight = cur.right;
      continue;
    }

    if (HYPHEN_WRAP.test(prev.text.trimEnd())) {
      parts[parts.length - 1] = parts[parts.length - 1].replace(/-$/, "");
      parts.push(cur.text);
    } else {
      parts.push(" " + cur.text);
    }
    bodyLeft = Math.min(bodyLeft, cur.left);
    columnRight = Math.max(columnRight, cur.right);
  }

  return parts.join("");
}

/**
 * Reads the live per-line geometry of the SELECTED spans within `selection`,
 * grouped by their text layer's `<br role="presentation">` boundaries — the
 * adapter `joinParagraphLines` needs. DOM-measurement only; not
 * unit-testable (jsdom returns zeroed rects), covered by live smoke.
 */
export function measureSelectedLines(selection: Selection): LineGeom[] {
  const layers = new Set<HTMLElement>();
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    for (const container of [range.startContainer, range.endContainer]) {
      const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);
      const layer = element?.closest<HTMLElement>(".textLayer");
      if (layer) layers.add(layer);
    }
  }

  const lines: LineGeom[] = [];
  for (const layer of layers) {
    let current: HTMLElement[] = [];
    const flush = (): void => {
      const selected = current.filter((span) => selection.containsNode(span, true));
      if (selected.length > 0) {
        const rects = selected.map((span) => span.getBoundingClientRect());
        lines.push({
          text: selected.map((span) => span.textContent ?? "").join(""),
          top: Math.min(...rects.map((rect) => rect.top)),
          left: Math.min(...rects.map((rect) => rect.left)),
          right: Math.max(...rects.map((rect) => rect.right)),
          fontSize: parseFloat(selected[0].style.fontSize) || 0,
        });
      }
      current = [];
    };
    for (const child of layer.childNodes) {
      if (child instanceof HTMLBRElement) flush();
      else if (child instanceof HTMLSpanElement) current.push(child);
    }
    flush();
  }
  return lines;
}
