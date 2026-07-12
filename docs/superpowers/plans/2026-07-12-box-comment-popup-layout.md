# Box Comment Popup Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box comment's popup (selected editor + hover preview) renders beside its highlighted region instead of overlapping it, with its color/delete chrome moved into a left-side vertical strip that reuses `MemoBox`'s existing selection quick-box pattern. Plain pin/text comments are unchanged.

**Architecture:** Extend the existing "left-vertical quick-box" mechanism (today memo-only) to also cover a *box comment* (`type=comment`, live `anchor.kind=rect` with real area — as opposed to a degenerate click-placed point pin). A new `isBoxComment`/`usesLeftVerticalQuickBox` pair of pure functions in `marks.ts` is the single source for "is this mark a box comment" / "does this mark's quick-box render vertically." `CommentBubble`/`CommentPreview` gain a `compact` prop that drops their internal color/delete chrome and switches their position from the pin-offset-below transform to a plain point already shifted to the box's right edge by the caller.

**Tech Stack:** React 19.2 + TypeScript, Vitest + Testing Library (jsdom), no new dependencies.

## Global Constraints

- No annotation-model or API-contract change; no new persisted fields (`server/openapi.json` / `client/src/api/schema.d.ts` stay byte-identical — nothing here touches the contract).
- No new `render/index.ts` export, so both `vi.mock("@/render")` barrels (`App.test.tsx`, `Reader.test.tsx`) stay untouched.
- No raw hex/px values outside `client/src/theme/**` (`no-raw-values` test enforces this) — this plan adds no CSS, only JS/TS positioning math and prop threading.
- No em-dash (—) in any user-facing string (tooltips, labels, aria-labels) — this plan adds no new user-facing copy, but any comment/doc text added is exempt (code comments only).
- Full regression (`cd client && npm test` + `npm run typecheck`) must stay green after every task.
- Live smoke for any selection/positioning feature must run at DPR>1 against a real multi-page PDF, using FRESH dev servers you start yourself (never a user-launched one) with `PAPER_MATE_DATA` pointed at an isolated scratch directory — never the user's real `~/.paper-mate`.

---

### Task 1: `position.ts` — export the shared gap constant + a `rightOf` helper

**Files:**
- Modify: `client/src/annotations/position.ts`
- Test: `client/src/annotations/position.test.ts`

**Interfaces:**
- Consumes: nothing (this module has zero imports today except types).
- Produces: `export const QUICK_BOX_GAP = 6;` and `export function rightOf(rect: ScreenRect, gap?: number): ScreenRect` — later tasks (`useSelection.ts`, `AnnotationInteraction.tsx`) import both.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/annotations/position.test.ts` (after the existing `describe("clampToViewport ...)` block, same file):

```ts
import { clampToViewport, rightOf, QUICK_BOX_GAP } from "./position";

describe("rightOf (box comment popup: beside the highlight, fix request)", () => {
  it("shifts left to the rect's right edge using the default gap; top/width/height carry over", () => {
    expect(rightOf({ left: 60, top: 160, width: 240, height: 160 })).toEqual({
      left: 60 + 240 + QUICK_BOX_GAP,
      top: 160,
      width: 240,
      height: 160,
    });
  });

  it("accepts a custom gap", () => {
    expect(rightOf({ left: 0, top: 0, width: 100, height: 50 }, 20)).toEqual({
      left: 120,
      top: 0,
      width: 100,
      height: 50,
    });
  });

  it("a zero-width rect (degenerate) shifts by only the gap", () => {
    expect(rightOf({ left: 10, top: 10, width: 0, height: 0 })).toEqual({
      left: 10 + QUICK_BOX_GAP,
      top: 10,
      width: 0,
      height: 0,
    });
  });
});
```

Note: `rightOf` returns a full `ScreenRect` (`{left, top, width, height}`), NOT a bare `{x, y}` `Point` — `CommentBubble`/`CommentPreview`'s `pos` prop requires `ScreenRect` (they destructure `pos.left`/`pos.top`), so the return type must match that shape exactly, even though width/height pass through unused by today's callers.

Replace the existing `import { clampToViewport } from "./position";` line at the top of the file with the `import { clampToViewport, rightOf, QUICK_BOX_GAP } from "./position";` line above (one import line total, not two).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run --run position.test.ts`
Expected: FAIL — `rightOf` and `QUICK_BOX_GAP` are not exported from `./position`.

- [ ] **Step 3: Implement**

In `client/src/annotations/position.ts`, the file currently reads:

```ts
// Pure quick-box positioning (AC-4): nudge the popup so it stays fully on-screen
// without ever shifting the canvas. DOM-free so it is unit-testable; the
// controller feeds it the measured box size + viewport at layout time.

export interface Point {
  x: number;
  y: number;
}

/**
 * Clamp the top-left `(x, y)` of a `boxW × boxH` popup so it stays within the
 * `vw × vh` viewport, keeping a `margin` gutter. If the box is wider/taller than
 * the viewport it pins to the top-left margin.
 */
export function clampToViewport(
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  vw: number,
  vh: number,
  margin = 8,
): Point {
  const maxX = Math.max(margin, vw - boxW - margin);
  const maxY = Math.max(margin, vh - boxH - margin);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
}
```

Change it to:

```ts
// Pure quick-box positioning (AC-4): nudge the popup so it stays fully on-screen
// without ever shifting the canvas. DOM-free so it is unit-testable; the
// controller feeds it the measured box size + viewport at layout time.

import type { ScreenRect } from "@/anchor";

export interface Point {
  x: number;
  y: number;
}

/** Gap (viewport px) between a mark and a quick-box/popup floating beside or
 *  below it — shared by every "beside the mark" placement (the memo selection
 *  quick-box's left shift, the box comment popup's right shift, fix request). */
export const QUICK_BOX_GAP = 6;

/**
 * Clamp the top-left `(x, y)` of a `boxW × boxH` popup so it stays within the
 * `vw × vh` viewport, keeping a `margin` gutter. If the box is wider/taller than
 * the viewport it pins to the top-left margin.
 */
export function clampToViewport(
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  vw: number,
  vh: number,
  margin = 8,
): Point {
  const maxX = Math.max(margin, vw - boxW - margin);
  const maxY = Math.max(margin, vh - boxH - margin);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
}

/**
 * `rect` shifted to sit just to the RIGHT of its own position, top-aligned,
 * `gap` px clear of its edge (box comment popup, fix request: beside the
 * highlight, never over it). Returns a full `ScreenRect` (NOT a bare `Point`)
 * because the caller (`CommentBubble`/`CommentPreview`'s `pos` prop) requires
 * that exact shape — width/height pass through unchanged, unused by today's
 * callers but keeping the return a well-formed `ScreenRect` like its input.
 */
export function rightOf(rect: ScreenRect, gap: number = QUICK_BOX_GAP): ScreenRect {
  return { left: rect.left + rect.width + gap, top: rect.top, width: rect.width, height: rect.height };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run --run position.test.ts`
Expected: PASS (all `clampToViewport` tests still pass, all 3 new `rightOf` tests pass).

- [ ] **Step 5: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/annotations/position.ts client/src/annotations/position.test.ts
git commit -m "Add rightOf position helper for box comment popup placement"
```

---

### Task 2: `marks.ts` — `isBoxComment` + `usesLeftVerticalQuickBox`, `quickBoxSpec` live-kind branch

**Files:**
- Modify: `client/src/annotations/marks.ts`
- Test: `client/src/annotations/marks.test.ts`

**Interfaces:**
- Consumes: `Annotation` type from `@/api/client` (already imported).
- Produces: `export function isBoxComment(anno: Annotation): boolean`, `export function usesLeftVerticalQuickBox(anno: Annotation | null): boolean` — consumed by Task 5 (`useSelection.ts`, `AnnotationInteraction.tsx`). `quickBoxSpec(anno).usesBubble` now returns `false` for a box comment.

- [ ] **Step 1: Update the existing test + add new cases (the failing step)**

In `client/src/annotations/marks.test.ts`, the file currently has this block:

```ts
  it("comment → routed to the bubble (generic box gated off), either kind", () => {
    expect(quickBoxSpec(anno("comment", "text")).usesBubble).toBe(true);
    expect(quickBoxSpec(anno("comment", "rect")).usesBubble).toBe(true);
  });
```

Note the file's `anno()` helper builds a `kind="rect"` fixture with `rect: { x0: 0, y0: 0, x1: 1, y1: 1 }` — a REAL-area rect, i.e. exactly what `isBoxComment` must now treat as a box comment. Replace that block with:

```ts
  it("comment (text-kind, or a degenerate click-placed pin) → routed to the bubble", () => {
    expect(quickBoxSpec(anno("comment", "text")).usesBubble).toBe(true);
    const pin: Annotation = {
      ...anno("comment", "rect"),
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.1, y1: 0.2 } },
    };
    expect(quickBoxSpec(pin).usesBubble).toBe(true);
  });

  it("comment (box/region — real-area rect, fix request) → routed to the shared quick-box instead", () => {
    // anno("comment", "rect") builds rect {x0:0,y0:0,x1:1,y1:1} — real area.
    expect(quickBoxSpec(anno("comment", "rect")).usesBubble).toBe(false);
  });
```

And add two new top-level test cases (append inside the same `describe("quickBoxSpec ...")` block, after the two above):

```ts
  it("isBoxComment: true only for a comment with a real-area rect anchor", () => {
    expect(isBoxComment(anno("comment", "rect"))).toBe(true);
    expect(isBoxComment(anno("comment", "text"))).toBe(false);
    expect(isBoxComment(anno("memo", "rect"))).toBe(false);
    const pin: Annotation = {
      ...anno("comment", "rect"),
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.1, y1: 0.2 } },
    };
    expect(isBoxComment(pin)).toBe(false);
  });

  it("usesLeftVerticalQuickBox: true for a memo or a box comment, false otherwise (or null)", () => {
    expect(usesLeftVerticalQuickBox(anno("memo", "rect"))).toBe(true);
    expect(usesLeftVerticalQuickBox(anno("comment", "rect"))).toBe(true);
    expect(usesLeftVerticalQuickBox(anno("comment", "text"))).toBe(false);
    expect(usesLeftVerticalQuickBox(anno("highlight", "rect"))).toBe(false);
    expect(usesLeftVerticalQuickBox(null)).toBe(false);
  });
```

Update the file's import line from:

```ts
import { MARK_DESCRIPTORS, quickBoxSpec } from "./marks";
```

to:

```ts
import { MARK_DESCRIPTORS, quickBoxSpec, isBoxComment, usesLeftVerticalQuickBox } from "./marks";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run --run marks.test.ts`
Expected: FAIL — `isBoxComment`/`usesLeftVerticalQuickBox` are not exported, and the two `usesBubble` assertions for a real-area rect comment currently return `true` (the OLD behavior), not `false`.

- [ ] **Step 3: Implement**

In `client/src/annotations/marks.ts`, the `QuickBoxSpec` interface's `usesBubble` doc comment currently reads:

```ts
  /** Comment: a selected comment shows the floating bubble in `AnnotationLayer`
   *  (recolor + delete there), NOT the generic selection quick-box — so the shared
   *  box is gated off (UX-DR5, Story 2.10 Decision 4). */
  usesBubble: boolean;
```

Change it to:

```ts
  /** Comment: a selected TEXT-kind or degenerate-point-pin comment shows the
   *  floating bubble in `AnnotationLayer` (recolor + delete there), NOT the
   *  generic selection quick-box — so the shared box is gated off (UX-DR5,
   *  Story 2.10 Decision 4). EXCEPTION (fix request): a BOX comment (real-area
   *  `kind=rect`, `isBoxComment` below) routes through the shared quick-box
   *  instead, rendered as a left-vertical strip beside the highlight — see
   *  `quickBoxSpec`, which resolves this live-kind exception. */
  usesBubble: boolean;
```

The `MarkDescriptor` interface's doc comment currently reads:

```ts
/** A per-mark descriptor (AD-5 dispatch key). `kind` is the canonical anchor
 *  geometry a freshly-created mark of this tool gets; `quickBox` is its selection
 *  affordance. (Note: a `highlight`/`comment` can ALSO be `kind=rect` when made by
 *  a region/click gesture — `kind` here is the default-create geometry, while the
 *  render/store layers branch on the LIVE `anchor.kind`. The quick-box spec keys on
 *  `type` only, which is sufficient: pen⟺path, memo⟺rect-memo, so no live-kind
 *  read is needed to pick the rows.) */
```

Change it to:

```ts
/** A per-mark descriptor (AD-5 dispatch key). `kind` is the canonical anchor
 *  geometry a freshly-created mark of this tool gets; `quickBox` is its selection
 *  affordance. (Note: a `highlight`/`comment` can ALSO be `kind=rect` when made by
 *  a region/click gesture — `kind` here is the default-create geometry, while the
 *  render/store layers branch on the LIVE `anchor.kind`. The quick-box spec keys on
 *  `type` only for every tool EXCEPT comment (fix request): `quickBoxSpec` below
 *  additionally reads the live anchor for a comment, since a box comment and a
 *  pin/text comment need different `usesBubble` values despite sharing one type.) */
```

The `comment` entry in `MARK_DESCRIPTORS` currently reads:

```ts
  comment: {
    type: "comment",
    kind: "rect",
    quickBox: { ...NO_ROWS, usesBubble: true, ariaLabel: "Highlight actions" },
  },
```

Change it to:

```ts
  comment: {
    type: "comment",
    kind: "rect",
    // usesBubble:true here is the DEFAULT (text-kind / degenerate-pin comment);
    // quickBoxSpec below overrides it to false for a box comment (fix request).
    quickBox: { ...NO_ROWS, usesBubble: true, ariaLabel: "Highlight actions" },
  },
```

Finally, the file currently ends with:

```ts
/** The quick-box spec for a mark (by its `type`). The single source the selection
 *  quick-box reads to decide its rows + label, instead of re-deriving them from
 *  `anchor.kind`/`type` booleans at the call site. */
export function quickBoxSpec(anno: Annotation): QuickBoxSpec {
  return MARK_DESCRIPTORS[anno.type as AnnotationTool].quickBox;
}
```

Change it to:

```ts
/** A box comment (Story 8.4 box-comment mode, fix request): a `type=comment`
 *  mark whose LIVE anchor is `kind=rect` with REAL area — as opposed to a
 *  click-placed pin (`buildCommentPin`'s degenerate point rect, `x0===x1 &&
 *  y0===y1` exactly, `COMMENT_CLICK_SLOP`-gated in `useCreateQuickBox.ts`) or a
 *  text-drag comment (`kind=text`). Only a box comment routes its selection
 *  actions through the shared quick-box (left-vertical strip) instead of
 *  `CommentBubble`'s own internal chrome. */
export function isBoxComment(anno: Annotation): boolean {
  return (
    anno.type === "comment" &&
    anno.anchor.kind === "rect" &&
    anno.anchor.rect.x1 > anno.anchor.rect.x0 &&
    anno.anchor.rect.y1 > anno.anchor.rect.y0
  );
}

/** Whether a selected mark's quick-box renders as a LEFT-side vertical strip
 *  (mirrors `MemoBox`'s own left-side action strip) instead of the default
 *  horizontal row below the mark. True for a memo, or a box comment (fix
 *  request) — both have their OWN separate text-entry surface floating beside
 *  the strip, so the strip must never steal focus into itself (`useSelection.ts`
 *  reads this same function for that focus-guard). */
export function usesLeftVerticalQuickBox(anno: Annotation | null): boolean {
  if (!anno || anno.anchor.kind !== "rect") return false;
  return anno.type === "memo" || isBoxComment(anno);
}

/** The quick-box spec for a mark (by its `type`, EXCEPT comment which also
 *  reads the live anchor — see `MarkDescriptor`'s doc comment above). The
 *  single source the selection quick-box reads to decide its rows + label,
 *  instead of re-deriving them from `anchor.kind`/`type` booleans at the call
 *  site. */
export function quickBoxSpec(anno: Annotation): QuickBoxSpec {
  const base = MARK_DESCRIPTORS[anno.type as AnnotationTool].quickBox;
  if (anno.type === "comment") return { ...base, usesBubble: !isBoxComment(anno) };
  return base;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run --run marks.test.ts`
Expected: PASS, all cases including the two new ones.

- [ ] **Step 5: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/annotations/marks.ts client/src/annotations/marks.test.ts
git commit -m "Route a box comment's selection through the shared quick-box"
```

---

### Task 3: `CommentBubble.tsx` — `compact` prop

**Files:**
- Modify: `client/src/annotations/CommentBubble.tsx`
- Test: `client/src/annotations/CommentBubble.test.tsx`

**Interfaces:**
- Consumes: nothing new (no import changes — `compact` is a plain boolean prop the caller, Task 5, computes and passes down).
- Produces: `CommentBubble` accepts a new optional `compact?: boolean` prop. When `true`: renders no `ColorSwatchRow`/convert/delete, and applies no `PIN_OFFSET_TRANSFORM` (assumes `pos` is already shifted by the caller). When `false`/omitted: pixel-for-pixel identical to today.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `client/src/annotations/CommentBubble.test.tsx` (after the existing 4 `describe` blocks, same file, same `comment()`/`pos`/`noop`/`renderBubble` helpers already in the file):

```ts
describe("CommentBubble compact mode (box comment popup layout, fix request)", () => {
  it("renders no color row, convert button, or delete button when compact", () => {
    render(
      <CommentBubble
        anno={comment("c10")}
        pos={pos}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        compact
      />,
    );
    expect(screen.queryByTestId("comment-delete-c10")).toBeNull();
    expect(screen.queryByTestId("color-swatch-annotation-blue")).toBeNull();
    expect(screen.queryByTestId("comment-convert-highlight-c10")).toBeNull();
    // The textarea and the resize handle are still there.
    expect(screen.getByTestId("comment-body-c10")).toBeTruthy();
    expect(screen.getByTestId("comment-bubble-resize-c10")).toBeTruthy();
  });

  it("renders at pos.left/pos.top with NO pin-offset transform when compact", () => {
    renderBubble("c11");
    const nonCompact = screen.getByTestId("comment-bubble-c11");
    expect(nonCompact.style.transform).toContain("translateY(calc(var(--comment-pin-size)");
    cleanup();

    render(
      <CommentBubble
        anno={comment("c12")}
        pos={pos}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        compact
      />,
    );
    const bubble = screen.getByTestId("comment-bubble-c12");
    expect(bubble.style.left).toBe("100px");
    expect(bubble.style.top).toBe("100px");
    expect(bubble.style.transform).toBe("translate(0px, 0px)");
  });

  it("a non-compact (or omitted) bubble is unchanged: color row, convert (kind=text only), and delete all present", () => {
    renderBubble("c13");
    expect(screen.getByTestId("comment-delete-c13")).toBeTruthy();
    expect(screen.getByTestId("color-swatch-annotation-blue")).toBeTruthy();
  });
});
```

Add `cleanup` to the file's existing `@testing-library/react` import line. The file currently starts:

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
```

Change the second line to:

```ts
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run --run CommentBubble.test.tsx`
Expected: FAIL — TypeScript error (`compact` is not a valid prop on `CommentBubble`) and/or the color row / delete button still render regardless.

- [ ] **Step 3: Implement**

In `client/src/annotations/CommentBubble.tsx`, the component's prop destructuring currently reads:

```tsx
export default function CommentBubble({
  anno,
  pos,
  onRetext,
  onRecolor,
  onConvertToHighlight,
  onDelete,
  onClearSelection,
  onTextFocus,
  onTextBlur,
  onResize,
}: {
  anno: Annotation;
  pos: ScreenRect;
  onRetext: (id: string, body: string) => void;
  onRecolor: (color: string) => void;
  /** Turn this comment back into a highlight (Story 3.7, AC2). Only rendered
   *  for a `kind=text` comment (the reverse revert has no rect counterpart). */
  onConvertToHighlight: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
  /** Commits a corner-handle resize (user feature request): persisted on
   *  `anno.style.bubble_width`/`bubble_height` so it survives reselect/reload. */
  onResize: (size: { width: number; height: number }) => void;
}) {
```

Change it to:

```tsx
export default function CommentBubble({
  anno,
  pos,
  onRetext,
  onRecolor,
  onConvertToHighlight,
  onDelete,
  onClearSelection,
  onTextFocus,
  onTextBlur,
  onResize,
  compact = false,
}: {
  anno: Annotation;
  pos: ScreenRect;
  onRetext: (id: string, body: string) => void;
  onRecolor: (color: string) => void;
  /** Turn this comment back into a highlight (Story 3.7, AC2). Only rendered
   *  for a `kind=text` comment (the reverse revert has no rect counterpart). */
  onConvertToHighlight: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
  /** Commits a corner-handle resize (user feature request): persisted on
   *  `anno.style.bubble_width`/`bubble_height` so it survives reselect/reload. */
  onResize: (size: { width: number; height: number }) => void;
  /** True for a BOX comment (fix request, `isBoxComment` in `marks.ts`): the
   *  caller has already positioned `pos` beside the highlight (no pin-offset
   *  shift needed here) and owns recolor/delete via the shared quick-box, so
   *  this renders only the textarea + resize handle, no internal chrome. */
  compact?: boolean;
}) {
```

The box's inline `style` currently reads:

```tsx
      style={{
        left: pos.left,
        top: pos.top,
        transform: `${PIN_OFFSET_TRANSFORM} translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        ...(manualWidth !== null ? { width: `${manualWidth}px` } : {}),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      }}
```

Change it to:

```tsx
      style={{
        left: pos.left,
        top: pos.top,
        transform: compact
          ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
          : `${PIN_OFFSET_TRANSFORM} translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        ...(manualWidth !== null ? { width: `${manualWidth}px` } : {}),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      }}
```

The actions row currently reads:

```tsx
      <div className="comment-bubble__actions">
        <ColorSwatchRow value={anno.style.color} onPick={onRecolor} ariaLabel="Comment color" />
        {anno.anchor.kind === "text" && (
          <button
            type="button"
            role="menuitem"
            className="comment-bubble__action"
            data-testid={`comment-convert-highlight-${anno.id}`}
            aria-label="Turn into highlight"
            title="Turn into highlight"
            onClick={onConvertToHighlight}
          >
            <Highlighter aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="comment-bubble__action"
          data-testid={`comment-delete-${anno.id}`}
          aria-label="Delete"
          title="Delete (Del)"
          onClick={onDelete}
        >
          <Trash aria-hidden />
        </button>
      </div>
```

Change it to:

```tsx
      {!compact && (
        <div className="comment-bubble__actions">
          <ColorSwatchRow value={anno.style.color} onPick={onRecolor} ariaLabel="Comment color" />
          {anno.anchor.kind === "text" && (
            <button
              type="button"
              role="menuitem"
              className="comment-bubble__action"
              data-testid={`comment-convert-highlight-${anno.id}`}
              aria-label="Turn into highlight"
              title="Turn into highlight"
              onClick={onConvertToHighlight}
            >
              <Highlighter aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="comment-bubble__action"
            data-testid={`comment-delete-${anno.id}`}
            aria-label="Delete"
            title="Delete (Del)"
            onClick={onDelete}
          >
            <Trash aria-hidden />
          </button>
        </div>
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run --run CommentBubble.test.tsx`
Expected: PASS, all cases (old + new).

- [ ] **Step 5: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/annotations/CommentBubble.tsx client/src/annotations/CommentBubble.test.tsx
git commit -m "Add compact mode to CommentBubble for box comment popup layout"
```

---

### Task 4: `CommentPreview.tsx` — `compact` prop

**Files:**
- Modify: `client/src/annotations/CommentPreview.tsx`
- Test: `client/src/annotations/CommentPreview.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CommentPreview` accepts a new optional `compact?: boolean` prop. When `true`: no `PIN_OFFSET_TRANSFORM` (assumes `pos` already shifted). `CommentPreview` has no internal color/delete chrome to remove (it never had any) — `compact` only changes positioning here.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `client/src/annotations/CommentPreview.test.tsx` (after the existing `describe` block, same file, same `comment()`/`pos`/`noop` helpers):

```ts
describe("CommentPreview compact mode (box comment popup layout, fix request)", () => {
  it("renders at pos.left/pos.top with NO pin-offset transform when compact", () => {
    render(
      <CommentPreview anno={comment("p10")} pos={pos} hovered={true} onRetext={noop} onHoverEnter={noop} onHoverLeave={noop} compact />,
    );
    const box = screen.getByTestId("comment-preview-p10");
    expect(box.style.left).toBe("100px");
    expect(box.style.top).toBe("100px");
    expect(box.style.transform).toBe("");
  });

  it("a non-compact (or omitted) preview keeps the pin-offset transform", () => {
    render(<CommentPreview anno={comment("p11")} pos={pos} hovered={true} onRetext={noop} onHoverEnter={noop} onHoverLeave={noop} />);
    const box = screen.getByTestId("comment-preview-p11");
    expect(box.style.transform).toContain("translateY(calc(var(--comment-pin-size)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run --run CommentPreview.test.tsx`
Expected: FAIL — `compact` is not a valid prop, and the transform is applied regardless.

- [ ] **Step 3: Implement**

In `client/src/annotations/CommentPreview.tsx`, the component's prop destructuring currently reads:

```tsx
export default function CommentPreview({
  anno,
  pos,
  hovered,
  onRetext,
  onHoverEnter,
  onHoverLeave,
  onTextFocus,
  onTextBlur,
}: {
  anno: Annotation;
  pos: ScreenRect;
  /** True while the pin (or this box) is hovered, group-aware (AnnotationLayer's
   *  `markState`) — the OPEN trigger; closing lags it by `HOVER_CLOSE_DELAY_MS`. */
  hovered: boolean;
  onRetext: (id: string, body: string) => void;
  /** Keeps `hoveredId` alive while the pointer sits on the box itself (not just
   *  the pin), so the hover ring and this box stay in sync. */
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
}) {
```

Change it to:

```tsx
export default function CommentPreview({
  anno,
  pos,
  hovered,
  onRetext,
  onHoverEnter,
  onHoverLeave,
  onTextFocus,
  onTextBlur,
  compact = false,
}: {
  anno: Annotation;
  pos: ScreenRect;
  /** True while the pin (or this box) is hovered, group-aware (AnnotationLayer's
   *  `markState`) — the OPEN trigger; closing lags it by `HOVER_CLOSE_DELAY_MS`. */
  hovered: boolean;
  onRetext: (id: string, body: string) => void;
  /** Keeps `hoveredId` alive while the pointer sits on the box itself (not just
   *  the pin), so the hover ring and this box stay in sync. */
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
  /** True for a BOX comment (fix request): the caller has already positioned
   *  `pos` beside the highlight, so no pin-offset shift is applied here. This
   *  component never had color/delete chrome, so `compact` only affects
   *  positioning (unlike `CommentBubble`'s `compact`). */
  compact?: boolean;
}) {
```

The box's inline `style` currently reads:

```tsx
      style={{
        left: pos.left,
        top: pos.top,
        transform: PIN_OFFSET_TRANSFORM,
        ...(manualWidth !== null ? { width: `${manualWidth}px` } : {}),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      }}
```

Change it to:

```tsx
      style={{
        left: pos.left,
        top: pos.top,
        ...(compact ? {} : { transform: PIN_OFFSET_TRANSFORM }),
        ...(manualWidth !== null ? { width: `${manualWidth}px` } : {}),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      }}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run --run CommentPreview.test.tsx`
Expected: PASS, all cases (old + new).

- [ ] **Step 5: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/annotations/CommentPreview.tsx client/src/annotations/CommentPreview.test.tsx
git commit -m "Add compact mode to CommentPreview for box comment popup layout"
```

---

### Task 5: `useSelection.ts` + `AnnotationInteraction.tsx` — wire it end-to-end

**Files:**
- Modify: `client/src/annotations/gestures/useSelection.ts`
- Modify: `client/src/annotations/AnnotationInteraction.tsx`
- Test: `client/src/annotations/AnnotationInteraction.test.tsx`

**Interfaces:**
- Consumes: `QUICK_BOX_GAP`, `rightOf` from `./position` (Task 1); `isBoxComment`, `usesLeftVerticalQuickBox` from `./marks` (Task 2); `compact` prop on `CommentBubble`/`CommentPreview` (Tasks 3–4).
- Produces: the full end-to-end behavior — selecting a box comment shows the shared quick-box (vertical, left of the highlight) plus a compact `CommentBubble` beside it; a pin/text comment is unchanged.

- [ ] **Step 1: Write the failing tests**

In `client/src/annotations/AnnotationInteraction.test.tsx`, the file has a `describe("AnnotationInteraction comment gestures (Story 2.10 — AC1,3,6)", ...)` block ending at (today) line 1633 with:

```ts
  it("an empty comment is KEPT on deselect (Decision 5 - NOT the memo cleanup)", () => {
    const comment: Annotation = {
      id: "c1",
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.1, y1: 0.2 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: "",
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
    useAnnotationStore.getState().addAnnotation(comment);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("c1"));
    act(() => useAnnotationStore.getState().clearSelection());
    // The empty comment survives (unlike an empty memo).
    expect(useAnnotationStore.getState().annotations.has("c1")).toBe(true);
  });
});
```

Immediately after that closing `});` (i.e. right after the "comment gestures" describe block), insert a new describe block:

```ts

describe("AnnotationInteraction box comment popup layout (fix request)", () => {
  /** A stored box comment: type=comment, kind=rect with REAL area (a drawn
   *  box, Story 8.4) — as opposed to a degenerate point-rect pin. Same rect as
   *  the memo gesture block's `memoMark` fixture above, for predictable pixel
   *  math: denormalized against `fakeCard`'s 600x800 page box at scale=1,
   *  {x0:0.1,y0:0.2,x1:0.5,y1:0.4} -> {left:60, top:160, width:240, height:160}.
   */
  function boxCommentMark(id: string, body = ""): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.4 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }

  it("a selected box comment shows the shared quick-box (vertical) with working recolor/delete, plus a compact bubble beside it", async () => {
    useAnnotationStore.getState().addAnnotation(boxCommentMark("c20", "note"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("c20"));

    const box = await screen.findByTestId("selection-quick-box");
    expect(box.className).toContain("quick-box--vertical");

    // Compact bubble: textarea + resize handle, positioned beside the box
    // (rightOf: left 60+240+6=306, top 160, no pin-offset shift).
    const bubble = screen.getByTestId("comment-bubble-c20");
    expect(bubble.style.left).toBe("306px");
    expect(bubble.style.top).toBe("160px");
    expect(screen.queryByTestId("comment-delete-c20")).toBeNull();
    expect(screen.getByTestId("comment-body-c20")).toBeTruthy();
    expect(screen.getByTestId("comment-bubble-resize-c20")).toBeTruthy();

    // Recolor from the SHARED quick-box works.
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    expect(useAnnotationStore.getState().annotations.get("c20")!.style.color).toBe("annotation-blue");

    // Delete from the SHARED quick-box works.
    fireEvent.click(screen.getByTestId("quick-box-delete"));
    expect(useAnnotationStore.getState().annotations.has("c20")).toBe(false);
  });

  it("a click-placed pin comment (degenerate point rect) is UNCHANGED: self-contained bubble, no shared quick-box", async () => {
    const pin: Annotation = {
      id: "c21",
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.1, y1: 0.2 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: "",
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
    useAnnotationStore.getState().addAnnotation(pin);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("c21"));

    await screen.findByTestId("comment-bubble-c21");
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
    expect(screen.getByTestId("comment-delete-c21")).toBeTruthy();
  });

  it("a text-drag comment is UNCHANGED: self-contained bubble, no shared quick-box", async () => {
    const textComment: Annotation = { ...textMark("c22"), type: "comment", body: "" };
    useAnnotationStore.getState().addAnnotation(textComment);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("c22"));

    await screen.findByTestId("comment-bubble-c22");
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
    expect(screen.getByTestId("comment-delete-c22")).toBeTruthy();
  });

  it("hovering a NON-selected box comment shows the preview positioned beside it", async () => {
    useAnnotationStore.getState().addAnnotation(boxCommentMark("c23", "note"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().setHovered("c23"));

    const preview = await screen.findByTestId("comment-preview-c23");
    expect(preview.style.left).toBe("306px");
    expect(preview.style.top).toBe("160px");
  });

  it("hovering a NON-selected pin comment is UNCHANGED: preview positioned below the pin", async () => {
    const pin: Annotation = {
      id: "c24",
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.1, y1: 0.2 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: "",
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
    useAnnotationStore.getState().addAnnotation(pin);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().setHovered("c24"));

    const preview = await screen.findByTestId("comment-preview-c24");
    // Unshifted: left/top at the pin's own point (60, 160), pin-offset transform applied.
    expect(preview.style.left).toBe("60px");
    expect(preview.style.top).toBe("160px");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run --run AnnotationInteraction.test.tsx`
Expected: FAIL — the box comment's quick-box is not vertical, its bubble is missing/mispositioned (still has internal chrome and the old pin-offset position), and `quick-box-delete`/`color-swatch-annotation-blue` don't exist for it yet (today's `showSelectionBox` still gates comments off entirely).

- [ ] **Step 3: Implement — `useSelection.ts`**

The file currently imports:

```ts
import { clampToViewport } from "@/annotations/position";
import { quickBoxSpec, type QuickBoxSpec } from "@/annotations/marks";
```

and declares:

```ts
/** Vertical gap (viewport px) between the marked text and the floating quick-box
 *  anchored below it, so the box clears the run instead of covering it. */
const QUICK_BOX_GAP = 6;
```

Change the imports to:

```ts
import { clampToViewport, QUICK_BOX_GAP } from "@/annotations/position";
import { quickBoxSpec, usesLeftVerticalQuickBox, type QuickBoxSpec } from "@/annotations/marks";
```

and delete the `const QUICK_BOX_GAP = 6;` declaration entirely (it now comes from the import).

The file currently has:

```ts
  // A memo owns its own focus (its textarea autofocuses for typing), so the box must
  // not steal focus to the first swatch on open — the focus effect checks this.
  const isMemoSelected = selectedAnno?.anchor.kind === "rect" && selectedAnno.type === "memo";
```

Change it to:

```ts
  // A memo or a box comment (fix request) owns its OWN focus (its textarea/compact
  // bubble autofocuses for typing), so the box must not steal focus to the first
  // swatch on open — the focus effect checks this.
  const isVerticalQuickBox = usesLeftVerticalQuickBox(selectedAnno);
```

The file currently has (in `repositionBox`):

```ts
    // A memo's box sits to the LEFT of the mark, so shift by the box's own
    // (measured) width + gap; every other kind anchors below and needs no shift.
    const shiftedX = isMemoSelected ? x - rect.width - QUICK_BOX_GAP : x;
```

Change it to:

```ts
    // A memo or a box comment's quick-box sits to the LEFT of the mark, so shift
    // by the box's own (measured) width + gap; every other kind anchors below and
    // needs no shift.
    const shiftedX = isVerticalQuickBox ? x - rect.width - QUICK_BOX_GAP : x;
```

Two lines further down, the file currently has:

```ts
  }, [isMemoSelected, selectionPoint]);
```

Change it to:

```ts
  }, [isVerticalQuickBox, selectionPoint]);
```

Further down, in the focus-management effect, the file currently has:

```ts
      if (!restoreSelectionFocusRef.current && !isMemoSelected) {
        // First open: remember where focus was, move it into the box. EXCEPTION: a
        // memo owns its focus (its textarea is autofocused for typing) — pulling
        // focus to the first swatch would fight that, so the memo box never grabs
        // focus on open. The textarea is the keyboard entry point; the swatches stay
        // reachable by Tab.
```

Change it to:

```ts
      if (!restoreSelectionFocusRef.current && !isVerticalQuickBox) {
        // First open: remember where focus was, move it into the box. EXCEPTION: a
        // memo or a box comment owns its own focus (its textarea is autofocused for
        // typing) — pulling focus to the first swatch would fight that, so their
        // quick-box never grabs focus on open. The textarea is the keyboard entry
        // point; the swatches stay reachable by Tab.
```

- [ ] **Step 4: Implement — `AnnotationInteraction.tsx`**

The file's imports currently include:

```tsx
import { inActiveGroup, commentGroupIds } from "./markGeometry";
```

Add two new import lines right after it:

```tsx
import { isBoxComment, usesLeftVerticalQuickBox } from "./marks";
import { rightOf } from "./position";
```

The file currently derives:

```tsx
  const selectedComment = selectedAnno?.type === "comment" ? selectedAnno : null;
```

immediately followed (a few lines later, after `commentDragAnchor`/`commentScreenPoint`) by:

```tsx
  const selectedCommentPoint = selectedComment ? commentScreenPoint(selectedComment) : null;
```

Change the `selectedCommentPoint` line to:

```tsx
  const selectedCommentCompact = selectedComment ? isBoxComment(selectedComment) : false;
  const selectedCommentRawPoint = selectedComment ? commentScreenPoint(selectedComment) : null;
  const selectedCommentPoint =
    selectedCommentRawPoint && selectedCommentCompact ? rightOf(selectedCommentRawPoint) : selectedCommentRawPoint;
```

(`selectedComment` itself is unchanged.)

The file currently has, for the shared quick-box's class:

```tsx
          className={selectedAnno.type === "memo" ? "quick-box quick-box--vertical" : "quick-box"}
```

Change it to:

```tsx
          className={usesLeftVerticalQuickBox(selectedAnno) ? "quick-box quick-box--vertical" : "quick-box"}
```

The file currently renders the selected comment's bubble as:

```tsx
      {selectedComment && selectedCommentPoint && (
        <CommentBubble
          key={selectedComment.id}
          anno={selectedComment}
          pos={selectedCommentPoint}
          onRetext={(_id, body) =>
            retextAnnotations(commentGroupIds(selectedComment, annotations), body, new Date().toISOString())
          }
          onRecolor={(color) => {
            recolorAnnotation(commentGroupIds(selectedComment, annotations), color, new Date().toISOString());
            setActiveColor("comment", color);
          }}
          onConvertToHighlight={() =>
            retypeAnnotation(commentGroupIds(selectedComment, annotations), "highlight", null, new Date().toISOString())
          }
          onDelete={() => deleteAnnotation(selectedComment.id)}
          onClearSelection={clearSelection}
          onTextFocus={startCommentTextEditSession}
          onTextBlur={commitCommentTextEditSession}
          onResize={(size) => resizeCommentAnnotation(selectedComment.id, size, new Date().toISOString())}
        />
      )}
```

Add `compact={selectedCommentCompact}` to it (one new prop line, everything else unchanged):

```tsx
      {selectedComment && selectedCommentPoint && (
        <CommentBubble
          key={selectedComment.id}
          anno={selectedComment}
          pos={selectedCommentPoint}
          compact={selectedCommentCompact}
          onRetext={(_id, body) =>
            retextAnnotations(commentGroupIds(selectedComment, annotations), body, new Date().toISOString())
          }
          onRecolor={(color) => {
            recolorAnnotation(commentGroupIds(selectedComment, annotations), color, new Date().toISOString());
            setActiveColor("comment", color);
          }}
          onConvertToHighlight={() =>
            retypeAnnotation(commentGroupIds(selectedComment, annotations), "highlight", null, new Date().toISOString())
          }
          onDelete={() => deleteAnnotation(selectedComment.id)}
          onClearSelection={clearSelection}
          onTextFocus={startCommentTextEditSession}
          onTextBlur={commitCommentTextEditSession}
          onResize={(size) => resizeCommentAnnotation(selectedComment.id, size, new Date().toISOString())}
        />
      )}
```

Finally, the hover-preview map currently reads:

```tsx
      {commentPreviewMarks.map((a) => {
        const pos = commentScreenPoint(a);
        if (!pos) return null;
        return (
          <CommentPreview
            key={a.id}
            anno={a}
            pos={pos}
            hovered={inActiveGroup(a, hoveredId, annotations)}
            onRetext={(_id, body) =>
              retextAnnotations(commentGroupIds(a, annotations), body, new Date().toISOString())
            }
            onHoverEnter={() => setHovered(a.id)}
            onHoverLeave={() => setHovered(null)}
            onTextFocus={startCommentTextEditSession}
            onTextBlur={commitCommentTextEditSession}
          />
        );
      })}
```

Change it to:

```tsx
      {commentPreviewMarks.map((a) => {
        const raw = commentScreenPoint(a);
        if (!raw) return null;
        const compact = isBoxComment(a);
        const pos = compact ? rightOf(raw) : raw;
        return (
          <CommentPreview
            key={a.id}
            anno={a}
            pos={pos}
            compact={compact}
            hovered={inActiveGroup(a, hoveredId, annotations)}
            onRetext={(_id, body) =>
              retextAnnotations(commentGroupIds(a, annotations), body, new Date().toISOString())
            }
            onHoverEnter={() => setHovered(a.id)}
            onHoverLeave={() => setHovered(null)}
            onTextFocus={startCommentTextEditSession}
            onTextBlur={commitCommentTextEditSession}
          />
        );
      })}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run --run AnnotationInteraction.test.tsx`
Expected: PASS, all cases (old + new 5 tests).

- [ ] **Step 6: Run the FULL frontend suite (regression gate)**

Run: `cd client && npm test -- --run`
Expected: all test files pass (this repo is at 69 files / 1435+ tests before this plan; every file should still be green — the memo vertical-quick-box test, the Story 3.7 convert tests, and every other `selection-quick-box`/`comment-bubble`/`comment-preview` test in the suite must be unaffected).

- [ ] **Step 7: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/annotations/gestures/useSelection.ts client/src/annotations/AnnotationInteraction.tsx client/src/annotations/AnnotationInteraction.test.tsx
git commit -m "Wire box comment popup layout end-to-end (beside the highlight, left action strip)"
```

---

### Task 6: Docs + version bump

**Files:**
- Modify: `client/src/annotations/README.md`
- Modify: `server/pyproject.toml`
- Modify: `server/uv.lock`

**Interfaces:**
- Consumes: nothing (documentation/version only).
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Update the annotations README**

In `client/src/annotations/README.md`, find the bullet added by the previous story (Story 8.6), which reads:

```markdown
- **Story 8.6 (preview size fix):** `CommentPreview` (the HOVER-triggered compact
  twin of `CommentBubble`, shown while a comment is not selected) reads the same
  persisted `style.bubble_width`/`bubble_height` the full bubble already
  reads+writes via its corner-handle resize, so the collapsed preview renders at
  the SAME adjusted size as the full bubble instead of snapping back to the
  220px default. A comment that was never resized (both fields null) still shows
  the compact default preview, unchanged.
```

Add a new bullet immediately after it, in the same list (still inside the "Story 2.10 — comment" section):

```markdown
- **Box comment popup layout (fix request):** a BOX comment (`isBoxComment` in
  `marks.ts` — a `type=comment` mark whose live anchor is `kind=rect` with REAL
  area, i.e. drawn via the Comment tool's Box mode, Story 8.4) no longer
  overlaps its own highlighted region. Its color-swatch + delete chrome moves
  into the shared selection quick-box's LEFT-side vertical strip (the same
  layout `MemoBox`'s own quick-box already uses, `usesLeftVerticalQuickBox` in
  `marks.ts`), and `CommentBubble`/`CommentPreview` render in `compact` mode:
  just a textarea (+ resize handle for the full bubble), positioned to the
  RIGHT of the highlight (`position.ts`'s `rightOf`) instead of below the pin.
  A click-placed pin comment or a text-drag comment is unaffected — both keep
  today's self-contained bubble below the pin.
```

- [ ] **Step 2: Bump the version**

In `server/pyproject.toml`, find:

```toml
version = "0.5.20"
```

Change it to:

```toml
version = "0.5.21"
```

- [ ] **Step 3: Re-sync `uv.lock`**

Run: `cd server && export UV_CACHE_DIR=/tmp/uv-cache && PYTHONPATH= uv lock`
Expected output includes: `Updated paper-mate-server v0.5.20 -> v0.5.21`

- [ ] **Step 4: Commit**

```bash
git add client/src/annotations/README.md server/pyproject.toml server/uv.lock
git commit -m "Document box comment popup layout fix, bump version to 0.5.21"
```

---

### Task 7: Live smoke at DPR>1 (manual, not automated)

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start your OWN fresh dev servers, never a user-launched one**

```bash
mkdir -p /tmp/box-comment-smoke-data
cd server && PAPER_MATE_DATA=/tmp/box-comment-smoke-data PYTHONPATH= uv run uvicorn app.main:app --port 8123 &
cd client && PAPER_MATE_API_TARGET=http://localhost:8123 npm run dev -- --port 5183 &
```

Wait for `curl -s http://localhost:8123/api/health` to return `{"status":"ok",...}` before opening the browser.

- [ ] **Step 2: Emulate DPR>1 and load a real multi-page PDF**

Open `http://localhost:5183` at a `deviceScaleFactor` of 2 (e.g. viewport `1400x900x2`), upload any multi-page paper from `fixtures/sample-pdfs/`, open it in the reader.

- [ ] **Step 3: Draw a box comment and verify the new layout**

Arm the Comment tool's Box mode, drag a rectangle over some page content near the page's vertical middle (not near an edge yet). Confirm:
- A vertical strip (color swatches + a hairline divider + a delete icon) appears immediately to the LEFT of the drawn box, top-aligned to it.
- A compact textarea (no color row, no delete button inside it) appears immediately to the RIGHT of the drawn box, top-aligned to it, with a corner resize handle.
- Neither piece overlaps the highlighted box.
- Typing in the textarea works; recoloring from the left strip changes the highlight's tint; dragging the compact box's corner handle resizes it; clicking the left strip's delete icon removes the comment.

- [ ] **Step 4: Verify a plain pin/text comment is unaffected**

Click an empty area with the Comment tool (plain click, not Box mode) to drop a pin comment; separately, drag over some text with the Comment tool armed to make a text-drag comment. For both: confirm the popup still opens directly BELOW the pin with the full color row + delete + convert (where applicable) INSIDE it, exactly as before this change.

- [ ] **Step 5: Verify the hover preview for a box comment**

Deselect the box comment from Step 3, then hover its highlighted region (or its pin, if one is visible at its corner). Confirm the compact hover preview also appears beside the box (same side as the selected editor), not overlapping it.

- [ ] **Step 6: Verify near a viewport edge**

Draw a second box comment near the RIGHT edge of the viewport. Confirm the existing clamp-to-viewport logic nudges the compact textarea back on-screen (it's acceptable, per the design spec, if it ends up closer to/overlapping the box in this extreme case — this mirrors `MemoBox`'s own existing clamp-only behavior and is not a regression).

- [ ] **Step 7: Shut down your dev servers**

```bash
kill %1 %2 2>/dev/null
```

(Or find and kill the `uvicorn`/`vite` PIDs directly if job control isn't available in your shell.)

## Self-Review Notes

- **Spec coverage:** every "Architecture" numbered item in the design spec maps to a task above (marks.ts -> Task 2, position.ts -> Task 1, useSelection.ts -> Task 5, AnnotationInteraction.tsx -> Task 5, CommentBubble/CommentPreview -> Tasks 3-4, Annotations.css -> no task, per the spec's own "no new classes needed"). Every "Testing" bullet in the spec has a corresponding test in Tasks 1-5 plus the live smoke in Task 7.
- **Type consistency:** `compact` is `boolean` with a `false` default in both `CommentBubble` and `CommentPreview` (Tasks 3-4); `isBoxComment(anno: Annotation): boolean` and `usesLeftVerticalQuickBox(anno: Annotation | null): boolean` (Task 2) are used with those exact signatures in Task 5's edits to `useSelection.ts` (passed `selectedAnno`, typed `Annotation | null`) and `AnnotationInteraction.tsx` (passed `selectedAnno` for the class, `a`/`selectedComment` — both `Annotation` — for `isBoxComment`). `rightOf(rect: ScreenRect, gap?: number): ScreenRect` (Task 1) is called with one arg (default gap) everywhere it's used in Task 5, and its `ScreenRect` return is assigned directly to `pos`/`selectedCommentPoint` (both typed `ScreenRect`) with no shape mismatch.
- **No placeholders:** every step above shows the complete before/after code, not a description of what to change.
