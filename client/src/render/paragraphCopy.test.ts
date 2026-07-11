// jsdom returns zeroed rects and has no real clipboard, so this only covers
// the pure `joinParagraphLines` over synthetic `LineGeom[]` (the DOM adapter,
// `measureSelectedLines`, is live-smoke only — see CLAUDE.md / the story's
// Dev Notes). Geometry below mirrors the Task 1 spike's real measurements
// (COCO/ACM SIGKDD/09-regularization): line-height ~24px, first-line indent
// ~20px (~0.4+ line-heights), column width ~500px.

import { describe, it, expect } from "vitest";
import { joinParagraphLines, type LineGeom } from "./paragraphCopy";

function line(text: string, top: number, left: number, right: number, fontSize = 20): LineGeom {
  return { text, top, left, right, fontSize };
}

describe("joinParagraphLines", () => {
  it("returns empty string for no lines", () => {
    expect(joinParagraphLines([])).toBe("");
  });

  it("returns a single line's text unchanged", () => {
    const lines = [line("Just one visual line.", 700, 214, 600)];
    expect(joinParagraphLines(lines)).toBe("Just one visual line.");
  });

  it("(a) joins three soft-wrapped lines at ~1 line-height gap with single spaces", () => {
    const lines = [
      line("Transformers have become the", 700, 214, 710),
      line("dominant architecture for", 724, 214, 705),
      line("sequence modeling.", 748, 214, 450),
    ];
    expect(joinParagraphLines(lines)).toBe(
      "Transformers have become the dominant architecture for sequence modeling.",
    );
  });

  it("(b) keeps a hard break across a large Y-gap (blank line / heading spacing)", () => {
    // Four lines at a steady 24px gap establish the line-height, THEN one
    // 40px gap (over BIG_GAP_RATIO(1.4) * 24 = 33.6) breaks. A 2-line
    // selection can't test this signal in isolation: with only one gap to
    // measure from, that gap always defines its own line-height (see
    // `lineHeightOf`'s fallback note) and can never look "big" relative to
    // itself.
    const lines = [
      line("Line one of a short paragraph", 700, 214, 705),
      line("line two continues normally", 724, 214, 708),
      line("line three still going", 748, 214, 702),
      line("and continues here", 772, 214, 705),
      line("New paragraph after blank line", 812, 214, 520),
    ];
    expect(joinParagraphLines(lines)).toBe(
      "Line one of a short paragraph line two continues normally line three still going and continues here\nNew paragraph after blank line",
    );
  });

  it("(c) keeps a hard break when the next line is indented, even at a normal Y-gap", () => {
    const lines = [
      line("Paragraph one text that fills the line", 700, 214, 710),
      // gap = 24 (normal line-height); left = 234 = indented ~20px right of body-left 214
      line("Paragraph two first line", 724, 234, 705),
    ];
    expect(joinParagraphLines(lines)).toBe(
      "Paragraph one text that fills the line\nParagraph two first line",
    );
  });

  it("(d) keeps a hard break for a short, terminally-punctuated line even at a normal Y-gap and no indent", () => {
    const lines = [
      // Establishes columnRight ~710 (a normal, filled line).
      line("This is a normal filled line that reaches the edge", 700, 214, 710),
      // Short (710 - 450 = 260 >> 1.5*24=36) and ends in ".".
      line("This sentence ends here.", 724, 214, 450),
      line("Next paragraph starts normally", 748, 214, 705),
    ];
    expect(joinParagraphLines(lines)).toBe(
      "This is a normal filled line that reaches the edge This sentence ends here.\nNext paragraph starts normally",
    );
  });

  it("(e) defaults an ambiguous line (no break signal fires) to JOIN", () => {
    const lines = [
      line("An ambiguous wrap case", 700, 214, 700),
      line("continues here", 724, 214, 690),
    ];
    expect(joinParagraphLines(lines)).toBe("An ambiguous wrap case continues here");
  });

  it("(f) de-hyphenates a mid-word wrap (trans-\\nformer style)", () => {
    const lines = [
      line("charac-", 700, 214, 712),
      line("terizing relationships between objects", 724, 214, 710),
    ];
    expect(joinParagraphLines(lines)).toBe("characterizing relationships between objects");
  });

  it("keeps a hard break across a column jump (top moves backward)", () => {
    const lines = [
      line("Last line of column one", 1340, 214, 715),
      // Column two starts far above column one's last line.
      line("First line of column two", 460, 750, 1230),
    ];
    expect(joinParagraphLines(lines)).toBe("Last line of column one\nFirst line of column two");
  });
});
