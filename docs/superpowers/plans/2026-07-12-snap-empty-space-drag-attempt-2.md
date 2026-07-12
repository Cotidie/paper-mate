# Snap Empty-Space Drag to Nearest Text (attempt 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a press-drag that starts in blank page space snap its selection to the nearest text and behave like a normal on-text drag (live highlight, create-on-release, copy), instead of Story 8.8's no-op.

**Architecture:** Spike-with-fallback. A caret-API-free resolver (validated in the 8.9 spike) maps an empty-origin pointer to the nearest `{ textNode, offset }`. A decision-gate probe (Task 2) answers the one open question: can we seed a native selection during the drag that SURVIVES the browser's collapse-on-release? If yes → Method A (Task 3A): `setBaseAndExtent` per pointermove in `render/textSelection.ts`, everything downstream (create, copy, quick-box) unchanged because they already read `window.getSelection()`. If no → Method B (Task 3B): never trust native selection — publish resolved endpoints, render our own preview, build the mark from a `Range` via an extracted `rectsFromRange`.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest/jsdom, raw pdf.js text layer (AD-2), native `Selection`/`Range` API. No new dependencies.

## Global Constraints

Copied verbatim from the spec/story — every task's requirements implicitly include these:

- **AD-9 layering:** `client/src/render/` imports NOTHING from `anchor/`, `annotations/`, or `store/`. The resolver replicates `collectTextRects`'s per-text-node sub-range measurement LOCALLY; it does not import it.
- **No caret-API family:** never call `document.caretRangeFromPoint` / `document.caretPositionFromPoint` anywhere — dead per the 8.9 spike (mid-session corruption).
- **No column-aware clipping:** never post-filter `window.getSelection()`'s rects to a column band, never drive a logical column/line model per-move. `setBaseAndExtent` produces the plain native contiguous range only. (This is the reverted-attempts failure class: `deferred-work.md` L62-79, L189-197.)
- **Live smoke is the acceptance gate:** own fresh `uvicorn` + `vite dev` (never a found-running server), DPR>1, TRUSTED pointer input (raw mouse move/down/up — not `dispatchEvent`/`.click()`/synthetic Range), REPEATED same-session drags (never fresh-load-only), fixture `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf`.
- **No em-dash (—) in any new user-facing string** (none expected). Code comments are exempt.
- **Frontend test command:** `cd client && npm test` (Vitest). **Typecheck:** `cd client && npm run typecheck`.
- **A negative outcome is complete and acceptable:** if Task 2 fails AND Task 3B fails live smoke, do Task 5 (write-up) and land no production code.

---

## File Structure

- `client/src/render/nearestTextAnchor.ts` (**Create**) — the pure resolver. Local to `render/` (AD-9). Injectable rect readers for jsdom tests. Used by the probe and both methods.
- `client/src/render/nearestTextAnchor.test.ts` (**Create**) — unit tests for the pure resolver.
- `client/src/render/textSelection.ts` (**Modify**) — the empty-origin gate. Task 2 adds a throwaway probe; Task 3A adds the `snapping` latch + scoped `pointermove` + `setBaseAndExtent`.
- `client/src/render/textSelection.test.ts` (**Modify**) — add Method A gate tests (Task 3A).
- Method B only (Task 3B): `client/src/anchor/index.ts` (**Modify**, extract `rectsFromRange`), `client/src/anchor/anchor.test.ts` (**Modify**), a store field in `client/src/store/index.ts` (**Modify**), and a preview hook in `client/src/annotations/` (**Create**).

Not re-exported from the `render/` barrel (like `textSelection.ts`/`paragraphCopy.ts`), so `vi.mock("./render")` barrels in `App.test.tsx`/`Reader.test.tsx` need no change.

---

## Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Cut the story branch from the current HEAD**

The design spec (`docs/superpowers/specs/2026-07-12-...`) and the story file (`.bmad/implementation-artifacts/8-11-...`) live on the current branch tip. Branch from here so they come along.

Run:
```bash
git checkout -b story-8-11-snap-empty-space-drag
git log --oneline -1
```
Expected: a new branch `story-8-11-snap-empty-space-drag` at the current commit (the 8.11 story-creation commit).

---

## Task 1: The nearest-text resolver (used by the probe and both methods)

**Files:**
- Create: `client/src/render/nearestTextAnchor.ts`
- Test: `client/src/render/nearestTextAnchor.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module, DOM + injectable rect readers only).
- Produces:
  - `interface SpanLine { spans: HTMLElement[]; top: number; bottom: number }`
  - `groupSpanLines(spans: HTMLElement[], elRectsOf?): SpanLine[]`
  - `nearestLine(lines: SpanLine[], y: number): SpanLine | null`
  - `nearestSpanInLine(line: SpanLine, x: number, elRectsOf?): HTMLElement | null`
  - `nearestOffsetInTextNode(textNode: Text, x: number, rectsOf?): number`
  - `interface NearestTextPoint { node: Text; offset: number }`
  - `resolveNearestTextPoint(layer: Element, x: number, y: number, elRectsOf?, rangeRectsOf?): NearestTextPoint | null`
  - Default rect readers: `elRectsOf = (el) => el.getBoundingClientRect()`, `rangeRectsOf/rectsOf = (r) => r.getClientRects()`.

- [ ] **Step 1: Write the failing tests**

Create `client/src/render/nearestTextAnchor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  groupSpanLines,
  nearestLine,
  nearestSpanInLine,
  nearestOffsetInTextNode,
  type SpanLine,
} from "./nearestTextAnchor";

// A fake element-rect reader keyed off a WeakMap so tests place spans in space
// without real layout (jsdom returns zeroed rects).
function rectReader(map: WeakMap<Element, DOMRect>) {
  return (el: Element): DOMRect => map.get(el) ?? new DOMRect(0, 0, 0, 0);
}
function span(rotate?: string): HTMLElement {
  const s = document.createElement("span");
  if (rotate) s.style.setProperty("--rotate", rotate);
  return s;
}

describe("groupSpanLines", () => {
  it("groups spans into bands by vertical overlap", () => {
    const a = span(), b = span(), c = span();
    const rects = new WeakMap<Element, DOMRect>([
      [a, new DOMRect(100, 0, 40, 16)], // line 1
      [b, new DOMRect(200, 2, 40, 16)], // line 1 (overlaps a vertically)
      [c, new DOMRect(100, 20, 40, 16)], // line 2
    ]);
    const lines = groupSpanLines([a, b, c], rectReader(rects));
    expect(lines).toHaveLength(2);
    expect(lines[0].spans).toEqual([a, b]);
    expect(lines[1].spans).toEqual([c]);
  });

  it("skips a rotated (--rotate) span so it can't merge every line into one band", () => {
    const rot = span("-90deg"), a = span();
    const rects = new WeakMap<Element, DOMRect>([
      [rot, new DOMRect(10, 0, 40, 800)], // page-tall rotated run
      [a, new DOMRect(100, 100, 40, 16)],
    ]);
    const lines = groupSpanLines([rot, a], rectReader(rects));
    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toEqual([a]);
  });
});

describe("nearestLine", () => {
  const lines: SpanLine[] = [
    { spans: [], top: 0, bottom: 16 },
    { spans: [], top: 20, bottom: 36 },
  ];
  it("returns the band containing y", () => {
    expect(nearestLine(lines, 10)).toBe(lines[0]);
    expect(nearestLine(lines, 30)).toBe(lines[1]);
  });
  it("returns the nearest band when y is between", () => {
    expect(nearestLine(lines, 40)).toBe(lines[1]);
  });
  it("prefers the PRECEDING band when equidistant", () => {
    // y=18: 2px below line0 bottom, 2px above line1 top -> preceding (line0)
    expect(nearestLine(lines, 18)).toBe(lines[0]);
  });
});

describe("nearestSpanInLine", () => {
  it("returns the containing span, else the horizontally nearest", () => {
    const a = span(), b = span();
    const rects = new WeakMap<Element, DOMRect>([
      [a, new DOMRect(100, 0, 40, 16)], // [100,140]
      [b, new DOMRect(200, 0, 40, 16)], // [200,240]
    ]);
    const line: SpanLine = { spans: [a, b], top: 0, bottom: 16 };
    expect(nearestSpanInLine(line, 210, rectReader(rects))).toBe(b);
    expect(nearestSpanInLine(line, 150, rectReader(rects))).toBe(a);
  });
});

describe("nearestOffsetInTextNode", () => {
  // "hello" (len 5), each char 10px wide, node starts at x=100.
  // Boundary at offset k sits at x = 100 + 10*k.
  const node = document.createTextNode("hello");
  const rectsOf = (r: Range) => {
    const s = r.startOffset, e = r.endOffset;
    return [new DOMRect(100 + 10 * s, 0, 10 * (e - s), 16)];
  };
  it("finds the nearest character boundary", () => {
    expect(nearestOffsetInTextNode(node, 134, rectsOf)).toBe(3); // 130 closer than 140
  });
  it("clamps to node start when the point is left of the line", () => {
    expect(nearestOffsetInTextNode(node, 90, rectsOf)).toBe(0);
  });
  it("clamps to node end when the point is right of the line (trailing blank space)", () => {
    expect(nearestOffsetInTextNode(node, 160, rectsOf)).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- --run src/render/nearestTextAnchor.test.ts`
Expected: FAIL — cannot resolve `./nearestTextAnchor` (module not created yet).

- [ ] **Step 3: Write the resolver**

Create `client/src/render/nearestTextAnchor.ts`:

```typescript
// render/nearestTextAnchor — resolve the nearest text position to an
// empty-origin pointer point WITHOUT the caretRangeFromPoint/
// caretPositionFromPoint family (poisoned mid-session; see
// deferred-work.md#Discarded: Story 8.9). Local to render/ (AD-9: no import
// from anchor/); replicates collectTextRects's per-text-node sub-range
// measurement locally rather than importing it.

export interface SpanLine {
  spans: HTMLElement[];
  top: number;
  bottom: number;
}

const defaultElRectsOf = (el: Element): DOMRect => el.getBoundingClientRect();
const defaultRangeRectsOf = (r: Range): ArrayLike<DOMRect> => r.getClientRects();

/** pdf.js sets --rotate as an INLINE style on a rotated glyph run (e.g. a
 * margin-printed arXiv id rotated -90deg). Its post-transform bounding box is
 * axis-aligned and near page-tall, which would otherwise merge every normal
 * line band into one. Read the inline custom property directly (jsdom-safe;
 * no computed style needed). */
function isRotatedSpan(span: HTMLElement): boolean {
  const rotate = span.style.getPropertyValue("--rotate").trim();
  return rotate !== "" && rotate !== "0deg" && rotate !== "0";
}

/** Group a text layer's glyph spans into line bands by vertical overlap.
 * pdf.js emits spans in column-major DOM order; nearestSpanInLine's horizontal
 * step resolves the origin's own column within a band. */
export function groupSpanLines(
  spans: HTMLElement[],
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
): SpanLine[] {
  const lines: SpanLine[] = [];
  for (const span of spans) {
    if (isRotatedSpan(span)) continue;
    const r = elRectsOf(span);
    if (r.width <= 0 || r.height <= 0) continue;
    const line = lines.find((l) => r.top < l.bottom && r.bottom > l.top);
    if (line) {
      line.spans.push(span);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ spans: [span], top: r.top, bottom: r.bottom });
    }
  }
  return lines;
}

/** Nearest line band to y: a containing band wins; else the nearer edge.
 * Equidistant between two lines prefers the PRECEDING line. */
export function nearestLine(lines: SpanLine[], y: number): SpanLine | null {
  let best: SpanLine | null = null;
  let bestDist = Infinity;
  let bestIsPreceding = false;
  for (const line of lines) {
    if (y >= line.top && y <= line.bottom) return line;
    const isPreceding = line.bottom <= y;
    const dist = isPreceding ? y - line.bottom : line.top - y;
    if (dist < bestDist || (dist === bestDist && isPreceding && !bestIsPreceding)) {
      best = line;
      bestDist = dist;
      bestIsPreceding = isPreceding;
    }
  }
  return best;
}

/** The glyph span in a line whose horizontal extent is nearest x (a containing
 * span wins; else the nearer edge). */
export function nearestSpanInLine(
  line: SpanLine,
  x: number,
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const span of line.spans) {
    const r = elRectsOf(span);
    if (x >= r.left && x <= r.right) return span;
    const dist = x < r.left ? r.left - x : x - r.right;
    if (dist < bestDist) {
      best = span;
      bestDist = dist;
    }
  }
  return best;
}

/** Binary-search the nearest character boundary within textNode to x. Every
 * probed boundary is measured with a NON-collapsed single-character sub-range
 * (a collapsed Range's getClientRects() is inconsistent across engines).
 * Mirrors collectTextRects's per-text-node sub-range pattern; rectsOf is
 * injectable so the search is unit-testable without real layout. */
export function nearestOffsetInTextNode(
  textNode: Text,
  x: number,
  rectsOf: (r: Range) => ArrayLike<DOMRect> = defaultRangeRectsOf,
): number {
  const length = textNode.length;
  if (length === 0) return 0;
  const boundaryX = (offset: number): number | null => {
    const r = document.createRange();
    if (offset <= 0) {
      r.setStart(textNode, 0);
      r.setEnd(textNode, Math.min(1, length));
      const rects = Array.from(rectsOf(r));
      return rects[0]?.left ?? null;
    }
    r.setStart(textNode, offset - 1);
    r.setEnd(textNode, offset);
    const rects = Array.from(rectsOf(r));
    return rects[rects.length - 1]?.right ?? null;
  };
  const startX = boundaryX(0);
  const endX = boundaryX(length);
  if (startX === null || endX === null) return 0;
  if (x <= startX) return 0;
  if (x >= endX) return length;
  let lo = 0;
  let hi = length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const midX = boundaryX(mid);
    if (midX !== null && midX <= x) lo = mid;
    else hi = mid;
  }
  const loX = boundaryX(lo) ?? x;
  const hiX = boundaryX(hi) ?? x;
  return Math.abs(x - loX) <= Math.abs(x - hiX) ? lo : hi;
}

export interface NearestTextPoint {
  node: Text;
  offset: number;
}

/** A pointer more than this many line-heights from the nearest band is a
 * genuinely empty margin, not "blank space next to text" — the no-op stays. */
const MAX_LINE_DISTANCE_IN_LINE_HEIGHTS = 2;

/** Resolve the nearest text position to (x, y) within layer (a registered
 * .textLayer), once. Null when no line is close enough to count as next to
 * text (the far-margin no-op case). */
export function resolveNearestTextPoint(
  layer: Element,
  x: number,
  y: number,
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
  rangeRectsOf: (r: Range) => ArrayLike<DOMRect> = defaultRangeRectsOf,
): NearestTextPoint | null {
  const spans = Array.from(layer.querySelectorAll<HTMLElement>("span")).filter(
    (s) => !s.classList.contains("endOfContent"),
  );
  const lines = groupSpanLines(spans, elRectsOf);
  const line = nearestLine(lines, y);
  if (!line) return null;
  const lineHeight = line.bottom - line.top || 16;
  const lineDistance = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
  if (lineDistance > lineHeight * MAX_LINE_DISTANCE_IN_LINE_HEIGHTS) return null;
  const span = nearestSpanInLine(line, x, elRectsOf);
  const textNode = span?.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const offset = nearestOffsetInTextNode(textNode as Text, x, rangeRectsOf);
  return { node: textNode as Text, offset };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- --run src/render/nearestTextAnchor.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `cd client && npm run typecheck`
Expected: no errors.

```bash
git add client/src/render/nearestTextAnchor.ts client/src/render/nearestTextAnchor.test.ts
git commit -m "Story 8.11: nearest-text resolver (caret-API-free) + unit tests"
```

---

## Task 2: Probe P — the decision gate (throwaway, live-smoke only)

**Files:**
- Modify (temporarily): `client/src/render/textSelection.ts`

This task produces a DECISION (Method A or Method B), not shipped code. Its probe branch is reverted at the end.

- [ ] **Step 1: Add the throwaway probe branch**

In `client/src/render/textSelection.ts`, import the resolver at the top:
```typescript
import { resolveNearestTextPoint } from "./nearestTextAnchor";
```
In `#enableGlobalListener`, replace the existing `pointerdown` listener body with a probe that resolves the origin layer, prevents default, and drives the selection on move. Add these inside `#enableGlobalListener` (the `pointermove` listener is new, `{ signal }`-scoped):

```typescript
    let snapAnchor: { node: Node; offset: number } | null = null;
    document.addEventListener(
      "pointerdown",
      (event) => {
        pointerDown = true;
        emptyOrigin = isEmptyLayerSpace(event.target, this.#textLayers);
        snapAnchor = null;
        if (emptyOrigin && event.target instanceof Element) {
          let layer: Element | null = this.#textLayers.has(event.target) ? event.target : null;
          if (!layer) for (const [div, eoc] of this.#textLayers) if (event.target === eoc) { layer = div; break; }
          const p = layer ? resolveNearestTextPoint(layer, event.clientX, event.clientY) : null;
          if (p) {
            event.preventDefault();
            snapAnchor = { node: p.node, offset: p.offset };
          }
        }
      },
      { signal },
    );
    document.addEventListener(
      "pointermove",
      (event) => {
        if (!snapAnchor) return;
        const target = document.elementFromPoint(event.clientX, event.clientY);
        let layer: Element | null = null;
        for (const div of this.#textLayers.keys()) if (div === target || div.contains(target)) { layer = div; break; }
        const f = layer ? resolveNearestTextPoint(layer, event.clientX, event.clientY) : null;
        const focus = f ?? snapAnchor;
        document.getSelection()?.setBaseAndExtent(snapAnchor.node, snapAnchor.offset, focus.node ?? focus.node, "offset" in focus ? focus.offset : snapAnchor.offset);
        console.log("[8.11-probe]", JSON.stringify({ x: event.clientX, y: event.clientY, hasFocus: !!f }));
      },
      { signal },
    );
```
Note: this is a rough probe. If `setBaseAndExtent`'s argument shape is awkward, simplify to `setBaseAndExtent(snapAnchor.node, snapAnchor.offset, (f ?? snapAnchor).node, (f ?? snapAnchor).offset)`.

- [ ] **Step 2: Launch your own dev servers**

Run (two shells, or background):
```bash
cd server && PYTHONPATH= uv run uvicorn app.main:app --port 8000
cd client && npm run dev
```
Confirm `http://localhost:8000/api/health` returns ok and the SPA loads on `http://localhost:5173`. DPR must be > 1 (a HiDPI display, or launch Chrome with `--force-device-scale-factor=1.25`).

- [ ] **Step 3: Live-smoke the decisive question with TRUSTED input**

Open the fixture `Multi-task self-supervised visual learning.pdf` at ~200% zoom. With a real mouse (or a CDP trusted-input driver — NOT `dispatchEvent`/synthetic Range, per `[[drag-tools-dont-create-text-selection]]`):
- Drag DOWN starting in the blank right margin next to a body line. Repeat 5+ times in the SAME session (interleave with on-text drags/clicks to "touch" the text layer). Drag UP too. Do one cross-column drag.
- After each release, read `window.getSelection()` in the console: is it non-collapsed, and did a highlight/underline/comment mark get created (the quick-box appear)?

- [ ] **Step 4: Record the decision**

- **Selection survives release AND a mark is created (on repeated drags) → Method A. Proceed to Task 3A.**
- **Selection is collapsed/empty on release despite `preventDefault()` → try `preventDefault()` on the `selectstart` and/or the `click` as a secondary lever, re-smoke once; if it still collapses → Method B. Proceed to Task 3B.**

Write the observed result (selection state on release, mark created y/n, which lever worked) into the story's Debug Log References — you'll need it for the Dev Agent Record and, if negative, the `deferred-work.md` write-up.

- [ ] **Step 5: Revert the probe**

```bash
git checkout -- client/src/render/textSelection.ts
```
Expected: `git status --short client/src/render/textSelection.ts` empty. (The resolver from Task 1 stays committed.)

---

## Task 3A: Method A — seed a native selection (DO THIS ONLY IF PROBE P PASSED)

**Files:**
- Modify: `client/src/render/textSelection.ts`
- Test: `client/src/render/textSelection.test.ts`

**Interfaces:**
- Consumes: `resolveNearestTextPoint` from `./nearestTextAnchor` (Task 1).
- Produces: no new exports; behavior change to the `TextSelectionController` singleton.

- [ ] **Step 1: Write the failing gate tests**

Add to `client/src/render/textSelection.test.ts`. These assert the jsdom-safe contract: when the resolver returns a point, `selectstart` is NOT suppressed and `setBaseAndExtent` is driven on move; when it returns null, Story 8.8's suppress fallback holds.

```typescript
import { vi } from "vitest";
import * as nearest from "./nearestTextAnchor";

describe("TextSelectionController — empty-origin snap (Method A)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function setupLayer() {
    const div = document.createElement("div");
    div.className = "textLayer";
    const glyph = document.createElement("span");
    glyph.append(document.createTextNode("nearest text"));
    div.append(glyph);
    document.body.append(div);
    const unregister = textSelectionController.register(div);
    return { div, glyph, unregister };
  }

  it("does NOT suppress selectstart when a nearest line resolves (snap active)", () => {
    const { div, glyph, unregister } = setupLayer();
    vi.spyOn(nearest, "resolveNearestTextPoint").mockReturnValue({
      node: glyph.firstChild as Text,
      offset: 0,
    });
    div.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const selectstart = new Event("selectstart", { cancelable: true, bubbles: true });
    document.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(false);
    unregister();
  });

  it("keeps the Story 8.8 selectstart suppression when NO nearest line resolves", () => {
    const { div, unregister } = setupLayer();
    vi.spyOn(nearest, "resolveNearestTextPoint").mockReturnValue(null);
    div.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const selectstart = new Event("selectstart", { cancelable: true, bubbles: true });
    document.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(true);
    unregister();
  });

  it("drives setBaseAndExtent from the resolved anchor on pointermove while snapping", () => {
    const { div, glyph, unregister } = setupLayer();
    const node = glyph.firstChild as Text;
    vi.spyOn(nearest, "resolveNearestTextPoint").mockReturnValue({ node, offset: 2 });
    const setBaseAndExtent = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ setBaseAndExtent } as unknown as Selection);
    div.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.dispatchEvent(new Event("pointermove", { bubbles: true }));
    expect(setBaseAndExtent).toHaveBeenCalledWith(node, 2, node, 2);
    unregister();
  });
});
```

Note: for the third test, the controller must call `resolveNearestTextPoint` through the imported binding so `vi.spyOn(nearest, ...)` intercepts it — import it as `import * as nearest` inside `textSelection.ts` OR reference it such that the spy applies. Simplest: in `textSelection.ts` call `resolveNearestTextPoint(...)` from a named import and, in the test, `vi.mock` is not needed because `vi.spyOn` on the namespace works when the SUT imports the same module binding. If the spy does not intercept a direct named import (ESM live-binding), switch the test to `vi.mock("./nearestTextAnchor", ...)`. Verify which works when you run Step 2.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- --run src/render/textSelection.test.ts`
Expected: FAIL — the snap tests fail (snapping not implemented; selectstart still suppressed unconditionally, no setBaseAndExtent).

- [ ] **Step 3: Implement Method A in `textSelection.ts`**

Add the import at the top (after the `paragraphCopy` import):
```typescript
import { resolveNearestTextPoint } from "./nearestTextAnchor";
```

In `#enableGlobalListener`, add `snapping` state next to `emptyOrigin`:
```typescript
    let pointerDown = false;
    let emptyOrigin = false;
    let snapping = false;
    let snapAnchor: { node: Node; offset: number } | null = null;
    let isFirefox: boolean | undefined;
    let prevRange: Range | null = null;
```

Replace the `pointerdown` listener with the snap-seeding version:
```typescript
    const originLayerOf = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      if (this.#textLayers.has(target)) return target;
      for (const [div, eoc] of this.#textLayers) if (target === eoc) return div;
      return null;
    };
    document.addEventListener(
      "pointerdown",
      (event) => {
        pointerDown = true;
        emptyOrigin = isEmptyLayerSpace(event.target, this.#textLayers);
        snapping = false;
        snapAnchor = null;
        if (emptyOrigin) {
          const layer = originLayerOf(event.target);
          const p = layer ? resolveNearestTextPoint(layer, event.clientX, event.clientY) : null;
          if (p) {
            // Snap: seed a real native selection at the nearest glyph and let
            // pointermove extend it. We DRIVE the selection per-move here — a
            // deliberate crossing of Story 8.9's spike-budget "no per-move
            // selection driving" guard. That guard's rationale was the reverted
            // attempts' column-band CLIPPING; we never clip (setBaseAndExtent
            // yields the plain native contiguous range), so the rationale holds.
            // preventDefault stops the browser's click-to-collapse on release,
            // which would otherwise wipe the built selection before pointerup
            // reads it (deferred-work.md#Discarded: Story 4.2 Part B).
            event.preventDefault();
            snapping = true;
            snapAnchor = { node: p.node, offset: p.offset };
          }
        }
      },
      { signal },
    );
    document.addEventListener(
      "pointermove",
      (event) => {
        if (!snapping || !snapAnchor) return;
        const layer = originLayerOf(document.elementFromPoint(event.clientX, event.clientY));
        const focus = (layer && resolveNearestTextPoint(layer, event.clientX, event.clientY)) || snapAnchor;
        document.getSelection()?.setBaseAndExtent(snapAnchor.node, snapAnchor.offset, focus.node, focus.offset);
      },
      { signal },
    );
```

Extend `releasePointer` to clear the snap state:
```typescript
    const releasePointer = (): void => {
      pointerDown = false;
      emptyOrigin = false;
      snapping = false;
      snapAnchor = null;
      this.#textLayers.forEach(reset);
    };
```

Narrow the `selectstart` suppression so it only fires for the no-nearest-line fallback:
```typescript
    document.addEventListener(
      "selectstart",
      (event) => {
        if (emptyOrigin && !snapping) event.preventDefault();
      },
      { signal },
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- --run src/render/textSelection.test.ts`
Expected: PASS (snap tests + the existing `isEmptyLayerSpace` / `pointercancel` / copy tests all green). If the `setBaseAndExtent` spy test fails to intercept the resolver, switch that test to `vi.mock("./nearestTextAnchor", () => ({ resolveNearestTextPoint: vi.fn() }))` and drive the mock's return per-case.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd client && npm test -- --run && npm run typecheck`
Expected: green. (Known flake: `Reader.test.tsx`'s Space-hold-pan test may fail only in the full run; re-run it in isolation — `npm test -- --run src/components/Reader/Reader.test.tsx` — to confirm it passes and is unrelated.)

- [ ] **Step 6: Commit**

```bash
git add client/src/render/textSelection.ts client/src/render/textSelection.test.ts
git commit -m "Story 8.11: snap empty-space drag by seeding a native selection (Method A)"
```

Proceed to Task 4 (live verification).

---

## Task 3B: Method B — deterministic own-overlay (DO THIS ONLY IF PROBE P FAILED)

Only implement this branch if Task 2 concluded the native selection cannot survive release. Skip entirely if you did Task 3A.

**Files:**
- Modify: `client/src/anchor/index.ts` (extract `rectsFromRange`)
- Test: `client/src/anchor/anchor.test.ts`
- Modify: `client/src/store/index.ts` (a live-snap-drag field)
- Create: `client/src/annotations/gestures/useSnapDragPreview.ts` (+ wire into `AnnotationInteraction.tsx`)
- Modify: `client/src/render/textSelection.ts` (publish endpoints instead of driving native selection)

**Interfaces:**
- Consumes: `resolveNearestTextPoint` (Task 1); `collectTextRects`, `normalizeRect`, `pickPage`, `mergeRects`, `type PageCardRef`, `type PageSelection` (existing `anchor/`); `buildAnnotations` (existing `annotations/create`).
- Produces: `rectsFromRange(range: Range, pages: PageCardRef[], scale: number, rectsOf?): PageSelection[]`; a store field `snapDrag: { pageEndpoints... } | null` with `setSnapDrag`.

- [ ] **Step 1: Write the failing test for `rectsFromRange`**

Add to `client/src/anchor/anchor.test.ts` (follow the file's existing injected-`rectsOf` pattern):

```typescript
import { rectsFromRange } from "./index";

describe("rectsFromRange", () => {
  it("produces per-page normalized rects from a single Range (the rectsFromSelection core)", () => {
    // Build a range over a text node in a page card; inject a rectsOf that
    // returns one client rect so the math (normalizeRect/pickPage) is exercised
    // without real layout. Mirror the existing rectsFromSelection test setup in
    // this file for the page-card fixture + rectsOf shape.
    // EXPECT: one PageSelection for the covered page with a normalized rect.
    // (Fill the fixture using this file's existing helpers so it matches the
    //  rectsFromSelection test already present.)
  });
});
```
Note: this file already tests `rectsFromSelection` — copy that test's fixture/`rectsOf` setup verbatim and assert `rectsFromRange(range, pages, scale, rectsOf)` returns the same shape for a single range that `rectsFromSelection` returns for a one-range selection.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npm test -- --run src/anchor/anchor.test.ts`
Expected: FAIL — `rectsFromRange` is not exported.

- [ ] **Step 3: Extract `rectsFromRange` from `rectsFromSelection`**

In `client/src/anchor/index.ts`, extract the per-range body of `rectsFromSelection` (lines ~490-537) into a new exported function and make `rectsFromSelection` delegate:

```typescript
export function rectsFromRange(
  range: Range,
  pages: PageCardRef[],
  scale: number,
  rectsOf: (r: Range) => ArrayLike<DOMRect> = (r) => r.getClientRects(),
): PageSelection[] {
  const cardBoxes: ClientBox[] = pages.map((p) => p.cardEl.getBoundingClientRect());
  const byPage = new Map<number, Rect[]>();
  for (const cr of collectTextRects(range, rectsOf)) {
    if (cr.width <= 0 || cr.height <= 0) continue;
    const idx = pickPage({ left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom }, cardBoxes);
    if (idx < 0) continue;
    const page = pages[idx];
    const cardRect = cardBoxes[idx];
    const local: LocalRect = {
      x0: cr.left - cardRect.left,
      y0: cr.top - cardRect.top,
      x1: cr.right - cardRect.left,
      y1: cr.bottom - cardRect.top,
    };
    const norm = normalizeRect(local, page.box, scale);
    const list = byPage.get(page.pageIndex) ?? [];
    list.push(norm);
    byPage.set(page.pageIndex, list);
  }
  const text = range.toString();
  const out: PageSelection[] = [];
  for (const page of pages) {
    const rects = byPage.get(page.pageIndex);
    if (rects && rects.length > 0) out.push({ page_index: page.pageIndex, rects: mergeRects(rects), text });
  }
  return out;
}

export function rectsFromSelection(
  selection: Selection | null,
  pages: PageCardRef[],
  scale: number,
  rectsOf: (r: Range) => ArrayLike<DOMRect> = (r) => r.getClientRects(),
): PageSelection[] {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
  // Multi-range (rare) merges each range's per-page rects, preserving card order.
  const byPage = new Map<number, PageSelection>();
  for (let r = 0; r < selection.rangeCount; r++) {
    for (const ps of rectsFromRange(selection.getRangeAt(r), pages, scale, rectsOf)) {
      const existing = byPage.get(ps.page_index);
      if (existing) existing.rects = mergeRects([...existing.rects, ...ps.rects]);
      else byPage.set(ps.page_index, { ...ps });
    }
  }
  const out: PageSelection[] = [];
  for (const page of pages) {
    const ps = byPage.get(page.pageIndex);
    if (ps) out.push(ps);
  }
  return out;
}
```
Keep the existing imports (`collectTextRects`, `normalizeRect`, `pickPage`, `mergeRects`, `ClientBox`, `LocalRect`, `Rect`, `PageSelection`, `PageCardRef`) — all already in this file.

- [ ] **Step 4: Run both anchor tests to verify they pass**

Run: `cd client && npm test -- --run src/anchor/anchor.test.ts`
Expected: PASS — the new `rectsFromRange` test AND the existing `rectsFromSelection` tests (no regression from the refactor).

- [ ] **Step 5: Commit the extraction**

```bash
git add client/src/anchor/index.ts client/src/anchor/anchor.test.ts
git commit -m "Story 8.11: extract rectsFromRange from rectsFromSelection"
```

- [ ] **Step 6: Add the live-snap-drag store field**

In `client/src/store/index.ts`, next to `dragPreview`/`setDragPreview`, add:
```typescript
      snapDrag: null as { pages: PageSelection[] } | null,
      setSnapDrag: (preview: { pages: PageSelection[] } | null) => set({ snapDrag: preview }),
```
Add the matching types to the store interface and exclude `snapDrag` from the zundo `partialize` (transient UI state, like `dragPreview`). Import `PageSelection` from `@/anchor` if not already.

- [ ] **Step 7: Publish endpoints from `render/textSelection.ts` (no native selection)**

Method B does NOT touch `window.getSelection()`. On empty-origin pointerdown resolve the anchor; on pointermove resolve the focus, build a `Range` from anchor→focus, compute `rectsFromRange`... but `render/` cannot import `anchor/` (AD-9). So `render/` publishes only the raw endpoints via a callback the Reader wires in (down-dependency), and the annotations-layer hook computes rects. Concretely: give `TextSelectionController` a `setSnapEndpoints((endpoints | null) => void)` sink that Reader injects (Reader already bridges render↔store). On pointerdown/move the controller calls the sink with `{ anchor: {node,offset}, focus: {node,offset} }`; on release it calls the sink with the final endpoints once, then null.

- [ ] **Step 8: Preview hook + create-on-release in `annotations/`**

Create `client/src/annotations/gestures/useSnapDragPreview.ts`: subscribe to the endpoints (via the store field set by Reader's sink), build `document.createRange()` + `setStart(anchor)/setEnd(focus)` (canonicalizing so anchor-after-focus flips), call `rectsFromRange` → set `snapDrag.pages`, and render a preview reusing `useCreateQuickBox`'s `previewRects` rendering (a position-fixed overlay of the `pages` rects). On release, call `buildAnnotations(pages, docId, {...})` + `addAnnotations` + select — the same create path `createTextTool` uses. Skip copy-during-drag (documented in a comment). Wire the hook into `AnnotationInteraction.tsx` next to the other gesture hooks.

- [ ] **Step 9: Typecheck + full suite + commit**

Run: `cd client && npm test -- --run && npm run typecheck`
Expected: green.
```bash
git add client/src/store/index.ts client/src/render/textSelection.ts client/src/annotations/
git commit -m "Story 8.11: deterministic snap preview + create-on-release (Method B)"
```

Proceed to Task 4 (live verification).

---

## Task 4: Live verification (both methods) — the real acceptance gate

**Files:** none (live smoke; then update the story's Dev Agent Record)

- [ ] **Step 1: Launch your own dev servers (fresh)**

```bash
cd server && PYTHONPATH= uv run uvicorn app.main:app --port 8000
cd client && npm run dev
```
DPR > 1. Open the fixture at ~200% zoom. Use TRUSTED pointer input only.

- [ ] **Step 2: Smoke the snap (AC 1, 7)**

Across REPEATED same-session drags (5+, interleaved with on-text interaction):
- Empty right-margin drag next to text snaps and selects from the nearest line, drag-DOWN and drag-UP. Mark creates on release.
- Empty cross-column gutter drag does NOT leak a cross-column or full-page highlight (inspect the created mark's rects — `collectTextRects` guard, 8.8 AC-5).
- Far-empty-margin drag (no nearby line) still no-ops.

- [ ] **Step 3: Smoke the 8.8 regressions (AC 7)**

- On-text single-line, multi-line, and CROSS-PAGE drags still select + highlight/underline/comment on release (cross-page is highest-risk and jsdom can't see it — `[[verify-on-hidpi-and-real-host]]`).
- Ctrl+C copies with the Story 8.1 paragraph-join intact.

- [ ] **Step 4: Shut servers down; record results in the story**

Fill the story's Dev Agent Record (Agent Model, Debug Log with the probe decision + smoke observations, Completion Notes, File List). Set the story Status to `review` and flip `sprint-status.yaml` `8-11-...` to `review`.

- [ ] **Step 5: Commit the story record**

```bash
git add .bmad/implementation-artifacts/8-11-snap-empty-space-drag-to-text-attempt-2.md .bmad/implementation-artifacts/sprint-status.yaml
git commit -m "Story 8.11: dev agent record + status -> review"
```

---

## Task 5: Negative write-up (ONLY IF Probe P failed AND Method B failed live smoke)

**Files:**
- Modify: `.bmad/implementation-artifacts/deferred-work.md`

- [ ] **Step 1: Append the negative result**

Append a "Discarded: Story 8.11" section mirroring the Story 8.9 / 4.2-Part-B rigor: which method failed, the exact observed failure (selection collapsed on release despite every lever; or Method B's preview/geometry proved unreliable), what was eliminated, and the revisit condition. Leave Story 8.8's no-op shipped. Revert all production code:
```bash
git checkout -- client/src/render/textSelection.ts client/src/anchor/index.ts client/src/store/index.ts
git rm client/src/annotations/gestures/useSnapDragPreview.ts 2>/dev/null || true
```
(Keep `nearestTextAnchor.ts` only if a future revisit wants it; otherwise `git rm` it too and note in the write-up that the resolver is recoverable from this commit.)

- [ ] **Step 2: Commit + set status**

Set the story Status to `review` (with the negative outcome documented), flip `sprint-status.yaml`.
```bash
git add .bmad/implementation-artifacts/
git commit -m "Story 8.11: negative outcome documented; 8.8 no-op stays shipped"
```

---

## Self-Review

**Spec coverage:**
- AC 1 (Probe P) → Task 2. AC 2 (resolver) → Task 1. AC 3 (Method A) → Task 3A. AC 4 (no-op fallback) → Task 3A Step 3 (`emptyOrigin && !snapping`). AC 5 (Method B) → Task 3B. AC 6 (scope guard) → Global Constraints + Task 3A comment. AC 7 (8.8 regression) → Task 4 Steps 2-3. AC 8 (no em-dash) → Global Constraints (no new strings). AC 9 (negative outcome) → Task 5. Covered.

**Placeholder scan:** Task 3B Steps 1, 7, 8 describe fixtures/wiring in prose rather than full code — deliberate, because Method B is the FALLBACK branch reached only if the probe fails, and its exact shape depends on the probe's failure mode. The `rectsFromRange` extraction (the one piece needed regardless) is fully coded (Step 3). If Task 3B is entered, treat Steps 7-8 as requiring the implementer to follow the existing `dragPreview`/`useCreateQuickBox` patterns cited. Flagged, not hidden.

**Type consistency:** `resolveNearestTextPoint` returns `{ node: Text; offset }` — consumed as `snapAnchor.node/offset` in Task 3A and endpoints in Task 3B. `rectsFromRange(range, pages, scale, rectsOf)` signature identical in Task 3B Steps 1 and 3. `PageSelection` used consistently. `snapping`/`snapAnchor` names consistent across Task 3A steps.
