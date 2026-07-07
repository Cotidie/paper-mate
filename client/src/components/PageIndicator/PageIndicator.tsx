import { useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

/**
 * `{component.page-indicator}` — the centered top-bar page nav: a caret-left
 * button, an editable current-page chip, "of N", and a caret-right button.
 * Presentational only (mirrors `ZoomControl`): it owns no page state and does
 * no scrolling — `ReaderPage` passes the live `currentPage` (reported up by
 * `Reader`) and wires the carets to Prev/Next and the chip's typed value to a
 * page jump.
 *
 * The chip is an `<input>` (fix request: type a page number to jump). While
 * unfocused it mirrors the live `currentPage`, advancing as the reader
 * scrolls; on focus it becomes a free numeric draft the reader types into,
 * committed (parsed, clamped to `[1, pageCount]`, jumped) on Enter or blur and
 * abandoned on Escape.
 *
 * Accessibility: the readout is a polite live region with a full "Page N of M"
 * accessible name, so assistive tech announces the page as it changes; the
 * input carries its own "Page number" name; the carets disable at the
 * first/last page.
 */
export default function PageIndicator({
  currentPage,
  pageCount,
  onPrev,
  onNext,
  onJump,
}: {
  currentPage: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  /** Jump to a 1-based page the reader typed into the chip (already clamped). */
  onJump: (page: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // `null` = not editing (the input mirrors `currentPage`); a string = the
  // in-progress typed draft (digits only). `draftRef` mirrors it so `commit`
  // reads the live value synchronously: Enter/Escape blur the input right after
  // updating the draft, and that blur re-enters `commit` before React has
  // re-rendered — a state-closure read there would be stale (double-jump on
  // Enter, a stray jump on Escape). The ref is always current.
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  function setDraftValue(value: string | null) {
    draftRef.current = value;
    setDraft(value);
  }

  function commit() {
    const value = draftRef.current;
    setDraftValue(null);
    if (value === null) return;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    const target = Math.min(pageCount, Math.max(1, parsed));
    if (target !== currentPage) onJump(target);
  }

  return (
    <div className="page-indicator" role="group" aria-label="Page navigation" data-testid="page-indicator">
      <button
        type="button"
        className="page-indicator__button"
        onClick={onPrev}
        disabled={currentPage <= 1}
        aria-label="Previous page"
        title="Previous page"
      >
        <CaretLeft aria-hidden />
      </button>
      <span
        className="page-indicator__status"
        role="status"
        aria-live="polite"
        aria-label={`Page ${currentPage} of ${pageCount}`}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          className="page-indicator__current"
          data-testid="page-indicator-current"
          aria-label="Page number"
          size={Math.max(2, String(pageCount).length)}
          value={draft ?? String(currentPage)}
          onFocus={(e) => {
            setDraftValue(String(currentPage));
            e.currentTarget.select();
          }}
          onChange={(e) => setDraftValue(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              inputRef.current?.blur();
            } else if (e.key === "Escape") {
              setDraftValue(null);
              inputRef.current?.blur();
            }
          }}
          onBlur={commit}
        />
        <span className="page-indicator__total"> of {pageCount}</span>
      </span>
      <button
        type="button"
        className="page-indicator__button"
        onClick={onNext}
        disabled={currentPage >= pageCount}
        aria-label="Next page"
        title="Next page"
      >
        <CaretRight aria-hidden />
      </button>
    </div>
  );
}
