// jsdom returns zeroed rects and has no real clipboard, so the GEOMETRY half
// of `measureSelectedLines` (top/left/right, and therefore the paragraph-vs-
// wrap decision itself) is live-smoke only — see CLAUDE.md / the story's Dev
// Notes. But `measureSelectedLines`'s TEXT extraction is pure Range/DOM-text
// work with no layout dependency, so it IS jsdom-testable, and is covered
// below (a regression test for a real bug: a drag that starts or ends
// mid-span was copying each boundary span's FULL text instead of just the
// highlighted portion). `joinParagraphLines` geometry below mirrors the
// Task 1 spike's real measurements (COCO/ACM SIGKDD/09-regularization):
// line-height ~24px, first-line indent ~20px (~0.4+ line-heights), column
// width ~500px.

import { describe, it, expect, afterEach } from "vitest";
import { joinParagraphLines, measureSelectedLines, type LineGeom } from "./paragraphCopy";

function line(text: string, top: number, left: number, right: number, fontSize = 20): LineGeom {
  return { text, top, left, right, fontSize };
}

/** Builds a `.textLayer` div from `lines` (arrays of span texts), appending a `<br role="presentation">` after each. */
function buildTextLayer(lines: string[][]): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "textLayer";
  for (const spans of lines) {
    for (const text of spans) {
      const span = document.createElement("span");
      span.textContent = text;
      span.style.fontSize = "20px";
      layer.appendChild(span);
    }
    const br = document.createElement("br");
    br.setAttribute("role", "presentation");
    layer.appendChild(br);
  }
  document.body.appendChild(layer);
  return layer;
}

function selectRange(range: Range): Selection {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
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

  it("(g) a 2-line selection with a genuine large gap still breaks (code-review fix)", () => {
    // With only ONE gap in the whole selection, a naive `median(gaps)` line-
    // height is self-referential: the lone gap always equals its own
    // "median", so `gap > BIG_GAP_RATIO * lineHeight` can never be true no
    // matter how large the real gap is. Same left/right (no indent or
    // short-line signal either, since there's no earlier line to establish
    // a baseline column width from) isolates the Y-gap signal specifically.
    const lines = [line("End of one paragraph", 700, 214, 700, 20), line("Start of the next", 900, 214, 700, 20)];
    expect(joinParagraphLines(lines)).toBe("End of one paragraph\nStart of the next");
  });

  it("(g cont.) a 2-line selection with a normal single-line gap still joins", () => {
    // Same 2-line shape, but the gap is an ordinary single-spacing advance
    // (~1.2x font-size) — must NOT be misread as a break now that the
    // font-size fallback is used instead of the self-referential gap.
    const lines = [line("Transformers have become the", 700, 214, 710, 20), line("dominant architecture", 724, 214, 705, 20)];
    expect(joinParagraphLines(lines)).toBe("Transformers have become the dominant architecture");
  });

  it("(h) de-hyphenates even when the line's raw text has a trailing space after the hyphen (code-review fix)", () => {
    const lines = [line("charac- ", 700, 214, 712), line("terizing relationships", 724, 214, 710)];
    expect(joinParagraphLines(lines)).toBe("characterizing relationships");
  });

  it("(i) never produces a double space when the source line already ends or starts with whitespace (code-review fix)", () => {
    const lines = [line("wrapped line with trailing space ", 700, 214, 710), line(" leading space too", 724, 214, 705)];
    expect(joinParagraphLines(lines)).toBe("wrapped line with trailing space leading space too");
  });
});

describe("measureSelectedLines (text clipping)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  it("clips a span the drag STARTS inside to only the selected tail, dropping earlier spans on the line", () => {
    const layer = buildTextLayer([["and ", "3D scene information"]]);
    const spans = layer.querySelectorAll("span");
    const range = document.createRange();
    // Start 4 chars into "3D scene information" ("3D s|cene information").
    range.setStart(spans[1].firstChild!, 4);
    range.setEnd(spans[1].firstChild!, spans[1].textContent!.length);
    const selection = selectRange(range);

    const lines = measureSelectedLines(selection);
    expect(lines).toHaveLength(1);
    // Must NOT include "and " (before the drag start) or the full "3D scene
    // information" (only "cene information" was actually dragged).
    expect(lines[0].text).toBe("cene information");
  });

  it("clips a span the drag ENDS inside to only the selected head, dropping later spans on the line", () => {
    const layer = buildTextLayer([["three core research problems ", "in scene understanding: de-"]]);
    const spans = layer.querySelectorAll("span");
    const range = document.createRange();
    range.setStart(spans[0].firstChild!, 0);
    // End 5 chars into "in scene understanding: de-" ("in sc|ene...").
    range.setEnd(spans[1].firstChild!, 5);
    const selection = selectRange(range);

    const lines = measureSelectedLines(selection);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("three core research problems in sc");
  });

  it("reproduces the reported bug: a drag from mid-span to mid-span across multiple lines copies only the highlighted characters at each edge, not whole lines", () => {
    const layer = buildTextLayer([
      ["attributes [9], keypoints [10], ", "and 3D scene information"],
      ["[11]. This leads us to the obvious question: what datasets"],
      ["will best continue our advance towards our ultimate goal"],
      ["of scene understanding?"],
      ["We introduce a new large-scale dataset that addresses"],
      ["three core research problems ", "in scene understanding: de-"],
    ]);
    const lines_ = layer.querySelectorAll("span");
    // Drag starts at "and " (4 chars into the second span of line 1: "and
    // 3D scene information" -> select from "3D scene information" on).
    const startSpan = lines_[1]; // "and 3D scene information"
    // Drag ends 5 chars into "in scene understanding: de-" on the last line.
    const endSpan = lines_[lines_.length - 1];
    const range = document.createRange();
    range.setStart(startSpan.firstChild!, 4);
    range.setEnd(endSpan.firstChild!, 5);
    const selection = selectRange(range);

    const lines = measureSelectedLines(selection);
    expect(lines).toHaveLength(6);
    expect(lines[0].text).toBe("3D scene information");
    expect(lines[1].text).toBe("[11]. This leads us to the obvious question: what datasets");
    expect(lines[2].text).toBe("will best continue our advance towards our ultimate goal");
    expect(lines[3].text).toBe("of scene understanding?");
    expect(lines[4].text).toBe("We introduce a new large-scale dataset that addresses");
    expect(lines[5].text).toBe("three core research problems in sc");
  });

  it("includes a fully-covered middle span untouched between two partially-clipped edge spans", () => {
    const layer = buildTextLayer([["AAAA", "BBBB", "CCCC"]]);
    const spans = layer.querySelectorAll("span");
    const range = document.createRange();
    range.setStart(spans[0].firstChild!, 2); // "AA|AA"
    range.setEnd(spans[2].firstChild!, 2); // "CC|CC"
    const selection = selectRange(range);

    const lines = measureSelectedLines(selection);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("AABBBBCC");
  });

  it("returns an empty array for a collapsed (empty) selection", () => {
    const layer = buildTextLayer([["some text"]]);
    const span = layer.querySelector("span")!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 0);
    range.setEnd(span.firstChild!, 0);
    const selection = selectRange(range);

    expect(measureSelectedLines(selection)).toEqual([]);
  });
});
