// markGeometry.ts — pure per-mark geometry/state helpers (Story 5.3
// extraction out of AnnotationLayer.tsx). A zero-React-import leaf so every
// helper is independently unit-testable.

import type { Annotation, Rect } from "@/api/client";
import { pointsBounds } from "@/anchor";

/** Is `a` part of the active set named by `activeId`? True when it IS that mark,
 *  or shares a non-null `group_id` with it — so a two-page highlight's sibling on
 *  another page lights together (hover outline + selected ring). */
export function inActiveGroup(a: Annotation, activeId: string | null, all: Map<string, Annotation>): boolean {
  if (!activeId) return false;
  if (a.id === activeId) return true;
  const active = all.get(activeId);
  return active != null && active.group_id != null && active.group_id === a.group_id;
}

/** Build a mark's class string from its base + hover/selected/flash modifiers
 *  (Story 5.0: the one helper for the suffixing that was copy-pasted into all
 *  five render funcs; Story 3.6 adds `flashed`, the Annotation Bank jump's
 *  brief emphasis, following the exact same pattern). `classList` is the full
 *  static class (may carry extra classes like `annotation-region`/`--underline`);
 *  `modifierRoot` is the BEM root the `--hovered`/`--selected`/`--flash` suffixes
 *  attach to (often a prefix of `classList`). */
export function markClass(
  classList: string,
  modifierRoot: string,
  hovered: boolean,
  selected: boolean,
  flashed: boolean,
): string {
  return (
    classList +
    (hovered ? ` ${modifierRoot}--hovered` : "") +
    (selected ? ` ${modifierRoot}--selected` : "") +
    (flashed ? ` ${modifierRoot}--flash` : "")
  );
}

/** Union of two normalized rects (min top-left, max bottom-right). Pure
 *  aggregation for the multi-select group frame's outline. */
export function unionRect(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** A mark's own normalized bounding rect regardless of kind (text -> the union
 *  of its per-line rects; rect -> itself; path -> `pointsBounds`). Used ONLY for
 *  the multi-select group frame's single approximate outline over N marks (user
 *  feature request) — per-kind PAINT geometry elsewhere is unaffected. `null` for
 *  a text mark with no rects (nothing to bound). */
export function markBounds(anchor: Annotation["anchor"]): Rect | null {
  if (anchor.kind === "rect") return anchor.rect;
  if (anchor.kind === "path") return pointsBounds(anchor.points);
  if (anchor.rects.length === 0) return null;
  return anchor.rects.reduce(unionRect);
}
