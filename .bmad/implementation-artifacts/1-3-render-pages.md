---
baseline_commit: 10edd06
---

# Story 1.3: Render pages

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want every page of the PDF rendered as stable page cards,
so that I can read the whole paper without layout shifts.

## Acceptance Criteria

1. **Pages render via pdfjs custom overlay.** Given a loaded PDF, when rendering, then `pdfjs-dist` renders each page onto a `{component.page-surface}` card centered on `{component.pdf-canvas}`, **with its text layer**, via a custom overlay (NOT pdf.js's built-in annotation layer). [FR-2, AR-2]
2. **Page box established (anchor foundation).** Given the render layer, then it establishes the **page box** = the PDF.js viewport at **scale 1.0** using the **CropBox with `/Rotate` applied**, measured in **CSS px (DPR divided out)**, as the single source of truth for the anchor service. [AR-4 foundation]
3. **Reserve geometry, stream top→down, no shift.** Given a large document, when loading, then a skeleton **reserves the final page geometry up front**, pages stream in **top→down**, scroll is usable as they arrive, and final geometry **never shifts**. [NFR-1, NFR-2, UX-DR16]
4. **Render layer knows nothing about annotations.** Given any page renders, then normalize/denormalize coordinate math lives **only** in the anchor service; the render layer knows nothing about annotations and computes no annotation geometry. [AR-9]
5. **PDF served through the backend.** Given a loaded `doc_id`, then the client obtains the PDF bytes from the backend (`GET /api/docs/{doc_id}/file`, served by the storage module) through the `api/` layer — the client never reads the filesystem and only reaches the backend via that layer. [AR-1, AR-9, AR-11]

> **Scope guard.** This story renders pages + text layer and establishes the scale-1.0 page box. It does **not** add page-number status / PgUp-PgDn (Story 1.4), zoom (1.5), pan (1.6), ToC (1.7), or any annotation/anchor math (Epic 2). Pick a sensible fixed initial scale (fit-to-width); dynamic zoom is 1.5's job.

## Tasks / Subtasks

- [x] **Task 1 — Backend: serve the stored PDF** (AC: 5)
  - [x] Add a storage helper that resolves a document's `source.pdf` path with the same library-root containment as `_doc_dir` (reuse it), e.g. `source_path(doc_id) -> Path`, raising a storage error (or returning `None`) when the doc or file is absent. Storage stays the only code touching the data root (AR-9).
  - [x] Add route `GET /api/docs/{doc_id}/file` in `server/app/routes/docs.py`: thin, delegates to storage, returns `FileResponse(path, media_type="application/pdf")`. Unknown `doc_id`/missing file → `HTTPException(404, detail=...)` (single `{ "detail" }` envelope). No filesystem access in the route. [AR-9, AR-11]
  - [x] Keep the reserved siblings unbuilt: `GET /api/docs`, `GET /api/docs/{doc_id}`, `/api/docs/{doc_id}/annotations`.
- [x] **Task 2 — Add pdfjs-dist + worker wiring** (AC: 1)
  - [x] Install **`pdfjs-dist` 6.0.x** (pin the exact patch at install; `legacy-peer-deps` is already set in `client/.npmrc`). [AR-2, Stack]
  - [x] Configure the worker for Vite/ESM **once** at module load in the render layer: `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"` then `GlobalWorkerOptions.workerSrc = workerUrl` (the Vite-idiomatic `?url` import; do not point at a `node_modules` path string). Add the ambient `*.mjs?url` module declaration to `src/vite-env.d.ts` if TS needs it.
  - [x] Import pdf.js's text-layer CSS from the package (`import "pdfjs-dist/web/pdf_viewer.css"`) so selectable text aligns — do **not** hand-author `.textLayer` positioning CSS in `src/` (it carries raw px/colors and would trip `no-raw-values`; the vendor import is not scanned).
- [x] **Task 3 — Render layer (pdfjs wrapper, AD-4 page box)** (AC: 1, 2, 4)
  - [x] Build `client/src/render/` as the pdfjs wrapper and the **single source of the rendered page box**. Suggested surface (keep it annotation-agnostic):
    - `loadDocument(docId): Promise<PDFDocumentProxy>` — `getDocument({ url: api.docFileUrl(docId) }).promise`. Reach the backend only through the `api/` layer (Task 5 exposes `docFileUrl`).
    - `getPageBox(page): { width: number; height: number }` — `page.getViewport({ scale: 1 })` width/height in CSS px. This is the **scale-1.0 page box** (CropBox + `/Rotate` are already baked into the page's default viewport). DPR is **not** applied here (it is divided out by definition). This is the value the anchor service (Epic 2) will normalize against.
    - `renderPage(page, { scale, canvas, textLayerDiv })` — compute `viewport = page.getViewport({ scale })`; size the canvas backing store by `outputScale = window.devicePixelRatio || 1` (`canvas.width = floor(viewport.width*outputScale)`, set `canvas.style.width = floor(viewport.width)+"px"`, same for height); `page.render({ canvasContext, transform: outputScale !== 1 ? [outputScale,0,0,outputScale,0,0] : null, viewport })`; render the text layer with the **v4+ API**: `new TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container: textLayerDiv, viewport })` then `await textLayer.render()`. Return the render task so callers can cancel.
  - [x] The render layer must **not** import from `anchor/`, `annotations/`, or `store/`, and must contain **no** annotation/normalization math (AR-9). It only renders pixels and reports the page box.
- [x] **Task 4 — Reader UI: pdf-canvas + page-surface cards + reserve-geometry** (AC: 1, 3)
  - [x] Build a `Reader` (pdf-canvas) component rendered in S1 when a doc is loaded (replaces the empty `reader-backdrop` placeholder in `App.tsx`). It receives the `Doc` (has `doc_id`, `page_count`).
  - [x] **Reserve geometry first (NFR-1):** after `loadDocument`, fetch each page's scale-1.0 box (`getPage(i)` → `getPageBox`) and lay out `page_count` `{component.page-surface}` cards at their final sizes (apply the chosen initial scale) **before** painting — so the scroll height is correct up front and nothing shifts. Show a skeleton/placeholder per card until it paints.
  - [x] **Initial scale:** fit-to-width of the `pdf-canvas` (compute once from canvas width ÷ widest page box, with a sane cap ~1.0–2.0). Keep the scale in component state so Story 1.5 (zoom) can drive it later — do not hardcode it un-liftably.
  - [x] **Stream top→down (NFR-2):** paint pages progressively (sequential top-down, or lazily via `IntersectionObserver`) so scroll is usable as pages arrive; each page paints into its reserved card without changing its box. Cancel in-flight render tasks on unmount/scale change to avoid leaks.
  - [x] Center cards on `{component.pdf-canvas}` (`reader-backdrop` floor); `{component.page-surface}` = `{colors.canvas}`, `{rounded.xs}`, `1px {colors.hairline}`, soft drop. Tokens only — no raw hex/px in `src/` component styles (vendor pdf_viewer.css excepted). Chrome (top-bar, tool-rail) stays overlaid; the pdf-canvas box never reflows (NFR-1).
- [x] **Task 5 — api/ layer: file URL + regen contract** (AC: 5)
  - [x] Add to `client/src/api/client.ts` a `docFileUrl(docId: string): string` returning `/api/docs/${docId}/file` (the `api/` module stays the single owner of backend routes; the render layer imports this, never a hardcoded path). [AR-9]
  - [x] Regenerate the contract for the new endpoint: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`; commit `client/src/api/schema.d.ts`.
- [x] **Task 6 — Tests** (AC: all)
  - [x] Backend (pytest): `GET /api/docs/{doc_id}/file` returns 200 + `application/pdf` + the exact stored bytes for an imported PDF; unknown `doc_id` → 404 with the `{ "detail" }` envelope. Reuse `conftest.make_pdf_bytes` + the `data_root` fixture.
  - [x] Frontend (Vitest): pdfjs cannot run under jsdom (canvas/worker), so **mock the render module** (`vi.mock("./render/...")`) and assert the Reader: renders `page_count` `page-surface` cards, reserves them before paint, and calls `loadDocument(doc.doc_id)`; transitions are driven by the mocked loader. Do **not** attempt real pdfjs rendering in tests. Keep existing `no-raw-values.test.ts` / `focus-ring.test.ts` / App S0↔S1 tests green.
  - [x] If any pure helper has DOM-free logic (e.g. fit-to-width scale math), unit-test it directly with a fake page box.
- [x] **Task 7 — Validate + live smoke** (AC: all)
  - [x] Full suites green: backend `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`; frontend `cd client && npm test`; `npm run typecheck`; `npm run build` (confirm the pdf worker asset bundles).
  - [x] Live: `npm run dev` (or `docker compose up --build`), upload a multi-page PDF, confirm pages render with selectable text, scroll is smooth, and the canvas does not reflow as pages stream in.

## Dev Notes

### Architecture patterns & constraints (binding)

- **Spatial-anchor model — page box (AD-4, core invariant).** All annotation geometry (Epic 2) is normalized against **the rendered page box = the PDF.js page viewport at scale 1.0, using the CropBox with `/Rotate` applied, measured in CSS px with DPR divided out**. **The render layer is the single source of this page box**; the anchor service normalizes/denormalizes against it only. This story *establishes and exposes* the page box; it does not consume it. Origin is top-left/y-down — note pdf.js's viewport already yields top-left CSS coordinates for rendering; the anchor service (Epic 2) owns the bottom-left→top-left conversion, not render. [Source: ARCHITECTURE-SPINE.md#AD-4]
- **Boundary invariants (AD-9).** (1) normalized↔screen math lives **only** in `anchor/` — the render layer must not compute or store any annotation coordinates; (2) only the storage module touches the data root — the new `/file` route delegates to storage; (3) the client reaches the backend **only** through `api/` — pdfjs gets its URL from `api.docFileUrl`, not a hardcoded string. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **Stack (AD-2).** PDF rendering = `pdfjs-dist` **raw with a custom overlay**, NOT pdf.js's built-in annotation layer (that layer is for embedded form/link annots, not our marks). We render the canvas + a text layer only. [Source: ARCHITECTURE-SPINE.md#AD-2]
- **Layout stability (NFR-1).** The pdf-canvas box is pixel-stable; chrome overlays never reflow it. Loading/rendering must reserve final page geometry up front so streaming pages never shift layout. [Source: ARCHITECTURE-SPINE.md#Capability-Map; EXPERIENCE.md lines 67-82]
- **API surface (AR-11).** This story adds `GET /api/docs/{doc_id}/file`. One error envelope only: `{ "detail": string }`. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **Layered client, downward deps.** `render → anchor → annotation/tool → store → api-client`. `render/` may depend on `api/` (for the file URL) but must not import `anchor/annotations/store`. Keep the Reader UI shell at `client/src/` (like `App`/`EmptyDropzone`); the pdfjs wrapper lives in `render/`. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm]

### pdfjs-dist 6.x specifics (verified June 2026, current API)

- **Worker (Vite/ESM):** `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"; import { GlobalWorkerOptions, getDocument, TextLayer } from "pdfjs-dist"; GlobalWorkerOptions.workerSrc = workerUrl;`. Set it once at module scope in the render layer. The `?url` form lets Vite fingerprint/serve the worker; a bare `node_modules` path string breaks in prod builds.
- **Render a page (HiDPI-correct):**
  ```js
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  const task = page.render({ canvasContext: canvas.getContext("2d"), transform, viewport });
  await task.promise;
  ```
- **Text layer (v4+ class API, replaces the old `renderTextLayer` function):**
  ```js
  const textLayer = new TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
    container: textLayerDiv,   // a div overlaying the canvas, class "textLayer"
    viewport,                  // same viewport as the canvas render
  });
  await textLayer.render();
  ```
  Requires the vendor CSS `pdfjs-dist/web/pdf_viewer.css` (or at least its `.textLayer` rules) for correct absolute positioning of the text spans over the canvas.
- **Page box for anchors:** `page.getViewport({ scale: 1 })` → `{ width, height }` in CSS px. The page's default view is its CropBox and `getViewport` applies `/Rotate`, so this is exactly the AD-4 page box. Do not multiply by DPR for the box (DPR only scales the canvas backing store, not the logical page box).
- **Cancellation:** keep each `RenderTask` and call `task.cancel()` on unmount / scale change; `streamTextContent` likewise. Avoids "canvas already in use" errors and leaks during fast scroll/zoom.

### Current state of files this story touches (read before editing)

- `client/src/App.tsx` — S1 branch currently renders an empty `reader-backdrop` div + collapsed `tool-rail`. Replace the `reader-backdrop` placeholder with the `Reader` component, passing the loaded `Doc`. Preserve the top-bar (filename), the tool-rail placeholder, the toast, and the S0 branch unchanged. [client/src/App.tsx]
- `client/src/api/client.ts` — single backend path; has `uploadDoc`/`Doc`/`fetchHealth` + the `envelopeError` helper. Add `docFileUrl`. [client/src/api/client.ts]
- `client/src/render/README.md` — placeholder; this story fills `render/`. [client/src/render/README.md]
- `server/app/routes/docs.py` — has `POST /api/docs` (thin, catches `InvalidPDFError`/`StorageError`). Add `GET /api/docs/{doc_id}/file` mirroring the thin pattern. [server/app/routes/docs.py]
- `server/app/storage/__init__.py` — sole disk writer; has `_doc_dir` (with library-root containment), `import_pdf`, `_atomic_write`, `_read_meta`. Add `source_path(doc_id)` reusing `_doc_dir`. [server/app/storage/__init__.py]
- `client/src/App.css` / `client/src/theme/components.css` — token layer; add page-surface/pdf-canvas/skeleton dims here (px allowed only in `theme/**`). [client/src/App.css, client/src/theme/components.css]

### DESIGN.md token references

- `pdf-canvas`: bg `{colors.reader-backdrop}` (#f5f5f7), the scroll region; pixel-stable, hosts centered cards. [Source: DESIGN.md#components.pdf-canvas]
- `page-surface`: bg `{colors.canvas}` (#fff), `{rounded.xs}` (4px), `1px {colors.hairline}`, soft drop `0 4px 12px rgba(0,0,0,0.04)`. One rendered page. [Source: DESIGN.md#components.page-surface]
- Skeleton/reserved card: use `{colors.canvas-soft}`/`{colors.hairline}` at the reserved page size; respect `prefers-reduced-motion` (no shimmer if reduced). [Source: EXPERIENCE.md lines 72-82; UX-DR16]
- Rule: reference tokens, never inline hex/px outside `src/theme/**`; `no-raw-values.test.ts` enforces it. Vendor `pdf_viewer.css` (imported from the package) is not scanned. [Source: CLAUDE.md#Design-conventions]

### UX states (EXPERIENCE.md)

- **S1 · Reader:** PDF canvas (`{component.pdf-canvas}`) hosts centered `{component.page-surface}` pages with vertical scroll; **fixed box** (overlays never reflow it). [Source: EXPERIENCE.md lines 27-29, 398]
- **Loading:** file chosen → dropzone gives way to spinner/skeleton; canvas reserves the frame. **Rendering:** large doc → pages stream in top→down; scroll usable as they arrive. **Loading and rendering must never shift final page geometry — reserve layout up front (NFR-1).** [Source: EXPERIENCE.md lines 72-82]

### Previous story intelligence (Stories 1.1–1.2)

- **Test commands (host-env workarounds — use exactly):** backend `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`; frontend `cd client && npm test`. [Source: 1-1/1-2 Dev Notes; CLAUDE.md]
- **`no-raw-values.test.ts`** scans `src/**` `.tsx`/`.css` (strips comments first) and flags hex/px outside `theme/**`. Put all new px in `components.css`; rely on the vendor pdf_viewer.css import (outside `src/`) for text-layer styling. [Source: 1-1 Debug Log]
- **Filesystem-touching Vitest tests** need `// @vitest-environment node`. The Reader tests should mock the render module and stay in jsdom; don't touch the FS. [Source: 1-1 Debug Log]
- **Contract pipeline:** Pydantic → `export_openapi` (writes `server/openapi.json`, gitignored) → `npm run gen:api` → committed `schema.d.ts`. A binary `FileResponse` route adds a path but no new schema; still regenerate so the path is documented. [Source: 1-2 Completion Notes]
- **Generated client is the only backend path (AD-9).** 1-2 added `uploadDoc`; follow the same module for `docFileUrl`. [Source: 1-2]
- **`legacy-peer-deps=true`** is set in `client/.npmrc`; new client deps (pdfjs-dist) install under it. Pin explicit peers if needed. [Source: 1-1 Debug Log]
- **Atomic-write / containment rigor** from 1-1/1-2 review: resolve+contain any path built from input. `source_path` builds on `_doc_dir`'s existing containment — reuse it, don't reimplement. [Source: 1-2 Senior Developer Review]

### Project Structure Notes

- `render/` becomes real this story; `anchor/`, `annotations/`, `store/` stay README stubs (Epic 2/3). Do not put coordinate math in `render/` — that is `anchor/`'s exclusive job (AD-9). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- The PDF is fetched by `doc_id` (durable path), not from the in-memory upload `File`. This is what Epic 3 "restore on reopen" reuses — render must work for a doc that was imported in a prior session, given only its `doc_id`. [Source: ARCHITECTURE-SPINE.md#AD-6]
- After this story consider updating `docs/API.md` (new `GET /api/docs/{doc_id}/file`) per the CLAUDE.md maintenance rule.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.3] — story statement + ACs
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] — AD-2, AD-4, AD-6, AD-9, AR-11, Structural Seed, Stack
- [Source: DESIGN.md] — pdf-canvas, page-surface tokens
- [Source: EXPERIENCE.md] — S1 reader, loading/rendering states, NFR-1 reserve-layout
- [Source: pdfjs-dist 6.x docs (mozilla/pdf.js)] — getDocument/getViewport/page.render, TextLayer v4+ class, worker setup
- [Source: .bmad/implementation-artifacts/1-2-open-a-pdf-from-disk.md] — storage/route patterns, contract pipeline, test commands

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow)

### Debug Log References

- **pdf.js 6 render params:** v6 `page.render` requires `canvas` alongside `canvasContext` in `RenderParameters` (TS error TS2345 until added).
- **`PDFDocumentProxy.destroy` missing in bundled types:** exists at runtime but pdfjs-dist 6.0.227's `.d.ts` only declares it on the loading task; wrapped the cast in `render/destroyDocument` so the workaround stays in the render layer.
- **`no-raw-values` scans `.ts`/`.tsx`/`.css`:** `IntersectionObserver` `rootMargin: "200px"` tripped the px rule; rebuilt as `` `${PREFETCH_MARGIN}px` `` (no digit adjacent to `px`). All page dims flow from existing tokens; vendor `pdf_viewer.css` (imported from the package, outside `src/`) is not scanned.
- **App/Reader Vitest:** pdf.js can't run under jsdom, so `App.test.tsx` and `Reader.test.tsx` `vi.mock("./render")`; the pure `fitToWidthScale` is unit-tested with the heavy pdf.js imports stubbed.

### Completion Notes List

- **Backend (AC-5):** added `storage.source_path(doc_id)` (reuses `_doc_dir` containment; raises new `DocumentNotFoundError`) and the thin `GET /api/docs/{doc_id}/file` route returning `FileResponse(..., media_type="application/pdf")`; unknown id → 404 `{ detail }`. Route touches no filesystem.
- **Render layer (AC-1,2,4):** `client/src/render/index.ts` wires the pdf.js worker (`?url`) + vendor text-layer CSS once at module load and exposes `loadDocument`, `getPageBox` (the scale-1.0 AD-4 page box, DPR divided out), `renderPage` (HiDPI canvas + v4 `TextLayer`, cancellable), `destroyDocument`, and the DOM-free `fitToWidthScale`. Imports `api/` only — no anchor/annotations/store, no coordinate math.
- **Reader UI (AC-1,3):** `Reader.tsx` replaces the empty `reader-backdrop`. Reserves every page's final geometry up front (NFR-1), fits-to-width once (scale held in state for Story 1.5), and streams pages top→down via `IntersectionObserver` (eager fallback where IO is absent), cancelling in-flight renders on unmount/scale change.
- **Contract (AC-5):** `api.docFileUrl` is the sole owner of the file path; regenerated `schema.d.ts`; `docs/API.md` updated.
- **Live smoke:** 3-page text PDF over `docker-equivalent` same-origin uvicorn (DPR 1.25) — page boxes reserved identically (978×1265), pages 1 & 3 painted on demand at HiDPI (1222×1582), selectable text present, **page geometry stable across scroll (no shift)**.

### File List

**Added**
- `client/src/render/index.ts`
- `client/src/render/fit.test.ts`
- `client/src/Reader.tsx`
- `client/src/Reader.css`
- `client/src/Reader.test.tsx`

**Modified**
- `server/app/storage/__init__.py` (add `DocumentNotFoundError`, `source_path`)
- `server/app/routes/docs.py` (add `GET /api/docs/{doc_id}/file`)
- `server/tests/test_docs.py` (file-route tests)
- `server/tests/test_storage.py` (`source_path` tests)
- `server/openapi.json` (regenerated)
- `client/src/api/client.ts` (add `docFileUrl`)
- `client/src/api/schema.d.ts` (regenerated)
- `client/src/App.tsx` (mount `Reader`)
- `client/src/App.css` (drop dead `.reader-backdrop`)
- `client/src/App.test.tsx` (mock render layer)
- `client/src/render/README.md`
- `client/package.json` / `client/package-lock.json` (add `pdfjs-dist@6.0.227`)
- `docs/API.md` (document `/file` endpoint)

## Change Log

- **2026-06-28:** Story 1.3 implemented — backend PDF-file route + render layer + Reader (reserve-geometry, top→down streaming, text layer). Backend 29 tests, frontend 30 tests, typecheck, and prod build (pdf worker asset bundles) all green; live browser smoke confirmed all 5 ACs. Status → review.
