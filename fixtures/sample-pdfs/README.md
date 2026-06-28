# Sample PDFs

Real PDFs committed for **manual / real-scenario testing** of the reader (open,
render, scroll, zoom, pan, ToC). These are NOT used by the automated test suites —
the backend tests synthesize minimal PDFs in memory via `pypdf`
(`server/tests/conftest.py: make_pdf_bytes`), and the frontend unit tests do not
load real documents. Use these by dropping/browsing them into the running app.

## Files

### `09-regularization.pdf`

23-page textbook chapter (Understanding Deep Learning, ch. 9 "Regularization"),
`%PDF-1.7`, ~1.4 MB, with an embedded outline and multiple JPEG2000-encoded
figures.

It is the deliberate repro for the two render-fix stories opened via
correct-course (`.bmad/planning-artifacts/sprint-change-proposal-2026-06-28-render.md`):

- **Story 1.6 (pdf.js decoder & asset wiring)** — its figures are JPEG2000 (JPX).
  Before the fix they fail with `JpxError: OpenJPEG failed to initialize` /
  `Dependent image isn't ready yet` console warnings. After: figures decode,
  console clean.
- **Story 1.7 (render perf — windowing)** — 23 pages is enough to exercise
  scroll up/down and observe jitter / live-canvas accumulation. (For the full
  NFR-2 "50+ pages" bar, pair with a larger document.)
