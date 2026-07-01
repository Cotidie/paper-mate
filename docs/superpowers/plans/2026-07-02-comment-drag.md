# Movable Comment Box And Pinned Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reader drag the comment popup out of the way (temporary, resets when the box reopens) and drag a comment pinned in empty space to a new spot (persisted, undoable, autosaved). A comment anchored on highlighted text stays immovable.

**Architecture:** Two independent changes reusing existing infrastructure. The box drag is pure local UI state in `CommentBubble` — no store involvement, "resets on reopen" is free because the component already unmounts on deselect. The pin drag reuses the existing move-handle gesture (`useEditGesture`) that already drags memo/pen/region marks — the pin `<button>` is conditionally tagged with the same `data-edit-handle`/`data-edit-id` attributes the edit-frame's move grip uses, gated to `anchor.kind === "rect"` only.

**Tech Stack:** React 19.2 + TypeScript, Zustand 5.0.x store (`useAnnotationStore`), Vitest + Testing Library.

## Global Constraints

- Reference design tokens, never raw hex/px — any new CSS values must be `var(--...)` (spec: `DESIGN.md` token contract). The only new CSS in this plan is `cursor` keywords (`grab`/`grabbing`/`text`), which are not tokenized values, so this doesn't add any raw hex/px.
- No em-dash (—) in user-facing text (tooltips/labels/aria-labels/copy). This plan adds no new user-facing strings (no new labels/tooltips), so nothing to check there — but if a step is later amended to add one, grep for `—` first.
- `client/src/annotations/gestures/shared.ts`'s `isExempt` already treats `BUTTON` as exempt from the document-level create/deselect handlers, so the pin (a `<button>`) needs no changes there.
- Pointer-drag handlers in this plan use native **pointer capture** on the dragged element itself (Task 3) or reuse the existing document-level gesture (Task 2), not new ad-hoc document listeners — pointer capture is the idiomatic solution for a single-element drag and gives the same "doesn't get lost when the pointer leaves the element" guarantee the codebase's document-level convention exists for.
- No `render/index.ts` export changes in this plan, so the `render/` test-mock-sync rule (App.test.tsx / Reader.test.tsx barrels) does not apply.
- Versioning: this is a standalone fix (no BMad story), so PATCH bumps once, at the end (Task 4), per `CLAUDE.md`'s versioning rule. Current baseline is `0.2.9` (`server/pyproject.toml:3`) → bump to `0.2.10`.

---

### Task 1: `useEditGesture` click-vs-drag slop

**Files:**
- Modify: `client/src/annotations/gestures/useEditGesture.ts:33-35` (add constant), `:100-113` (`onMove`)
- Test: `client/src/annotations/gestures/useEditGesture.test.ts`

**Interfaces:**
- Consumes: nothing new — `useEditGesture(opts: { enabled: boolean; getPagesRef: RefObject<() => PageCardRef[]>; scaleRef: RefObject<number> })` is unchanged.
- Produces: the SAME public behavior as today (`dragPreview` store field, `setAnnotationGeometry` commit on release) for every existing handle (`move`/`nw`/`ne`/`sw`/`se`), just gated by a slop threshold before the first preview/commit. Task 2 depends on this: it makes the comment pin safe to use as a dual-purpose (click-or-drag) handle.

**Why:** Today, `useEditGesture`'s `onMove` sets `d.moved = true` on ANY nonzero pointer delta and commits a geometry write on release if so. This is harmless today because the existing move/resize grips are drag-only controls (reachable only after the mark is already selected, no competing click meaning). Task 2 turns the comment pin itself into a handle that is ALSO a plain click target (`onClick={() => select(a.id)}`), so ordinary hand-tremor during a click would otherwise commit a spurious near-zero geometry mutation (an undo-step + autosave write) on every simple pin click.

- [ ] **Step 1: Write the two failing tests**

Add to `client/src/annotations/gestures/useEditGesture.test.ts`, inside the existing `describe("useEditGesture (move/resize drag, Story 3.1)", ...)` block (after the `"a press with no drag commits nothing (no updated_at bump)"` test, i.e. right before its closing `});` at line 134):

```typescript
  it("a sub-slop press-and-jiggle commits nothing (click-vs-drag slop, matches COMMENT_CLICK_SLOP)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("move", "m"), 100, 100);
    move(102, 101); // dist ≈ 2.24px, below the 5px slop
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.updated_at).toBe("2026-06-30T00:00:00Z");
  });

  it("a past-slop drag measures the delta from the ORIGINAL down-point (no jump at the slop threshold)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("move", "m"), 100, 100);
    move(103, 100); // dist = 3px, still below slop — no preview yet
    move(350, 100); // now well past slop; dx must be measured from x=100, not x=103
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") {
      // dx = (350-100)/1000 = 0.25 — same delta as the plain move test above,
      // proving the intermediate sub-slop sample never became the new origin.
      expect(m.anchor.rect).toEqual({ x0: 0.5, y0: 0.25, x1: 0.75, y1: 0.5 });
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/annotations/gestures/useEditGesture.test.ts`
Expected: FAIL — the first new test fails because `dragPreview` is non-null and `updated_at` got bumped (no slop exists yet); the second may pass or fail depending on float luck, but must fail once the first assertion above (`toBeNull()`) is exercised by a shared regression, so at minimum the first new test FAILs.

- [ ] **Step 3: Add the slop constant and gate `onMove`**

In `client/src/annotations/gestures/useEditGesture.ts`, near the existing `MIN_PEN_SCALE` constant (line 35), add:

```typescript
/** Client-pixel distance from the pointerdown origin before a handle drag counts
 *  as "moved" (vs. a plain click). Mirrors the existing COMMENT_CLICK_SLOP
 *  convention (AnnotationInteraction.tsx) — needed here because the comment pin
 *  (Task 2) is a dual-purpose handle: click selects, drag moves. Without this,
 *  hand-tremor during a plain click would commit a spurious geometry write. */
const HANDLE_MOVE_SLOP = 5;
```

Replace the `onMove` function (originally):

```typescript
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = d.box.width * d.scale;
      const h = d.box.height * d.scale;
      const dx = w > 0 ? (e.clientX - d.startX) / w : 0;
      const dy = h > 0 ? (e.clientY - d.startY) / h : 0;
      if (dx !== 0 || dy !== 0) d.moved = true;
      const next = computeAnchor(d, dx, dy);
      if (!next) return;
      d.lastAnchor = next;
      setDragPreview({ id: d.id, anchor: next });
      e.preventDefault();
    };
```

with:

```typescript
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved) {
        const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
        if (dist < HANDLE_MOVE_SLOP) return; // still within slop: let a plain click fire on release
        d.moved = true;
      }
      const w = d.box.width * d.scale;
      const h = d.box.height * d.scale;
      const dx = w > 0 ? (e.clientX - d.startX) / w : 0;
      const dy = h > 0 ? (e.clientY - d.startY) / h : 0;
      const next = computeAnchor(d, dx, dy);
      if (!next) return;
      d.lastAnchor = next;
      setDragPreview({ id: d.id, anchor: next });
      e.preventDefault();
    };
```

- [ ] **Step 4: Run the full gesture test file to verify everything passes**

Run: `cd client && npx vitest run src/annotations/gestures/useEditGesture.test.ts`
Expected: PASS (all tests, including the 6 pre-existing ones — the slop is far below any of their drag distances of 125px+, so none of them change behavior).

- [ ] **Step 5: Commit**

```bash
git add client/src/annotations/gestures/useEditGesture.ts client/src/annotations/gestures/useEditGesture.test.ts
git commit -m "Fix: Add click-vs-drag slop to the move/resize handle gesture"
```

---

### Task 2: Draggable pin for a comment pinned in empty space

**Files:**
- Modify: `client/src/annotations/AnnotationLayer.tsx:361-418` (`renderComment`)
- Modify: `client/src/annotations/Annotations.css` (add `.annotation-comment-pin--movable`, after the `.annotation-comment-pin:focus-visible` block currently at lines 569-572)
- Test: `client/src/annotations/AnnotationLayer.test.tsx`

**Interfaces:**
- Consumes: Task 1's slop-gated `useEditGesture` (already mounted app-wide by `AnnotationInteraction`, unchanged call site) — this task only changes what attributes the pin carries, not how the gesture is wired up.
- Produces: a comment pin (`data-testid="annotation-comment-pin-{id}"`) that carries `data-edit-handle="move"` + `data-edit-id={id}` and the CSS class `annotation-comment-pin--movable` **only** when its live anchor is `kind: "rect"`. A `kind: "text"` pin gets neither — unchanged from today.

**Why:** `AnnotationLayer` already has everything a movable mark needs (`effAnchor`, `setDragPreview`/`setAnnotationGeometry` via the shared `useEditGesture` hook mounted once by `AnnotationInteraction`). The comment pin just needs to opt into being a recognized handle.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/annotations/AnnotationLayer.test.tsx`, inside the existing `describe("AnnotationLayer comment (Story 2.10 — AC1,2,4,6)", ...)` block (after the `"a non-selected comment renders no bubble..."` test):

```typescript
  it("a kind=rect comment's pin is tagged as a move handle (pinned in empty space is draggable)", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c7"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const pin = screen.getByTestId("annotation-comment-pin-c7");
    expect(pin.getAttribute("data-edit-handle")).toBe("move");
    expect(pin.getAttribute("data-edit-id")).toBe("c7");
    expect(pin.className).toContain("annotation-comment-pin--movable");
  });

  it("a kind=text comment's pin is NOT a move handle (anchored on text stays immovable)", () => {
    useAnnotationStore.getState().addAnnotation(textComment("c8"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const pin = screen.getByTestId("annotation-comment-pin-c8");
    expect(pin.getAttribute("data-edit-handle")).toBeNull();
    expect(pin.getAttribute("data-edit-id")).toBeNull();
    expect(pin.className).not.toContain("annotation-comment-pin--movable");
  });

  it("a rect-kind pin (and its open bubble) live-track an in-flight drag preview", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c9"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    act(() => useAnnotationStore.getState().select("c9"));
    // Committed anchor: x0=0.2,y0=0.3 → left=120, top=240 (box 600x800, scale 1).
    expect(screen.getByTestId("annotation-comment-pin-c9").style.left).toBe("120px");
    act(() =>
      useAnnotationStore.getState().setDragPreview({
        id: "c9",
        anchor: { kind: "rect", page_index: 0, rect: { x0: 0.4, y0: 0.5, x1: 0.4, y1: 0.5 } },
      }),
    );
    // Preview anchor: x0=0.4,y0=0.5 → left=240, top=400 — both the pin AND the
    // open bubble (which hangs off the same `anchor` value) must follow.
    expect(screen.getByTestId("annotation-comment-pin-c9").style.left).toBe("240px");
    expect(screen.getByTestId("comment-bubble-c9").style.left).toBe("240px");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/annotations/AnnotationLayer.test.tsx`
Expected: FAIL — `data-edit-handle`/`data-edit-id`/`--movable` don't exist yet, and the pin still reads `a.anchor` directly so it won't follow `dragPreview`.

- [ ] **Step 3: Update `renderComment`**

In `client/src/annotations/AnnotationLayer.tsx`, replace the `renderComment` function (originally lines 361-418, up to and including its `return (` opening and the button's attribute list) — specifically these two spans:

Replace:

```typescript
  const renderComment = (a: Annotation) => {
    let anchor: ScreenRect | null = null;
    if (a.anchor.kind === "text") {
      if (a.anchor.rects.length === 0) return null;
      anchor = denormalizeRect(a.anchor.rects[0], box, scale);
    } else if (a.anchor.kind === "rect") {
      anchor = denormalizeRect(a.anchor.rect, box, scale);
    }
    if (!anchor) return null;
    const { hovered, selected, flashed } = markState(a);
    const cls = markClass("annotation-comment-pin", "annotation-comment-pin", hovered, selected, flashed);
    return (
      <div key={a.id} className="annotation-comment" data-comment-id={a.id}>
        <button
          type="button"
          className={cls}
          data-testid={`annotation-comment-pin-${a.id}`}
          aria-label="Comment"
          style={{ left: anchor.left, top: anchor.top }}
          onPointerEnter={() => setHovered(a.id)}
          onPointerLeave={() => setHovered(null)}
          onClick={() => select(a.id)}
        >
```

with:

```typescript
  const renderComment = (a: Annotation) => {
    // effAnchor (not a.anchor): a rect-kind pin is a live move-handle (below), so
    // it must track an in-flight drag preview like every other movable mark.
    const liveAnchor = effAnchor(a);
    let anchor: ScreenRect | null = null;
    if (liveAnchor.kind === "text") {
      if (liveAnchor.rects.length === 0) return null;
      anchor = denormalizeRect(liveAnchor.rects[0], box, scale);
    } else if (liveAnchor.kind === "rect") {
      anchor = denormalizeRect(liveAnchor.rect, box, scale);
    }
    if (!anchor) return null;
    const { hovered, selected, flashed } = markState(a);
    // A comment pinned in empty space (kind=rect) is directly draggable: it
    // carries the SAME data-edit-handle/data-edit-id pair the edit-frame's move
    // grip uses, so useEditGesture (Task 1) drives it unchanged — click still
    // selects (native click fires below slop), drag moves and persists. A
    // comment anchored on highlighted TEXT stays immovable (its position is
    // derived from the text run, Story 3.8 territory).
    const movable = liveAnchor.kind === "rect";
    const cls = markClass(
      "annotation-comment-pin" + (movable ? " annotation-comment-pin--movable" : ""),
      "annotation-comment-pin",
      hovered,
      selected,
      flashed,
    );
    return (
      <div key={a.id} className="annotation-comment" data-comment-id={a.id}>
        <button
          type="button"
          className={cls}
          data-testid={`annotation-comment-pin-${a.id}`}
          aria-label="Comment"
          style={{ left: anchor.left, top: anchor.top }}
          {...(movable ? { "data-edit-handle": "move", "data-edit-id": a.id } : {})}
          onPointerEnter={() => setHovered(a.id)}
          onPointerLeave={() => setHovered(null)}
          onClick={() => select(a.id)}
        >
```

(The rest of `renderComment` — the icon stack and the `CommentBubble` block — is unchanged; it already closes over the same `anchor` variable, so the bubble automatically follows the live drag preview too.)

- [ ] **Step 4: Add the CSS cursor affordance**

In `client/src/annotations/Annotations.css`, after the existing block:

```css
.annotation-comment-pin:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-ink);
  outline-offset: var(--color-swatch-ring-offset);
}
```

add:

```css
.annotation-comment-pin--movable {
  cursor: grab;
}

.annotation-comment-pin--movable:active {
  cursor: grabbing;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/annotations/AnnotationLayer.test.tsx`
Expected: PASS (all tests, including the pre-existing `"shows NO edit frame for a selected comment pin (bubble-edited)"` — that test checks the separate `edit-handle-move-{id}` test id from the edit-*frame*, which this task never touches).

- [ ] **Step 6: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors (the spread of a literal `{ "data-edit-handle": "move", "data-edit-id": a.id }` object onto a `<button>` is valid — arbitrary `data-*` attributes are permitted on any JSX intrinsic element).

- [ ] **Step 7: Commit**

```bash
git add client/src/annotations/AnnotationLayer.tsx client/src/annotations/AnnotationLayer.test.tsx client/src/annotations/Annotations.css
git commit -m "Feat: Make a comment pinned in empty space draggable"
```

---

### Task 3: Draggable comment box (temporary reposition)

**Files:**
- Modify: `client/src/annotations/CommentBubble.tsx` (imports, new state, JSX handlers)
- Modify: `client/src/annotations/Annotations.css` (`.comment-bubble` cursor, `.comment-bubble__text` cursor)
- Create: `client/src/annotations/CommentBubble.test.tsx`

**Interfaces:**
- Consumes: nothing new — `CommentBubble`'s existing prop signature (`anno`, `pos`, `onRetext`, `onRecolor`, `onConvertToHighlight`, `onDelete`, `onClearSelection`, `onTextFocus?`, `onTextBlur?`) is unchanged. No caller (`AnnotationLayer.tsx`) needs edits for this task.
- Produces: purely visual — the bubble's own rendered `transform` offset. Nothing new is exposed to callers.

**Why:** The reader wants to drag the comment popup out of the way when it overlaps page content. The reposition must be temporary (reset when the box is closed and reopened) — which the existing mount-per-selection lifecycle already gives for free if the offset lives in local component state.

- [ ] **Step 1: Write the failing tests**

Create `client/src/annotations/CommentBubble.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CommentBubble from "./CommentBubble";
import type { Annotation } from "../api/client";
import type { ScreenRect } from "../anchor";

function comment(id: string, body = ""): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "comment",
    group_id: null,
    anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.3, x1: 0.2, y1: 0.3 } },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body,
    created_at: "2026-06-29T00:00:00+00:00",
    updated_at: "2026-06-29T00:00:00+00:00",
  };
}

const pos: ScreenRect = { left: 100, top: 100, width: 0, height: 0 };
function noop() {}

function renderBubble(id: string) {
  return render(
    <CommentBubble
      anno={comment(id)}
      pos={pos}
      onRetext={noop}
      onRecolor={noop}
      onConvertToHighlight={noop}
      onDelete={noop}
      onClearSelection={noop}
    />,
  );
}

describe("CommentBubble drag (movable comment box)", () => {
  it("dragging the bubble's own empty padding offsets it via transform", () => {
    renderBubble("c1");
    const bubble = screen.getByTestId("comment-bubble-c1");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(bubble.style.transform).toBe("translate(30px, 15px)");
  });

  it("dragging from the textarea does NOT move the bubble (only empty padding drags)", () => {
    renderBubble("c2");
    const bubble = screen.getByTestId("comment-bubble-c2");
    const textarea = screen.getByTestId("comment-body-c2");
    fireEvent.pointerDown(textarea, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(bubble.style.transform).toBe("translate(0px, 0px)");
  });

  it("a fresh mount always starts at zero offset (temporary — resets when the box reopens)", () => {
    const { unmount } = renderBubble("c3");
    const bubble = screen.getByTestId("comment-bubble-c3");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 260, clientY: 260 });
    fireEvent.pointerUp(bubble, { clientX: 260, clientY: 260 });
    expect(bubble.style.transform).toBe("translate(60px, 60px)");
    unmount();
    renderBubble("c3");
    expect(screen.getByTestId("comment-bubble-c3").style.transform).toBe("translate(0px, 0px)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/annotations/CommentBubble.test.tsx`
Expected: FAIL — `bubble.style.transform` is currently always `""` (no drag handlers exist yet).

- [ ] **Step 3: Add drag state and handlers to `CommentBubble.tsx`**

Change the import line (originally):

```tsx
import { useEffect, useLayoutEffect, useRef } from "react";
```

to:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
```

Add, right after the existing `const boxRef = useRef<HTMLDivElement | null>(null);` line:

```tsx
  // Manual reposition (temporary): a local offset added on top of the anchored
  // `pos`. Resets to {0,0} on every mount — which happens each time the bubble
  // opens (AnnotationLayer only mounts it while selected) — so closing and
  // reopening the box always shows it back at the default position.
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const boxDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
```

Replace the returned `<div>`'s opening tag (originally):

```tsx
    <div
      ref={boxRef}
      className="comment-bubble"
      data-testid={`comment-bubble-${anno.id}`}
      style={{ left: pos.left, top: pos.top }}
      // Esc dismisses from ANY control in the bubble, not just the textarea
      // (Codex MED): the swatch/delete buttons are exempt from the document-level
      // selection keys, so Esc on them would otherwise do nothing. Handling it on
      // the container catches every focused child.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur?.();
          onClearSelection();
        }
      }}
    >
```

with:

```tsx
    <div
      ref={boxRef}
      className="comment-bubble"
      data-testid={`comment-bubble-${anno.id}`}
      style={{ left: pos.left, top: pos.top, transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      // Drag-to-reposition: only the bubble's OWN empty padding starts a drag —
      // the target check excludes the textarea and the swatch/convert/delete
      // controls beneath it, which keep their normal click/focus behavior.
      onPointerDown={(e) => {
        if (e.target !== boxRef.current || e.button !== 0) return;
        boxDragRef.current = { startX: e.clientX, startY: e.clientY, originX: dragOffset.x, originY: dragOffset.y };
        try {
          boxRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* capture refused (e.g. a synthetic test event) — the handlers below still fire on this element */
        }
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = boxDragRef.current;
        if (!d) return;
        setDragOffset({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) });
      }}
      onPointerUp={() => {
        boxDragRef.current = null;
      }}
      onPointerCancel={() => {
        boxDragRef.current = null;
      }}
      // Esc dismisses from ANY control in the bubble, not just the textarea
      // (Codex MED): the swatch/delete buttons are exempt from the document-level
      // selection keys, so Esc on them would otherwise do nothing. Handling it on
      // the container catches every focused child.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur?.();
          onClearSelection();
        }
      }}
    >
```

- [ ] **Step 4: Add the CSS cursor affordance**

In `client/src/annotations/Annotations.css`, in the existing `.comment-bubble { ... }` block, add a `cursor: grab;` declaration, and add a new rule right after it:

```css
.comment-bubble {
  position: absolute;
  transform: translateY(calc(var(--comment-pin-size) + var(--space-xxs)));
  display: flex;
  flex-direction: column;
  gap: var(--space-xxs);
  width: var(--comment-bubble-width);
  padding: var(--space-sm);
  background-color: var(--color-surface-card);
  border: var(--hairline-width) solid var(--color-hairline-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  pointer-events: auto;
  z-index: 50;
  cursor: grab;
}

.comment-bubble:active {
  cursor: grabbing;
}
```

In the existing `.comment-bubble__text { ... }` block, add `cursor: text;` so the drag affordance doesn't bleed onto the textarea:

```css
.comment-bubble__text {
  width: 100%;
  box-sizing: border-box;
  min-height: var(--comment-bubble-text-min-height);
  margin: 0;
  padding: var(--annotation-memo-padding);
  border: var(--hairline-width) solid var(--color-hairline);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-card);
  color: var(--color-ink);
  font-family: inherit;
  font-size: var(--type-body-sm-size);
  resize: none;
  overflow: hidden;
  cursor: text;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/annotations/CommentBubble.test.tsx`
Expected: PASS (all 3 tests).

- [ ] **Step 6: Run the full annotations test suite to check for regressions**

Run: `cd client && npx vitest run src/annotations`
Expected: PASS (no existing `CommentBubble`/`AnnotationLayer` test asserts a specific `transform` value on the bubble, so the added inline `transform` style is additive-only).

- [ ] **Step 7: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/annotations/CommentBubble.tsx client/src/annotations/CommentBubble.test.tsx client/src/annotations/Annotations.css
git commit -m "Feat: Make the comment box draggable (temporary reposition)"
```

---

### Task 4: Live smoke verification and version bump

**Files:**
- Modify: `server/pyproject.toml:3` (version bump)

**Interfaces:**
- Consumes: the fully working feature from Tasks 1-3.
- Produces: nothing new — this task is verification plus the version-convention bump.

**Why:** Per this repo's convention, every pointer/drag feature must be live-smoked in a real browser with your OWN freshly launched dev servers (jsdom has no real layout, and unit tests can't observe cursor feel, undo, or autosave-after-reload). This is also the point in the workflow where the standalone-fix PATCH bump happens (per `CLAUDE.md`'s versioning rule).

- [ ] **Step 1: Launch fresh dev servers**

```bash
cd server && uv run uvicorn app.main:app --reload --port 8010
```

In a second shell:

```bash
cd client && npm run dev -- --port 5183
```

(Using non-default ports so this doesn't collide with any server the user already has running — per this repo's "launch your own dev servers" convention.)

- [ ] **Step 2: Open the app and upload a PDF**

Navigate to `http://localhost:5183`. Upload any multi-page PDF via the walking-skeleton upload flow.

- [ ] **Step 3: Verify the pinned-comment drag (persisted)**

Arm the Comment tool, click empty space on the page (not over text) to drop a pin. Click-drag the pin a noticeable distance. Confirm:
- The pin (and its open bubble, if any) visually follows the drag smoothly.
- Releasing leaves it at the new spot.
- A plain click on a DIFFERENT existing pin (no drag) still just selects it — it must not have shifted position at all (validates the Task 1 slop fix).
- Press Ctrl+Z: the pin returns to its pre-drag position (validates the persisted move went through the normal undo stack).
- Redo the move (Ctrl+Shift+Z or Ctrl+Y), then reload the page (`F5`): the pin is still at its moved position (validates the autosave round-trip).

- [ ] **Step 4: Verify a text-anchored comment pin stays immovable**

Select some page text, arm the Comment tool (or use it while text is selected) to create a `kind=text` comment. Try to click-drag its pin. Confirm it does NOT move (no `grab` cursor, no drag) — only a plain click/select works.

- [ ] **Step 5: Verify the comment box drag (temporary)**

Select any comment (either kind) so its box opens. Click-drag an empty padding area of the box (not the textarea, not the color swatches, not the delete/convert buttons) to a new spot. Confirm:
- The box follows the drag smoothly, `cursor: grab`/`grabbing` shows over the padding.
- Dragging from the textarea or a button does NOT move the box (only edits text / fires the button, as before).
- Deselect the comment (click elsewhere or Esc), then reselect it: the box reopens at its DEFAULT anchored position, not the dragged one.

- [ ] **Step 6: Verify at DPR>1 (HiDPI)**, per this repo's convention for pointer/drag features

If available, repeat steps 3 and 5 in a browser window/OS zoomed so `devicePixelRatio > 1` (or use browser devtools device emulation at 2x). Confirm the drag tracks the pointer 1:1 with no offset drift.

- [ ] **Step 7: Shut down the dev servers**

Stop both processes started in Step 1 (they were launched only for this smoke pass).

- [ ] **Step 8: Bump the PATCH version**

In `server/pyproject.toml:3`, change:

```toml
version = "0.2.9"
```

to:

```toml
version = "0.2.10"
```

- [ ] **Step 9: Run the full test suites one last time**

```bash
cd client && npm run typecheck && npm test
cd ../server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add server/pyproject.toml
git commit -m "Chore: Bump version to 0.2.10 (movable comment box and pins)"
```
