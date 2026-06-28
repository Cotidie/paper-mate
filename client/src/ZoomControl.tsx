/**
 * `{component.zoom-control}` — floating bottom-right pill: `−` / live `%` / `+`
 * (UX-DR10, DESIGN.md). Presentational only: it owns no scale state and does no
 * zoom math — `Reader` holds `scale` and passes the percent + handlers. The pill
 * is an overlay (App.css positions it absolute over the stage) so it never
 * consumes canvas width or reflows the pdf-canvas (NFR-1). Clicking the `%`
 * fits/resets, mirroring `Ctrl 0`.
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
    <div className="zoom-control" data-testid="zoom-control">
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
        aria-label="Fit to width"
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
