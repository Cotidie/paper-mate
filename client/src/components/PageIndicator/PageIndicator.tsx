import { CaretLeft, CaretRight } from "@phosphor-icons/react";

/**
 * `{component.page-indicator}` — the centered top-bar page nav: a caret-left
 * button, the current page in a filled chip, "of N", and a caret-right button.
 * Presentational only (mirrors `ZoomControl`): it owns no page state and does no
 * scrolling — `App` passes the live `currentPage` (reported up by `Reader`) and
 * wires prev/next to `Reader`'s imperative `jumpToPage`. Its CSS lives in
 * `App.css` beside `.zoom-control`, the top-bar pill it shares an idiom with.
 *
 * Accessibility: the whole readout is a polite live region with a full
 * "Page N of M" accessible name, so assistive tech announces the page as it
 * changes; the carets disable at the first/last page.
 */
export default function PageIndicator({
  currentPage,
  pageCount,
  onPrev,
  onNext,
}: {
  currentPage: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
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
        <span className="page-indicator__current" data-testid="page-indicator-current">
          {currentPage}
        </span>
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
