# Epic 1: Read a paper

Open a PDF from disk and read it comfortably: pages render, scroll/zoom/pan stay fluid, a table of contents jumps to sections, and the canvas never reflows. Stands up the two-process app, the library/import store, the render layer, and the anchor-service page-box foundation.

## Story 1.1: Walking-skeleton app shell

As a developer-user,
I want a single-command containerized app that boots to an empty reader shell,
So that every later feature lands on a running, same-origin foundation with generated API types.

**Acceptance Criteria:**

**Given** `docker compose up` with host `~/.paper-mate` mounted to `/data` and port via env
**When** the app starts
**Then** FastAPI/uvicorn serves the built Vite SPA and the `/api` surface from one origin (no CORS) (AR-1, AR-10)

**Given** the dev workflow
**When** the Vite dev server runs
**Then** `/api` is proxied to FastAPI with HMR (AR-10)

**Given** Pydantic models exist
**When** the contract-generation step runs
**Then** TS types are generated via `openapi-typescript` and the client imports them, with no hand-authored API types (AR-3)

**Given** the SPA loads with no PDF
**Then** the S1 reader frame renders — top-bar (48px, hairline bottom), reader-backdrop canvas region, collapsed tool-rail placeholder — all from DESIGN.md tokens with no inline hex/px (UX-DR1, UX-DR2, UX-DR12)

**Given** any interactive chrome
**When** it is focused via keyboard
**Then** a 2px `{colors.ink}` focus ring is visible (UX-DR17)

## Story 1.2: Open a PDF from disk

As a reader,
I want to drop or browse a PDF into the app,
So that it loads into my library and opens for reading.

**Acceptance Criteria:**

**Given** the S0 empty state
**Then** `{component.empty-dropzone}` shows "Drop a PDF here" / "or browse…" (FR-1, UX-DR3, UX-DR18)

**Given** I drop or pick a PDF
**When** it uploads
**Then** the backend computes `doc_id` = SHA-256 of the bytes and stores `source.pdf` + `meta.json` under `~/.paper-mate/library/{doc_id}/` (FR-1, AR-8)

**Given** a `{doc_id}/` folder already exists
**When** I re-import the same PDF
**Then** import is idempotent: existing `annotations.json`/`meta.json` are never overwritten, only `meta.last_opened` updates (AR-8)

**Given** any disk write
**Then** only the storage module touches `~/.paper-mate`, via atomic temp + rename; routes never touch the filesystem (AR-9)

**Given** a corrupt or unsupported file
**When** load fails
**Then** `{component.toast}` shows "Couldn't open this file." and the app stays in S0 (UX-DR13, UX-DR16)

**Given** a successful load
**Then** the top bar shows the filename and the app transitions to S1 (UX-DR12)

## Story 1.3: Render pages

As a reader,
I want every page of the PDF rendered as stable page cards,
So that I can read the whole paper without layout shifts.

**Acceptance Criteria:**

**Given** a loaded PDF
**When** rendering
**Then** pdfjs-dist renders each page onto a `{component.page-surface}` card centered on `{component.pdf-canvas}`, with its text layer, via a custom overlay (not pdf.js's built-in annotation layer) (FR-2, AR-2)

**Given** the render layer
**Then** it establishes the page box = PDF.js viewport at scale 1.0 using the CropBox with `/Rotate` applied, measured in CSS px (DPR divided out), as the single source for the anchor service (AR-4 foundation)

**Given** a large document
**When** loading
**Then** a skeleton reserves the final page geometry up front, pages stream in top→down, scroll is usable as they arrive, and final geometry never shifts (NFR-1, NFR-2, UX-DR16)

**Given** any page renders
**Then** normalize/denormalize coordinate math lives only in the anchor service; the render layer knows nothing about annotations (AR-9)

## Story 1.4: Scroll and page navigation

As a reader,
I want smooth vertical scrolling with a page indicator and keyboard page nav,
So that I can move through a long paper fluidly.

**Acceptance Criteria:**

**Given** a multi-page document
**When** I scroll
**Then** vertical scrolling stays fluid (~60fps target, no jank) on a 50+ page paper (FR-4, NFR-2)

**Given** I scroll
**Then** the status shows "Page N of M" for the page in view (FR-2, UX-DR12, UX-DR18)

**Given** focus on the canvas
**When** I press PgUp/PgDn
**Then** the view moves one page (UX-DR15)

**Given** scrolling
**Then** page geometry never reflows (NFR-1)

## Story 1.5: Zoom

As a reader,
I want to zoom with keyboard, ctrl+scroll, and an on-screen control,
So that I can size the page to read comfortably.

**Acceptance Criteria:**

**Given** the reader
**When** I press `Ctrl +/-` or `Ctrl+scroll`
**Then** pages zoom with a live %, and `Ctrl 0` fits/resets (FR-5, UX-DR14, UX-DR15)

**Given** the bottom-right `{component.zoom-control}` pill
**When** I click −/+
**Then** it mirrors the keyboard zoom with live % (UX-DR10)

**Given** any zoom level
**Then** the pdf-canvas box stays pixel-stable (chrome overlays, no reflow) and the anchor page box rescales so derived positions stay correct (NFR-1, NFR-3 foundation)

## Story 1.6: pdf.js decoder & asset wiring

> Added 2026-06-28 via correct-course (sprint-change-proposal-2026-06-28-render.md). Closes a Story 1.3 render gap: the pdf.js WASM image decoders and CMap/ICC/font assets were never referenced, so JPEG2000 (and JBIG2) images failed and the console flooded with `JpxError: OpenJPEG failed to initialize` + `Dependent image isn't ready yet`. Sequenced ahead of the original pan/ToC stories (now 1.8/1.9): independent and cheap, so it lands first.

As a reader,
I want figures and all glyphs to decode,
So that the page renders fully and the console stays clean.

**Acceptance Criteria:**

**Given** a PDF with JPEG2000 / JBIG2 images
**When** it renders
**Then** images decode with no `JpxError` / OpenJPEG console warnings (FR-2, AR-2)

**Given** the render layer
**Then** pdf.js asset URLs (`wasmUrl`, `cMapUrl` + `cMapPacked`, `iccUrl`, `standardFontDataUrl`) are configured in one place (`render/config.ts`) consumed by `loadDocument` (AR-2, AR-9)

**Given** a prod build
**Then** decoder / cmap / icc / standard-font assets are emitted into `dist/` and served same-origin by FastAPI (AR-10)

**Given** an embedded non-standard font
**Then** it renders via the standard-font data with no fallback-font warning

## Story 1.7: Render performance — windowing & viewport unification

> Added 2026-06-28 via correct-course. Completes the Story 1.4 NFR-2 claim (scroll was jittery, not ~60fps) and resolves the virtualization item in deferred-work.md. Root cause: `PageCard` marked a page visible once and never released its painted canvas + text layer, so painted hi-DPI canvases accumulated forever (cost scaling with zoom²), amplified by an always-on off-screen skeleton animation. Sequenced ahead of pan/ToC (1.8/1.9): it restructures the render layer those stories build on.

As a reader,
I want scroll to stay fluid on a long paper,
So that reading never stutters.

**Acceptance Criteria:**

**Given** a 50+ page paper
**When** I scroll up and down
**Then** it holds ~60fps with no jitter (FR-4, NFR-2)

**Given** pages scrolled out of view
**Then** their canvas / text-layer bitmaps are released beyond a ±N-page window (bounded live canvases), with card geometry preserved so layout never shifts (NFR-1)

**Given** off-screen cards
**Then** they incur no continuous paint (`content-visibility: auto` + `contain-intrinsic-size`; skeleton animation runs only near the viewport) (NFR-2, NFR-5)

**Given** the render layer
**Then** a single `IntersectionObserver` (a `usePageViewport` hook) drives both current-page tracking and per-card paint / release; `PageCard` holds no lifecycle logic and `Reader` is a pure shell (AR-9)

**Given** zoom, page-in-view, and PgUp/PgDn
**Then** all existing Story 1.4 / 1.5 behaviors and tests still pass

## Story 1.8: Pan / hand tool

> Renumbered from Story 1.6 → 1.8 on 2026-06-28 (correct-course) so story numbers track execution order after the render-fix stories (1.6/1.7) were sequenced first. No code or story file existed under the old number.

As a reader,
I want to pan the page by dragging with a hand tool or holding Space,
So that I can reposition a zoomed-in page.

**Acceptance Criteria:**

**Given** the `{component.tool-rail}` cursor button
**Then** its `{component.tool-flyout}` offers cursor / hand / box-select, and selecting hand arms panning (FR-6, UX-DR4)

**Given** the hand tool armed or Space held
**When** I drag
**Then** the page pans without reflowing the canvas (FR-6, IP-4, UX-DR14)

**Given** Space released or `V`/`Esc` pressed
**Then** control returns to the cursor (UX-DR15)

## Story 1.9: Table of contents

> Renumbered from Story 1.7 → 1.9 on 2026-06-28 (correct-course). No code or story file existed under the old number.

As a reader,
I want a table of contents I can open and click,
So that I can jump to a section without scroll-hunting.

**Acceptance Criteria:**

**Given** a PDF with an embedded outline
**When** I toggle the ToC
**Then** `{component.toc-panel}` (280px overlay) lists sections, overlays the canvas, and never reflows it (FR-3, UX-DR11, NFR-1)

**Given** a ToC row
**When** I click it
**Then** the canvas jumps to that section (FR-3)

**Given** a PDF with no embedded outline
**Then** the ToC panel shows an empty/unavailable state rather than erroring (edge case)
