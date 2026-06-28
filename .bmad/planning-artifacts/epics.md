---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md
  - .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/addendum.md
  - .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md
  - DESIGN.md
  - EXPERIENCE.md
  - .bmad/specs/spec-paper-mate/SPEC.md
  - .bmad/planning-artifacts/briefs/brief-paper-mate-2026-06-27/brief.md
---

# Paper Mate - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Paper Mate, decomposing the requirements from the PRD, UX Design (DESIGN.md + EXPERIENCE.md), and Architecture (ARCHITECTURE-SPINE.md) into implementable stories. Scope is **v1 = Phase 1 (Viewer / Annotator)**; Phase 2 (Reading Helper) and Phase 3 (AI Companion) are directional only — the architecture reserves their seams but they are not built here.

> **Spec-conflict note:** the product brief (2026-06-27) listed "Export an annotated PDF" as v1-in. The newer canonical SPEC / PRD / Architecture (2026-06-28) defer export to Phase 2. The canonical contract wins — **export is excluded from v1**.

## Requirements Inventory

### Functional Requirements

**FG-A · PDF Viewer (layout-stable core)**

- **FR-1** Open/load a PDF from disk.
- **FR-2** Render pages with page navigation.
- **FR-3** Table of contents for jump-to-section.
- **FR-4** Smooth vertical scrolling.
- **FR-5** Zoom via `ctrl` `+` / `-`.
- **FR-6** Hand tool — pan the page by dragging.

**FG-B · Annotation tools**

- **FR-7** Highlight.
- **FR-8** Underline.
- **FR-9** Pen/brush freehand drawing.
- **FR-10** Textbox memo — free-floating text typed directly onto the page.
- **FR-11** Comment — a note pinned/anchored to a spot, opens on click.
- **FR-12** Range/area (box) selection of a region.

**FG-C · Annotation interaction**

- **FR-13** Drag-to-annotate (drag-select text or region to create an annotation).
- **FR-14** Drag-to-change-tool — on drag-select, a quick tool picker pops (highlight / underline / comment / memo) so the user switches tool without returning to the left rail.
- **FR-15** Edit an existing annotation: move, resize, restyle (color), and re-edit text.
- **FR-16** Undo / redo.
- **FR-17** Delete an annotation.

**FG-D · Annotation Bank**

- **FR-18** A separate Annotation Bank layout/drawer that toggles open/closed.
- **FR-19** Lists all annotations in the document.
- **FR-20** Click an entry to jump to that annotation's location.

**FG-E · Persistence**

- **FR-21** Save annotations local-first to disk.
- **FR-22** On reopening a PDF, restore its annotations exactly (reserved across sessions).

### NonFunctional Requirements

- **NFR-1 Layout stability** *(defining bar)* — the PDF area is pixel-stable regardless of UI state. The left rail, drag-to-change-tool picker, and Annotation Bank all overlay or reserve fixed space; none reflow or resize the page.
- **NFR-2 Smoothness** — scroll, zoom, and pan stay fluid (target ~60fps, no jank) on a large paper (50+ pages).
- **NFR-3 Anchor fidelity** — every annotation re-renders at its exact PDF coordinates across all zoom levels.
- **NFR-4 Durability** — annotations are never silently lost; local-first storage survives reload.
- **NFR-5 Immersion** — minimal Obsidian-style chrome; hairlines and restraint; UI recedes behind the paper (per DESIGN.md token scales only).

### Additional Requirements

Technical requirements from ARCHITECTURE-SPINE.md that shape implementation. **No third-party starter template** — this is a greenfield scaffold (React + Vite SPA, no meta-framework; FastAPI backend). Epic 1 Story 1 must stand up this scaffold.

- **AR-1 (AD-1) Runtime topology** — localhost SPA (Chrome/Firefox) talking to a dockerized FastAPI backend that owns all disk I/O via a host volume mount. The client never touches the filesystem; all persistence goes through the backend API.
- **AR-2 (AD-2) Stack** — backend = Python/FastAPI + Pydantic v2; frontend = React 19 + Vite 8 SPA + TypeScript 6 (no meta-framework); PDF rendering = `pdfjs-dist` 6.x raw with a custom overlay (not pdf.js's built-in annotation layer).
- **AR-3 (AD-3) Contract sync** — Pydantic models are the single source of the annotation model + API contract → FastAPI OpenAPI → generated TS types via `openapi-typescript`. Client API types are generated, never hand-authored.
- **AR-4 (AD-4) Spatial-anchor model (core invariant)** — all annotation geometry stored page-normalized (fractions [0,1] of page w/h), top-left origin y-down, against the rendered page box (PDF.js viewport at scale 1.0, CropBox + `/Rotate`, CSS px, DPR divided out). Canonical rect `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`. `anchor.kind` discriminator: `text` `{rects, text}` / `rect` `{rect}` / `path` `{points}`. One anchor = one page; cross-page selection splits into one annotation per page sharing `group_id`. Screen position always derived, never persisted.
- **AR-5 (AD-5) Annotation entity** — one `Annotation` = `{id, doc_id, type(highlight|underline|pen|memo|comment), group_id, anchor(carries kind), style(color, stroke_width?), body(text|null), created_at, updated_at}`. Rendering keys off `anchor.kind`, never `type`. Allowed pairings: highlight/underline→text|rect; comment→text|rect; memo→rect; pen→path. Style field-scoped by kind; `body` non-null only for memo/comment.
- **AR-6 (AD-6) Ownership** — backend filesystem (per-doc `annotations.json`) is the durable source of truth; client store is a working copy hydrated on open, flushed on change. Single user, one session per doc, no concurrency.
- **AR-7 (AD-7) State mutation & persistence** — every annotation change flows through one client command stack (do/undo) → store → dirty flag → debounced autosave. Autosave is single-flight per doc (one in-flight `PUT`; edits during flight re-trigger after resolve). Backend is a dumb store: `GET` returns last-saved set; `PUT` overwrites full current set via atomic write (temp + rename). No server-side history/undo/edit logic. Undo/redo is client-only, in-memory, discarded on reload.
- **AR-8 (AD-8) Storage layout & identity** — `~/.paper-mate/library/{doc_id}/` holds `source.pdf` + `annotations.json` + `meta.json`; `~/.paper-mate/config.json` reserved (Phase 3). `doc_id` = SHA-256 of original PDF bytes, computed once at import, never recomputed. Import is idempotent by `doc_id` (never overwrites existing annotations/meta). `meta.json` owned solely by storage module, schema `{filename, title, page_count, added, last_opened, schema_version}`. `annotations.json` = `{schema_version, annotations: Annotation[]}`; unknown versions rejected/migrated, never guessed.
- **AR-9 (AD-9) Boundary invariants** — (1) normalized-anchor ↔ screen math lives ONLY in the anchor service; render layer never knows annotations; tool/annotation features never compute screen↔PDF coords. (2) storage module is the ONLY code touching `~/.paper-mate`; routes never touch the filesystem. (3) client reaches the backend ONLY through the generated API client.
- **AR-10 (AD-10) Deployment** — single container (docker-compose); FastAPI/uvicorn serves both the API and the built Vite SPA static assets (same-origin → no CORS). Compose volume-mounts host `~/.paper-mate` → `/data`, maps port (host path + port via env). Dev: Vite dev server (HMR) proxies `/api` to FastAPI. Prod: FastAPI serves `dist/`. No auth (localhost, single user).
- **AR-11 API surface** — REST/JSON under `/api`; resources `/api/docs`, `/api/docs/{doc_id}`, `/api/docs/{doc_id}/file`, `/api/docs/{doc_id}/annotations`. One error envelope: FastAPI default `{ "detail": string }`.
- **AR-12 Conventions** — IDs: `doc_id`=SHA-256 hex, `annotation.id`/`group_id`=UUIDv4. Dates: ISO-8601 UTC. Store keys annotations by `id` (map); Annotation Bank order = `created_at` ascending. Colors reference DESIGN.md `{colors.annotation-*}` tokens, not raw hex.

### UX Design Requirements

From DESIGN.md (visual identity / tokens / component catalog) and EXPERIENCE.md (IA, behavior, states, interactions, accessibility). Each is specific enough to drive testable acceptance criteria.

- **UX-DR1 Design-token foundation** — implement the token scales as the styling source of truth: `{colors.*}` (incl. the 6-color annotation accent palette + default=yellow), `{typography.*}` (Inter display 600 / body 400-500, JetBrains Mono code), `{spacing.*}` (4px base), `{rounded.*}`. No inline hex/px in components.
- **UX-DR2 Reader frame (S1) layout** — fixed top bar (48px, hairline bottom), a pixel-stable `{component.pdf-canvas}` on `{colors.reader-backdrop}` hosting centered `{component.page-surface}` cards, with tool rail / Annotation Bank / zoom control as overlays that never consume canvas width (NFR-1).
- **UX-DR3 Empty state (S0)** — `{component.empty-dropzone}`: drag-drop a PDF or browse; copy "Drop a PDF here" / "or browse…"; transitions to S1 on load.
- **UX-DR4 Tool rail** — floating 48px collapsible card (`[` toggles); buttons cursor(+flyout cursor/hand/box-select), highlight, underline, pen, memo, comment, box-select, ToC; armed tool stays armed until another chosen or `Esc`/`V`; armed/hover styling per `{component.tool-button-armed}`.
- **UX-DR5 Contextual quick-box** — `{component.quick-box}` pops on drag-release, contents by mode: selection→tool-type picker (highlight/underline/comment/memo); highlight/underline→color-swatch row; pen→swatch row + stroke-width steps; memo→inline text-input + color/size; comment→comment-bubble directly; box-select→region tool-type picker. Dismiss on pick/outside-click/`Esc`; positioned at selection; never shifts canvas.
- **UX-DR6 Color-swatch picker** — `{component.color-swatch}` 20px pills of the annotation accent palette; armed swatch gets 2px `{colors.ink}` ring.
- **UX-DR7 On-page annotation rendering** — `{component.annotation-highlight}` (accent ~0.4 opacity), `{component.annotation-underline}` (2px accent), `{component.annotation-pen}` (vector stroke, width from quick-box), `{component.annotation-memo}` (free-floating text box, no page displacement), `{component.annotation-comment-pin}` (highlight + round pin).
- **UX-DR8 Comment bubble** — `{component.comment-bubble}` opens on pin click for read/edit; keyboard-reachable, `Esc`-dismissable, focus moves in on open and returns on close.
- **UX-DR9 Annotation Bank panel** — `{component.annotation-bank-panel}` 320px right-overlay, toggled (`Ctrl B`); rows `{component.bank-list-item}` = type glyph + color dot + snippet + page; hover state; empty copy "No annotations yet."; click row → canvas jumps + target flashes.
- **UX-DR10 Zoom control** — `{component.zoom-control}` in the top bar, left of the ToC button: `−` / live `%` / `+`; mirrors keyboard + `ctrl+scroll`. (Revised 2026-06-28 by sprint-change-proposal-2026-06-28.md; originally a bottom-right floating pill, moved to the top bar to free the reading area.)
- **UX-DR11 Table-of-contents panel** — `{component.toc-panel}` 280px overlay; rows jump to section.
- **UX-DR12 Top bar & save indicator** — `{component.top-bar}` filename + `{component.save-indicator}` ("Saving…" → "Saved" flashing success → settles muted) + Bank/ToC toggles.
- **UX-DR13 Toast / error surface** — `{component.toast}` bottom-center dark for load/save failures; copy "Couldn't open this file." / "Couldn't save — changes kept in this session."
- **UX-DR14 Interaction primitives (IP-1..IP-11)** — tool select (armed-sticky), drag-to-annotate, contextual quick-box, pan (hand or hold-`Space`), zoom (`Ctrl +/-`, `Ctrl 0` fit, `Ctrl+scroll`, buttons), edit (click-select, drag-handle move/resize, re-open quick-box restyle, double-click text annotations to re-edit), undo/redo (`Ctrl Z`/`Ctrl Shift Z`), delete (`Del`/`Backspace`), freehand pen, comment, bank jump.
- **UX-DR15 Keyboard map** — `V`/`Esc` cursor/deselect, `Space` temp pan, `H` highlight, `U` underline, `D` pen, `T` memo, `C` comment, `M` box-select, `Ctrl +/-` zoom, `Ctrl 0` fit, `Ctrl B` bank, `[` rail, `PgUp`/`PgDn` page nav, `Del`/`Backspace` delete, `Ctrl Z`/`Ctrl Shift Z` undo/redo.
- **UX-DR16 State patterns** — Empty / Loading (skeleton, reserve frame) / Rendering (pages stream top→down) / Reading idle / Tool-armed / Annotating (live preview) / Editing (handles) / Saving-Saved / Error(load→toast+S0) / Error(save→toast, keep session). Loading/rendering must never shift final page geometry (NFR-1).
- **UX-DR17 Accessibility floor** — every tool/action keyboard-operable; visible 2px `{colors.ink}` focus rings; ~AA contrast for UI text; quick-box & comment bubble keyboard-reachable + `Esc`-dismissable with focus management; respect `prefers-reduced-motion` (jump-flash/panel-slide degrade to instant); annotation accents distinguishable by glyph+label, not color alone.
- **UX-DR18 Voice & microcopy** — Obsidian-quiet: sparse, plain, lowercase-leaning; no exclamation marks, no emoji; errors state the fact then the fallback. Use the EXPERIENCE.md copy table verbatim.

### FR Coverage Map

- **FR-1** Open/load PDF from disk → Epic 1
- **FR-2** Render pages with page navigation → Epic 1
- **FR-3** Table of contents jump-to-section → Epic 1
- **FR-4** Smooth vertical scrolling → Epic 1
- **FR-5** Zoom via ctrl +/- → Epic 1
- **FR-6** Hand tool pan → Epic 1
- **FR-7** Highlight → Epic 2
- **FR-8** Underline → Epic 2
- **FR-9** Pen/brush freehand → Epic 2
- **FR-10** Textbox memo → Epic 2
- **FR-11** Comment (pin + bubble) → Epic 2
- **FR-12** Range/area box selection → Epic 2
- **FR-13** Drag-to-annotate → Epic 2
- **FR-14** Drag-to-change-tool (contextual quick-box) → Epic 2
- **FR-15** Edit annotation (move/resize/restyle/re-edit) → Epic 3 (lightweight restyle/recolor slice in Epic 2 Story 2.5)
- **FR-16** Undo / redo → Epic 3
- **FR-17** Delete annotation → Epic 2 Story 2.5 (client delete seed) + Epic 3 Story 3.3 (command-path delete + undo)
- **FR-18** Annotation Bank toggle drawer → Epic 3
- **FR-19** Bank lists all annotations → Epic 3
- **FR-20** Bank click-to-jump → Epic 3
- **FR-21** Save annotations local-first to disk → Epic 3
- **FR-22** Restore annotations exactly on reopen → Epic 3

## Epic List

### Epic 1: Read a paper
Open a PDF from disk and read it comfortably: pages render, scroll/zoom/pan stay fluid (~60fps on 50+ pages), a table of contents jumps to sections, and the canvas never reflows. Stands up the two-process app (FastAPI + Vite SPA, docker-compose single container, Pydantic→OpenAPI→TS contract generation), the library/import store (`doc_id` = SHA-256, idempotent import), the render layer, and the anchor-service page-box foundation that later phases consume.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6
**NFRs:** NFR-1 (first proof), NFR-2, NFR-5
**Architecture:** AR-1, AR-2, AR-3, AR-4 (page-box foundation), AR-8 (import/storage), AR-9, AR-10, AR-11, AR-12

### Epic 2: Annotate the paper
Mark up the page with all six tools — highlight, underline, pen, memo, comment, box-select — via drag-to-annotate and the contextual quick-box that switches tool/color without returning to the rail. Marks land anchored to exact PDF coordinates and the page never moves. This epic is the risk gate: it proves the spatial-anchor model holds across zoom (NFR-3).
**FRs covered:** FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14
**NFRs:** NFR-1 (overlay tools), NFR-3 (proven)
**Architecture:** AR-4 (proven), AR-5 (annotation entity), AR-9 (boundary)

### Epic 3: Edit, persist & review
Make the annotated record durable and curatable: select, move, resize, restyle, re-edit text, undo/redo, and delete — all through one command stack — plus autosave to disk with exact restore on reopen, and the Annotation Bank (list + click-to-jump). Groups everything that flows through the store/command-stack and persistence path.
**FRs covered:** FR-15, FR-16, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22
**NFRs:** NFR-4 (durability), NFR-1 (Bank overlay)
**Architecture:** AR-6 (ownership), AR-7 (command stack + autosave), AR-8 (persistence), AR-9 (boundary)

## Epic 1: Read a paper

Open a PDF from disk and read it comfortably: pages render, scroll/zoom/pan stay fluid, a table of contents jumps to sections, and the canvas never reflows. Stands up the two-process app, the library/import store, the render layer, and the anchor-service page-box foundation.

### Story 1.1: Walking-skeleton app shell

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

### Story 1.2: Open a PDF from disk

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

### Story 1.3: Render pages

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

### Story 1.4: Scroll and page navigation

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

### Story 1.5: Zoom

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

### Story 1.6: pdf.js decoder & asset wiring

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

### Story 1.7: Render performance — windowing & viewport unification

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

### Story 1.8: Pan / hand tool

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

### Story 1.9: Table of contents

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

## Epic 2: Annotate the paper

Mark up the page with all six tools via drag-to-annotate and the contextual quick-box. Marks land anchored to exact PDF coordinates and the page never moves. This epic proves the spatial-anchor model holds across zoom (NFR-3) and defines the Annotation entity (AR-5).

> Restructured 2026-06-29 (correct-course, see `sprint-change-proposal-2026-06-29.md`): added a dev-infra enabler (Story 2.1) and split the foundation out of the original Story 2.1 into a dedicated Annotation-foundation story (Story 2.2), renumbering the six tool stories to 2.3–2.9 so number = execution order. Rationale: the original 2.1 bundled five net-new architectural pillars (`anchor/` service, `Annotation` entity, Zustand `store/`, `annotations/` overlay, quick-box shell) with the highlight feature — the foundation is the highest-leverage decision of the epic (Epic 1 retro PREP-1) and earns its own story. Standing principle applied across the anchor stories: **adopt stable primitives, don't reinvent wheels** (Epic 1 retro AP-4).

> Restructured again 2026-06-29 (correct-course, see `sprint-change-proposal-2026-06-29-tool-fsm.md`): the Story 2.3 live smoke found two design changes — tool state was two orthogonal fields (pan could eat an annotation drag) and there was no arm-time color pick. Inserted Story 2.4 (unify tool state into one `activeTool` FSM, AD-11) and Story 2.5 (arm-time color quick-pick) ahead of the remaining tool features, renumbering the old 2.4–2.9 to 2.6–2.11 so number = execution order. The FSM (PREP-3) lands first so the later tool stories build on one mutually-exclusive model.

> Restructured again 2026-06-29 (correct-course, see `sprint-change-proposal-2026-06-29-select-highlight.md`): the same Story 2.3 live smoke also found highlights are not selectable (no recolor/delete after creation), and Epic 3's Stories 3.1/3.3 silently assume a selection seam nobody builds. Added one AC to Story 2.4 (a rail click switches `activeTool` in a single click; a tool's quick-box never opens in place of the switch) and inserted Story 2.5 "Select a highlight (click-select, recolor, delete)" right after the FSM (AD-12), renumbering the old 2.5–2.11 to 2.6–2.12. Lightweight click-select + recolor/delete lands in Epic 2; drag-handle move/resize + text re-edit stay in Story 3.1.

### Story 2.1: Dev-infra enabler (local Docker dev loop)

As a developer,
I want the local Docker dev loop usable (writable data dir, live backend),
So that Epic 2's heavy iteration isn't blocked by stale containers or root-owned files.

> Enabler, not a product feature. Sequenced first so the rest of Epic 2 develops without the dev-experience friction surfaced in Epic 1 (`deferred-work.md`, 2026-06-29). No annotation code.

**Acceptance Criteria:**

**Given** `docker compose up`
**When** the container writes to the mounted `/data`
**Then** new files are owned by the host user (compose `user:` set, host dir pre-created), so the host user can edit/delete library files — not root-owned (AD-10; `deferred-work.md`)

**Given** a backend code change
**Then** the dev loop is documented: either (a) local dev = the host two-process flow (`uvicorn --reload` + `vite dev`) with Docker as the prod-like single-command boot, OR (b) a dev compose override bind-mounts `server/app` and runs `uvicorn --reload`; the decision is recorded in the dev docs (CLAUDE.md/README) so a stale container is never mistaken for a bug

**Given** the enabler
**Then** it changes no product behavior and touches no annotation code (Dockerfile / docker-compose / dev docs only)

### Story 2.2: Annotation foundation (anchor service + store + overlay)

As a reader,
I want a single mark to land anchored to exact PDF coordinates and survive zoom,
So that every annotation tool is built on one proven spatial foundation.

> The architectural through-line of the epic (AR-4/AD-4). Stands up `anchor/`, the `Annotation` entity, the Zustand `store/`, the `annotations/` overlay, and the quick-box shell — proven end-to-end by the simplest mark — so Stories 2.3–2.12 are thin features on top. Adopt stable primitives (Epic 1 retro AP-4/PREP-1).

**Acceptance Criteria:**

**Given** the rendered page box (AD-4)
**Then** the `anchor/` service provides normalized↔screen projection built on pdf.js `viewport.convertToPdfPoint` / `convertToViewportPoint` (adopt the stable primitive, do NOT hand-roll); `anchor/` is the ONLY home of that math (AD-9, NFR-3)

**Given** a text selection
**Then** text-run rects come from the native Selection API + `Range.getClientRects()` over the pdf.js text layer (stable primitive), normalized to canonical `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`, top-left origin, against the page box; screen position is derived, never persisted (AR-4, AR-9)

**Given** a created mark
**Then** it stores as `Annotation {id(uuidv4), doc_id, type, group_id, anchor(kind), style, body, created_at, updated_at}` keyed by `id` in the Zustand `store/` (AD-5, AD-7); rendering keys off `anchor.kind`, never `type`

**Given** the annotations overlay
**Then** it renders in the `annotations/` layer as an overlay that never reflows the canvas (NFR-1), and the `{component.quick-box}` shell exists (pops on drag-release; dismiss on pick, outside-click, or `Esc`) for every tool story to reuse (UX-DR5, UX-DR6, UX-DR16)

**Given** a selection spanning two pages
**Then** it splits into one annotation per page sharing a `group_id` (AR-4)

**Given** I zoom after creating the mark
**Then** it re-renders on the exact location across all zoom levels (NFR-3 proven on the simplest mark)

**Given** the tool-arm keys and overlay interactions
**Then** they follow the document-level handler convention (phase-gated, editable/buttons exempt) and distinguish armed/active/empty states with proper focus return (Epic 1 retro AP-1, PREP-3)

### Story 2.3: Highlight text via drag

> Builds on the Story 2.2 foundation: the anchor service, `Annotation` entity, store, and quick-box shell already exist; this story is the highlight feature on top.


As a reader,
I want to drag across text and drop a highlight,
So that I mark passages and the page never moves.

**Acceptance Criteria:**

**Given** the highlight tool armed (rail button or `H`)
**When** I drag across a text run and release
**Then** a highlight renders over the run at `{colors.annotation-default}` ~0.4 opacity, and the page does not shift or reflow (FR-7, FR-13, NFR-1, UX-DR7)

**Given** the drag selection
**Then** the anchor service produces a page-normalized anchor `kind=text {rects: Rect[], text}`, canonical `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`, top-left origin, against the rendered page box; screen position is derived, never persisted (AR-4, AR-9)

**Given** a created highlight
**Then** it stores as `Annotation {id(uuidv4), doc_id, type=highlight, group_id, anchor, style.color, created_at, updated_at}` keyed by `id`; rendering keys off `anchor.kind`, never `type` (AR-5)

**Given** a selection spanning two pages
**Then** it splits into one annotation per page sharing a `group_id` (AR-4)

**Given** drag-release
**Then** a `{component.quick-box}` pops at the selection with the color-swatch row; choosing a swatch recolors; it never shifts the canvas; dismiss on pick, outside-click, or `Esc` (UX-DR5, UX-DR6, UX-DR16)

**Given** I zoom after creating
**Then** the highlight re-renders on the exact text run across all zoom levels (NFR-3 proven)

### Story 2.4: Unify tool state (single activeTool FSM)

> Added 2026-06-29 via correct-course (`sprint-change-proposal-2026-06-29-tool-fsm.md`). Story 2.3 live smoke found that `mode` (cursor/hand/box) and `armedTool` (highlight) being two orthogonal states let pan and highlight both arm at once, so pan ate the highlight drag ("no reaction"). 2.3 shipped a surgical mutual-exclusion patch; this story replaces it with one finite-state model. Sequenced first so the remaining tool stories (2.7–2.12) build on it (Epic-1 retro PREP-3: design the overlay state machine once).

As a reader,
I want exactly one tool active at a time,
So that arming a tool never lets another (pan) swallow my gesture and the rail always shows one active tool.

**Acceptance Criteria:**

**Given** the reader
**Then** a single `activeTool` model (`cursor|hand|box|highlight|underline|pen|memo|comment`) is the one source of truth, mutually exclusive by construction, replacing App's `mode` + `armedTool` and reconciling the Story 2.2 overlay machine; the 2.3 surgical mutual-exclusion patch is removed in favor of the FSM with behavior preserved (AD-11)

**Given** any tool armed
**When** another is armed (rail or hotkey `V`/`Esc`/`H`/`U`/`D`/`T`/`C`/`M`)
**Then** the previous disarms; exactly one rail button reads active (cursor active in plain cursor mode, per the 2.3 #3 fix), via document-level handlers, phase-gated, editable/buttons exempt (AP-1)

**Given** the overlay
**Then** the transient quick-box machine (`armed/annotating/pending/empty`) is driven by the same model, not a parallel one (PREP-3)

**Given** the tool rail
**When** I click any tool button
**Then** `activeTool` switches to it in a single click and the rail reflects it immediately; a tool's quick-box (arm-time picker or recolor row) opens only when that tool is already active or on drag-release, never in place of the switch — so clicking cursor/selection while highlight is armed switches to cursor in one click and does NOT open a sub-toolbox (AD-11; fixes the Story 2.3 live-smoke single-click-switch issue)

**Given** existing behavior
**Then** highlight-on-drag (2.3), pan (`activeTool==="hand"`), zoom/scroll, and all current tests still pass; FSM transition unit tests added; no anchor/store/contract change (AD-9)

### Story 2.5: Select a highlight (click-select, recolor, delete)

> Added 2026-06-29 via correct-course (`sprint-change-proposal-2026-06-29-select-highlight.md`). Story 2.3 live smoke surfaced that highlights are not selectable — there is no way to recolor or remove a mark after creation. Epic 3 Stories 3.1/3.3 assume a "selected annotation" exists but nothing builds the hit-test + selected-state seam, and they assume cursor-mode drag-handles, not cross-mode click-select. This story builds the selection seam (AD-12) plus the lightweight recolor/delete edit; the heavier drag-handle move/resize and text re-edit stay in 3.1. Sequenced right after the FSM (2.4) because cross-mode click-select depends on the single `activeTool` model.

As a reader,
I want to click a highlight to select it and then recolor or delete it,
So that I can fix or remove marks without re-creating them.

**Acceptance Criteria:**

**Given** a rendered highlight
**When** I single-click it in cursor mode OR while a highlight tool is active
**Then** it becomes the selected annotation (single selection; one nullable `selectedId` in the store), hit-tested against its page-normalized rects via the anchor service (AD-4, recent-wins on overlap); clicking empty space or `Esc` clears selection (AD-12)

**Given** a selected highlight
**Then** its quick-box opens with the color-swatch row for recolor (reuses `recolorAnnotation` + `ColorSwatchRow` from 2.3) plus a delete affordance; recolor writes through the store; delete removes the mark by `id` and its `group_id` siblings across pages (AR-4)

**Given** a selected highlight
**When** I press `Del`/`Backspace`
**Then** it is deleted (IP-8); this delete path is the seed Epic 3's Story 3.3 reuses — no command stack / undo yet (those arrive in 3.2/3.3)

**Given** an active annotation tool
**Then** click-select vs new-create is disambiguated by hit-test: pointerdown on an existing mark selects it; pointerdown on empty text starts a create (consistent with the 2.4 `activeTool` FSM, AD-11)

**Given** the selection + delete
**Then** they stay client-side (`store/` + `annotations/` only); persistence and undo are deferred to Epic 3; no anchor/store/contract change beyond the `selectedId` UI state and a client delete action (AD-9 layering preserved)

**SCOPE GUARD:** lightweight edit only — NO drag handles, move, resize, or text re-edit. Those remain Story 3.1.

### Story 2.6: Arm-time color quick-pick

> Added 2026-06-29 via correct-course. Story 2.3's swatch row only recolors a mark *after* it is created; users expect to pick a color when arming the tool. Sequenced before the color tools (underline/pen) so they inherit it.

As a reader,
I want to pick the highlight color when I arm the tool,
So that new marks land in my chosen color without a recolor step.

**Acceptance Criteria:**

**Given** a color tool armed (highlight; later underline/pen)
**Then** the `{component.color-swatch}` row pops as an on-arm picker to set the **default** color for subsequent marks, distinct from the post-create recolor row (EXPERIENCE.md IP-1/IP-3, UX-DR5/DR6)

**Given** a chosen default
**When** I then drag a mark
**Then** it is created in that color (the create path reads the active color, not a hardcoded `annotation-default`); the default persists for the armed session

**Given** the post-create recolor row (2.3)
**Then** it still works; both read/write the same active-color state

**Given** the on-arm picker
**Then** it is keyboard-reachable, `Esc`-dismissable, and never shifts the canvas (NFR-1, UX-DR17); no anchor/contract change

### Story 2.7: Underline text

As a reader,
I want to underline text,
So that I emphasize lines without the page moving.

**Acceptance Criteria:**

**Given** underline armed (button or `U`)
**When** I drag across text and release
**Then** a 2px accent underline renders under the run via the same text-anchor path (FR-8, UX-DR7)

**Given** drag-release
**Then** the quick-box shows the color-swatch row (UX-DR5, UX-DR6)

**Given** zoom
**Then** the underline stays anchored across zoom levels (NFR-3)

### Story 2.8: Pen / freehand

As a reader,
I want to draw freehand on the page,
So that I can sketch marks beside the text.

**Acceptance Criteria:**

**Given** pen armed (button or `D`)
**When** I drag
**Then** a vector freehand stroke draws (perfect-freehand) and stores as `kind=path {points: {x,y}[]}` normalized, `type=pen` (FR-9, AR-5, IP-9)

**Given** drag-release
**Then** the pen quick-box offers color swatches + stroke-width steps; `style` carries `color` + `stroke_width` (path-only per AR-5) (UX-DR5, UX-DR7)

**Given** zoom
**Then** the stroke re-renders at correct scale and position (NFR-3)

### Story 2.9: Textbox memo

As a reader,
I want a free-floating memo,
So that I type a note onto the page without displacing the text.

**Acceptance Criteria:**

**Given** memo armed (button or `T`)
**When** I place a spot
**Then** an `{component.annotation-memo}` box with an inline `{component.text-input}` appears, and typed text does not displace page text (FR-10, UX-DR7)

**Given** the memo
**Then** it stores as `type=memo`, `anchor kind=rect {rect}`, `body=text` (non-null) (AR-5)

**Given** the memo quick-box
**Then** it offers inline text + color/size (UX-DR5)

**Given** zoom
**Then** the memo box stays anchored (NFR-3)

### Story 2.10: Comment (highlight + pin + bubble)

As a reader,
I want a comment anchored to a spot,
So that I attach a note that opens on click.

**Acceptance Criteria:**

**Given** comment armed (button or `C`)
**When** I drag across text and release
**Then** the run is highlighted (~0.4) AND a round `{component.annotation-comment-pin}` anchors at the spot (FR-11, UX-DR7)

**Given** the pin
**When** I click it
**Then** a `{component.comment-bubble}` opens for read/edit; it is keyboard-reachable, `Esc`-dismissable, and focus moves into it on open and returns on close (UX-DR8, UX-DR17)

**Given** the comment
**Then** it stores as `type=comment`, `anchor kind=text` (or rect), `body=text` (AR-5)

**Given** zoom
**Then** the highlight and pin stay anchored (NFR-3)

### Story 2.11: Box-select a region

As a reader,
I want to box-select an area,
So that I can mark a region, not just text.

**Acceptance Criteria:**

**Given** box-select armed (cursor flyout or `M`)
**When** I drag a rectangular region and release
**Then** a region annotation is created with `anchor kind=rect {rect}` (FR-12, AR-5)

**Given** drag-release
**Then** the region quick-box offers the region tool-type picker (highlight / comment; snapshot reserved for Phase 2) (UX-DR5)

**Given** the region
**Then** the overlay never reflows the page (NFR-1)

### Story 2.12: Drag-to-change-tool quick-box

As a reader,
I want a tool picker on drag in cursor mode,
So that I switch tool mid-annotation without going to the left rail.

**Acceptance Criteria:**

**Given** cursor/selection mode (no annotation tool armed)
**When** I drag across a text run and release
**Then** the `{component.quick-box}` pops a tool-type picker: highlight / underline / comment / memo (FR-14, UX-DR5)

**Given** the picker
**When** I choose a tool
**Then** the annotation is created in that tool's mode on the current selection, with no trip to the rail (FR-14)

**Given** the picker
**Then** it dismisses on pick, outside-click, or `Esc`, and never shifts the canvas (UX-DR5)

## Epic 3: Edit, persist & review

Make the annotated record durable and curatable: select, move, resize, restyle, re-edit, undo/redo, and delete — all through one command stack — plus autosave to disk with exact restore on reopen, and the Annotation Bank (list + click-to-jump).

### Story 3.1: Edit annotations (command path)

As a reader,
I want to select and edit a mark (move, resize, restyle, re-edit text),
So that I can refine annotations after creating them.

**Acceptance Criteria:**

**Given** cursor mode
**When** I click an annotation
**Then** it is selected with drag handles (IP-6, UX-DR14)

**Given** a selected annotation
**When** I drag a handle
**Then** it moves/resizes and the new geometry re-normalizes against the page box via the anchor service (FR-15, AR-4)

**Given** a selected annotation
**When** I re-open its quick-box
**Then** I can restyle the color; double-clicking a text/memo/comment annotation re-edits its text (FR-15, IP-6)

**Given** any edit (move/resize/restyle/retext)
**Then** it flows through the single client command stack; no component mutates annotations outside the command path (AR-7)

**Given** the editing state
**Then** handles and the restyle affordance show, and the canvas never reflows (UX-DR16, NFR-1)

### Story 3.2: Undo / redo

As a reader,
I want undo and redo,
So that I can reverse mistakes freely.

**Acceptance Criteria:**

**Given** a sequence of creates/edits/deletes
**When** I press `Ctrl Z` / `Ctrl Shift Z`
**Then** each is reversed/reapplied via the command stack (FR-16, AR-7, UX-DR15)

**Given** undo/redo
**Then** it is client-only, in-memory, and discarded on reload (AR-7)

**Given** a quick-box restyle reopen
**Then** it is itself a command and is undoable (AR-7)

### Story 3.3: Delete annotation

As a reader,
I want to delete a mark,
So that I can remove ones I no longer want.

**Acceptance Criteria:**

**Given** a selected annotation
**When** I press `Del`/`Backspace`
**Then** it is removed via the command path and leaves the canvas (FR-17, AR-7, UX-DR15)

**Given** a deleted annotation
**When** I undo
**Then** it is restored exactly (AR-7)

### Story 3.4: Autosave to disk

As a reader,
I want changes to save themselves,
So that I never think about saving.

**Acceptance Criteria:**

**Given** any annotation change (create/move/resize/restyle/retext/delete)
**Then** a dirty flag is set and a debounced autosave fires (FR-21, AR-7)

**Given** autosave
**Then** the client PUTs the full current annotation set to `/api/docs/{doc_id}/annotations`, single-flight (one in-flight PUT; edits during a flight set the dirty flag and trigger a follow-up PUT after it resolves) (AR-7, AR-11)

**Given** a PUT
**Then** the storage module overwrites `annotations.json` (whole-document) via atomic temp + rename, carrying `schema_version`; the backend has no history/undo/edit logic (AR-7, AR-8)

**Given** saving
**Then** `{component.save-indicator}` shows "Saving…" then "Saved" (success flash, settling to muted) (UX-DR12, UX-DR16, UX-DR18)

**Given** a save failure
**Then** `{component.toast}` shows "Couldn't save — changes kept in this session." and changes persist in session, retried on the next change (UX-DR13, UX-DR16, NFR-4)

### Story 3.5: Restore on reopen

As a reader,
I want every mark back exactly where I left it,
So that my annotated record is durable across sessions.

**Acceptance Criteria:**

**Given** a previously annotated PDF
**When** I open it
**Then** the client GETs `/api/docs/{doc_id}/annotations`, hydrates the store keyed by `id`, and renders every mark (FR-22, AR-6, AR-8)

**Given** restored marks
**Then** each re-renders at its exact PDF coordinates across all zoom levels (FR-22, NFR-3)

**Given** `annotations.json` with an unknown `schema_version`
**Then** the storage module rejects or migrates it rather than guessing (AR-8)

**Given** the prior session
**Then** every mark is present and nothing is silently lost (NFR-4)

### Story 3.6: Annotation Bank

As a reader,
I want a panel listing every mark with click-to-jump,
So that I can review and recall annotations instantly.

**Acceptance Criteria:**

**Given** a loaded document
**When** I press `Ctrl B` or the top-bar toggle
**Then** `{component.annotation-bank-panel}` (320px) opens/closes as a right overlay, never reflowing the canvas (FR-18, UX-DR9, NFR-1)

**Given** annotations exist
**Then** the Bank lists each as `{component.bank-list-item}` — type glyph + color dot + snippet + page — ordered by `created_at` ascending (FR-19, UX-DR9, AR-12)

**Given** no annotations
**Then** it shows "No annotations yet." (UX-DR9, UX-DR18)

**Given** a Bank row
**When** I click it
**Then** the canvas jumps to the annotation and the target flashes (degrading to instant under `prefers-reduced-motion`) (FR-20, UX-DR9, UX-DR17)
