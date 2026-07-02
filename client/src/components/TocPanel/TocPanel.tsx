import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import type { TocEntry } from "../../render";

/**
 * `{component.toc-panel}` — the Table-of-Contents overlay (Story 1.9). A 280px
 * right-edge panel that lists the PDF's embedded outline; clicking a row jumps
 * the canvas to that section. Overlay only — it floats above the canvas and
 * never reflows it (NFR-1).
 *
 * Presentational, mirroring `ZoomControl`/`ToolRail`: it owns no pdf/scroll
 * state. `App` holds `open`/`entries` (reported up by `Reader`) and wires the
 * jump (`Reader`'s imperative `jumpToPage`) + close. The section jump is
 * page-level (FR-3); within-page targeting is out of scope for v1.
 *
 * Accessibility: rows + the close button are real `<button>`s (keyboard-operable,
 * standard focus ring), and `Esc` closes the panel (UX-DR17).
 */
export default function TocPanel({
  open,
  entries,
  onJump,
  onClose,
}: {
  open: boolean;
  /** The resolved outline, or `null` while it is still loading (so a pending
   *  outline shows a loading note, not the no-outline empty state). */
  entries: TocEntry[] | null;
  onJump: (pageNumber: number) => void;
  onClose: () => void;
}) {
  // Esc closes (UX-DR17). Listener mounted only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="toc-panel" data-testid="toc-panel" aria-label="Table of contents">
      <div className="toc-panel__header">
        <span className="toc-panel__title">Contents</span>
        <button
          type="button"
          className="toc-panel__close"
          aria-label="Close table of contents"
          title="Close (Esc)"
          data-testid="toc-close"
          onClick={onClose}
        >
          <X aria-hidden />
        </button>
      </div>

      {entries === null ? (
        <p className="toc-panel__empty" data-testid="toc-loading">
          Loading contents…
        </p>
      ) : entries.length === 0 ? (
        <p className="toc-panel__empty" data-testid="toc-empty">
          This PDF has no table of contents.
        </p>
      ) : (
        <ul className="toc-panel__list">
          {entries.map((entry, i) => (
            <li key={i}>
              <button
                type="button"
                className="toc-panel__row"
                data-testid={`toc-row-${i}`}
                // Indent nested sections by depth. calc keeps the raw px in the
                // token layer (no-raw-values): the literal here is just a count.
                style={{ paddingInlineStart: `calc(var(--toc-indent-step) * ${entry.depth + 1})` }}
                onClick={() => onJump(entry.pageNumber)}
              >
                {entry.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
