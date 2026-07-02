/**
 * `{component.zoom-control}` — `−` / live `%` / `+`, sits in the top bar left of
 * the ToC button (UX-DR10 revised 2026-06-28; was a bottom-right floating pill).
 * Presentational only: it owns no scale state and does no zoom math — `App`
 * passes the live percent (reported up by `Reader`) and wires the buttons to
 * `Reader`'s imperative zoom handle. Top-bar chrome, so it consumes no canvas
 * width (NFR-1). Clicking the `%` fits/resets, mirroring `Ctrl 0`.
 *
 * Accessibility: the visible percent is the accessible name of the reset button
 * (no overriding `aria-label`) and is a polite live region, so assistive tech
 * announces the current zoom level as it changes.
 */
export default function ZoomControl({
  percent,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  percent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="zoom-control" role="group" aria-label="Zoom" data-testid="zoom-control">
      <button
        type="button"
        className="zoom-control__button"
        onClick={onZoomOut}
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="zoom-control__percent"
        onClick={onReset}
        title="Fit to width"
        aria-live="polite"
        data-testid="zoom-percent"
      >
        {percent}%
      </button>
      <button
        type="button"
        className="zoom-control__button"
        onClick={onZoomIn}
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
