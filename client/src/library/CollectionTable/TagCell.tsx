import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import TagEditor from "./TagEditor";

/**
 * The settled cell's chip list (fix request): renders every author as a
 * `.tag-chip`, then a `useLayoutEffect` pass - before the browser paints, so
 * there's no visible flash - sums chip widths (+ the flex gap) against the
 * container's own width to find how many chips actually fit on the cell's
 * one visible line, reserving room for a trailing "et al." for every chip
 * but the last. Only that many chips stay in normal flow; the rest get an
 * `--overflow` modifier (`position: absolute; visibility: hidden`) instead
 * of the wrapped-then-clipped layout the cell used to have (the old bug: a
 * sliver of a 2nd-row chip peeking out from under the first).
 *
 * ALL chips stay mounted at all times, just some visually pulled out of flow
 * - `visibleCount` has exactly one writer (this effect); an earlier version
 * that instead un-rendered (`.slice`'d away) the overflow chips needed a
 * SECOND effect to re-render the full set before every re-measure (to see
 * whether more now fit), and that second writer raced this one, sometimes
 * settling on "nothing truncated" instead of converging. Keeping every chip
 * in the DOM means `container.clientWidth`/each chip's `offsetWidth` are
 * always answerable from the current render with no reset step, so a resize
 * (`ResizeObserver`) or an author-list change (a normal prop-driven
 * re-render) both just need to trigger ONE more pass of this same effect,
 * which always recomputes fresh - no separate "go back to full" call.
 */
function AuthorChips({ authors }: { authors: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState(authors.length);
  const [, forceRemeasure] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || authors.length === 0) return;
    const chipEls = Array.from(container.querySelectorAll<HTMLElement>(".tag-chip"));
    if (chipEls.length !== authors.length) return; // authors just changed - wait for this render's full set

    const containerWidth = container.clientWidth;
    const gap = parseFloat(getComputedStyle(container).columnGap || "0") || 0;
    const moreWidth = moreRef.current?.offsetWidth ?? 0;

    let usedWidth = 0;
    let fit = 0;
    for (let i = 0; i < chipEls.length; i++) {
      const chipWidth = chipEls[i].offsetWidth;
      const nextUsedWidth = usedWidth + (fit > 0 ? gap : 0) + chipWidth;
      const isLast = i === chipEls.length - 1;
      const reserve = isLast ? 0 : gap + moreWidth;
      if (fit > 0 && nextUsedWidth + reserve > containerWidth) break;
      usedWidth = nextUsedWidth;
      fit++;
    }
    if (fit !== visibleCount) setVisibleCount(fit);
  });

  useEffect(() => {
    const container = containerRef.current;
    // jsdom (unit tests) doesn't implement ResizeObserver; every evergreen
    // browser does, so this guard only ever skips it under test.
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => forceRemeasure());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const hiddenCount = authors.length - visibleCount;
  return (
    <div className="tag-cell__chips" ref={containerRef}>
      {authors.map((author, i) => (
        <span key={author} className={i < visibleCount ? "tag-chip" : "tag-chip tag-chip--overflow"}>
          {author}
        </span>
      ))}
      <span
        ref={moreRef}
        className={hiddenCount > 0 ? "tag-cell__more" : "tag-cell__more tag-cell__more--probe"}
        aria-hidden={hiddenCount === 0}
      >
        et al.
      </span>
    </div>
  );
}

/**
 * The Author `<td>` (Story 7.11): each author renders as a distinct, uniform
 * chip. Mirrors `EditableCell`'s arm→edit lifecycle:
 *
 * - Cell background click, UNARMED: bubbles to the `<tr>` → arms the row
 *   (same as `EditableCell`'s unarmed path).
 * - Cell background click, ARMED (lone selection): opens the tag editor
 *   directly (no separate isEditing click-again step - mirrors
 *   `EditableCell`'s armed→edit path via the shared `editingField` cursor).
 */
export default function TagCell({
  authors,
  editable,
  armed,
  isEditing,
  onStartEdit,
  onArm,
  onCommit,
  onCancel,
}: {
  authors: string[];
  editable: boolean;
  armed: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onArm: () => void;
  onCommit: (authors: string[]) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <td className="collection-table__authors">
        <TagEditor authors={authors} onCommit={onCommit} onCancel={onCancel} />
      </td>
    );
  }

  const chips = <AuthorChips authors={authors} />;

  if (!editable) {
    return (
      <td className="collection-table__authors" title={authors.join(", ") || undefined}>
        {chips}
      </td>
    );
  }

  return (
    <td
      className="collection-table__authors"
      title={authors.join(", ") || undefined}
      tabIndex={0}
      aria-label="Edit authors"
      onClick={(e) => {
        if (armed) {
          e.stopPropagation();
          onStartEdit();
        }
        // else: not intercepted; the click bubbles to the <tr>'s own
        // onClick, which arms the row exactly like any other cell.
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.stopPropagation();
        if (armed) {
          onStartEdit();
        } else {
          onArm();
        }
      }}
    >
      {chips}
    </td>
  );
}
