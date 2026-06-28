# Deferred Work

Items surfaced during review that are real but intentionally not actioned now.

## Deferred from: code review of story-1-2-open-a-pdf-from-disk (2026-06-28)

- **Upload size cap** [server/app/routes/docs.py:21] — `POST /api/docs` reads the entire PDF into memory (`await file.read()`) with no size limit, so a very large upload could exhaust server memory before validation. Deferred: the deployment is localhost single-user with no auth (AD-1/AD-10), no size limit is specified, and papers are small. Revisit if the app is ever exposed to multiple/untrusted users — add a max-size guard returning 413, or a storage-owned streaming hash path.

## Deferred from: code review of 1-5-zoom (2026-06-28)

- ~~**Text layer scale variables outside pdf.js viewer wrapper**~~ **(RESOLVED 2026-06-28)** — `renderPage` now explicitly sets `--scale-factor` and `--total-scale-factor` on the swapped `.textLayer`, instead of relying on a `.pdfViewer .page` wrapper or the copied `cssText` alone. Live-verified after a zoom: `--scale-factor` = scale, `--total-scale-factor` = scale × DPR, spans aligned.
- **Scroll-away render cancellation** [client/src/Reader.tsx:409] — `PageCard` marks a page visible once and disconnects the observer, so in-flight page renders cancel on unmount or scale change but not when the card leaves the viewport. This predates Story 1.5 and should be revisited with broader lazy-rendering or virtualization work.
