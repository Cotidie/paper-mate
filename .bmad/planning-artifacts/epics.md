---
# Phase-1 run (Epics 1-5) and Library run (Epics 6-8) both completed all four steps.
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md
  - .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/addendum.md
  - .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md
  - DESIGN.md
  - EXPERIENCE.md
  - .bmad/specs/spec-paper-mate/SPEC.md
  - .bmad/planning-artifacts/briefs/brief-paper-mate-2026-06-27/brief.md
  # Library (Phase 2) run — added 2026-07-05
  - .bmad/planning-artifacts/prds/prd-paper-mate-library-2026-07-04/prd.md
  - .bmad/planning-artifacts/prds/prd-paper-mate-library-2026-07-04/addendum.md
  - .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md
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

**FG-F · Post-v1 polish & quality** *(added 2026-06-30 via correct-course — `sprint-change-proposal-2026-06-30.md`)*

> Surfaced during the Epic 1–2 build and logged in `.bmad/implementation-artifacts/deferred-work.md`. NOT in the original PRD FR-1..22; promoted here as **post-v1 (Phase-1.5)** scope grouped into Epic 4 (fidelity) and Epic 5 (preferences & polish). Recommend a matching PRD addendum so the PRD stays the FR source of truth. Fidelity bugs (copy-spaces, trailing-band, gutter-join, multi-column selection) and the on-page-treatment fixes are quality of existing FRs (FR-2/4/7/8/11) under NFR-3, so they are tracked as Epic-4 stories rather than new FRs; the small UX refinements (layered Esc, confirm-check, collapse stroke-width dropdown, dim ToC) are AC-level under existing UX-DRs.

- **FR-23** Hide/show ALL annotations at once — a view-only global visibility toggle (no mutation).
- **FR-24** Settings modal with custom **hotkey rebinding** (requires a keymap-as-data enabler).
- **FR-25** Per-tool remembered default color + user **custom color slots** (color-system extension).
- **FR-26** Adjust the **text range** of an existing text-anchored annotation (extend/shrink the run).
- **FR-27** **Convert** an annotation between highlight and comment, both ways.

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
- **FR-23** Hide/show all annotations toggle → Epic 5 (post-v1)
- **FR-24** Settings modal + hotkey rebinding → Epic 5 (post-v1; keymap-as-data enabler)
- **FR-25** Per-tool default color + custom color slots → Epic 5 Story 5.2 — **descoped from v1 (2026-07-02, product decision, never attempted; see `deferred-work.md`)**
- **FR-26** Adjust annotation text range → Epic 3 Story 3.8 — **attempted 2026-07-02, discarded on a hard Chromium `caretRangeFromPoint`/`caretPositionFromPoint` blocker during live smoke (see `deferred-work.md`); descoped from v1, open for a future revisit**
- **FR-27** Convert highlight ↔ comment → Epic 3 Story 3.7 (post-v1 slice on the command path)

> **Quality/fidelity (no new FR — quality of existing FRs under NFR-3):** copy-text spaces (FR-2/4) → Epic 4 Story 4.1; trailing-punctuation selection band (FR-2) → Epic 4 Story 4.1; highlights join across the gutter + multi-column selection (FR-7/13, NFR-3) → Epic 4 Story 4.2; comment-vs-highlight distinct on-page treatment + memo transparent treatment (FR-10/11, UX-DR7) → Epic 4 Story 4.3.

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
**FRs covered:** FR-15, FR-16, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22 (+ post-v1 FR-26, FR-27 added 2026-06-30)
**NFRs:** NFR-4 (durability), NFR-1 (Bank overlay)
**Architecture:** AR-6 (ownership), AR-7 (command stack + autosave), AR-8 (persistence), AR-9 (boundary)

### Epic 4: Reading & annotation fidelity (post-v1, Phase-1.5)
> Added 2026-06-30 via correct-course (`sprint-change-proposal-2026-06-30.md`), grouping the render/anchor correctness items from `deferred-work.md`. Make the CORE read+annotate surfaces render and select correctly: fix the pdf.js text-layer copy/selection bugs, make highlight/selection geometry column-aware (no gutter bridging), and give comment/memo marks distinct, non-obscuring on-page treatment. No new FRs — this is quality of FR-2/4/7/8/10/11 under NFR-3. Sequenced post-v1; pull a story earlier if a bug proves v1-blocking.
> **FRs covered:** none new (quality of FR-2, FR-4, FR-7, FR-8, FR-10, FR-11)
> **NFRs:** NFR-3 (anchor fidelity), NFR-2/NFR-5 (reading quality)
> **Architecture:** AR-4 (anchor geometry), AR-9 (render/anchor boundary)

### Epic 5: Reader preferences & polish (post-v1, Phase-1.5)
> Added 2026-06-30 via correct-course, grouping the preferences / color-system / UX-refinement / structural-refactor items from `deferred-work.md`. Add user-facing preferences (settings + hotkey rebinding, per-tool + custom colors, hide/show-all toggle), the small interaction-polish refinements (layered Esc, in-editor confirm, collapsed stroke-width control, dimmed ToC), and the standing codebase structural refactor (data contracts + conditional/FSM unification + src module split) as an enabler.
> **FRs covered:** FR-23, FR-24, FR-25 (post-v1)
> **NFRs:** NFR-1, NFR-5 (immersion), NFR-3 (unchanged by polish)
> **Architecture:** AR-3 (contract preserved by refactor), AR-6/AR-7 (doc-scoped store + autosave), AR-9 (layering), AD-11 (FSM)

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

### Story 2.13: Pen stroke alpha (transparency)

> Added 2026-06-29 via correct-course (user feature request). Pen (Story 2.8) draws a full-opacity vector stroke; the user wants pen marks to be semi-transparent like the highlighter by default, with an adjustable alpha. Appended as 2.13 (after the tool stories) so it does not renumber 2.9–2.12; it is a pen-style refinement that can land any time after pen.

As a reader,
I want to adjust a pen stroke's transparency,
So that my freehand marks sit over the text like a highlighter instead of hiding it.

**Acceptance Criteria:**

**Given** the pen tool armed
**Then** a new stroke lands at the DEFAULT alpha (= the highlighter opacity, `{component.annotation-highlight}` ~0.4), stored per-mark as `style.alpha` (AR-5; additive, backward-compatible contract field — pre-2.13 marks with no alpha fall back to the default) (FR-9)

**Given** the pen sub-toolbox (arm-time) AND a selected pen mark's quick-box
**Then** an alpha control adjusts the transparency (step set or slider); the live preview, the new stroke, and a recolor/restyle all reflect the chosen alpha; the choice is the sticky session default (last-choice-wins, like color/width) (UX-DR5/DR7)

**Given** zoom
**Then** the alpha-rendered stroke stays anchored and correctly scaled, alpha unchanged (NFR-3)

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

> Move/resize MUST cover EVERY mark geometry, not just text rects: a `kind=path` pen stroke (Story 2.8) moves by TRANSLATING all its normalized `points` (resize = scaling them); `kind=rect` marks move/resize the rect; `kind=text` marks per the run. (User feature request 2026-06-29 "pen movable when selected" → routed here, kept in 3.1 so move goes through the one command path + undo, AR-7, rather than a one-off pen mover.)

> **Deferred-work additions folded into 3.1 (2026-06-30 correct-course):**
> - **Memo CORNER drag-resize is the user's priority piece** (deferred-work 2026-06-29): a selected memo exposes corner handles for free resize (and body-drag to move). This is the memo case of the move/resize AC above — route it through the command path here, NOT the client-only 2.9 mutation. (The memo's transparent/no-color VISUAL treatment is a separate design slice → Epic 4 Story 4.3.)
> - **Route memo/comment text re-edit through the command path** (Story 2.9 code-review follow-up, dismissed for 2.9): the double-click re-edit AC above is the one command boundary for memo body, comment body, recolor, restroke, resize, and delete — no special-case client mutation survives once 3.1 lands.
> - **Cross-type unified hit-layer** (Story 2.7 deferred, MED): selection currently can't honor recent-wins ACROSS the two paint groups (an underline always hit-tests above a highlight on the same run). When 3.1 builds multi-type selection, separate hit-testing from the visual opacity grouping (one transparent `created_at`-ordered hit layer; paint groups stay `pointer-events:none`). Ties into Epic 5's structural refactor — coordinate.

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

### Story 3.7: Convert highlight ↔ comment

> Added 2026-06-30 via correct-course (deferred-work 2026-06-29, user request). A highlight and a text-comment are nearly the same mark (both `kind=text`; a comment is a highlight with non-null `body` + pin + bubble). Cheap two-way conversion is wanted. An edit of `type`/`body` → must flow through the command path (3.1/3.2), so it sits in Epic 3.

As a reader,
I want to turn a highlight into a comment and back,
So that I can add a note to a mark (or drop the note) without re-creating it.

**Acceptance Criteria:**

**Given** a selected highlight
**When** I choose "Turn into comment" in its quick-box
**Then** its `type` flips `highlight → comment` and `body` goes `null → ""` (gains a pin + opens the bubble); the `kind=text` anchor/rects are UNCHANGED; a two-page highlight converts ALL `group_id` siblings together (FR-27, AR-5)

**Given** a `kind=text` comment whose `body` becomes empty
**When** I deselect
**Then** it reverts to `type=highlight`, `body=null` (drops the pin/bubble); resolve the interaction with Story 2.10 Decision 5 (empty comment kept) and the empty-memo cleanup — a `kind=rect` comment (bare pin) is out of this revert (FR-27)

**Given** the conversion
**Then** it flows through the single command stack (do/undo, AR-7) via a `type`+`body` action (e.g. `retypeAnnotation`); no contract/anchor-MODEL change (`type` union + nullable `body` already exist); live-smoke a converted two-page mark at DPR>1 (NFR-3)

### Story 3.8: Adjust an annotation's text range

> Added 2026-06-30 via correct-course (deferred-work 2026-06-29, user request). Extend/shrink the run a text-anchored mark covers after creation. An anchor EDIT → command path, so Epic 3.

As a reader,
I want to drag a text mark's start/end to cover more or fewer words,
So that I can fix a highlight/underline/comment range without redrawing it.

**Acceptance Criteria:**

**Given** a selected text-anchored mark (highlight/underline/comment)
**When** I drag a start/end handle
**Then** the covered text is re-resolved and the `kind=text` anchor (`rects` + `text`) rebuilt to the new range via the anchor layer (`rectsFromSelection`/`collectTextRects`); pen (`kind=path`) and rect marks are OUT of scope (FR-26, AR-4)

**Given** a re-range that crosses (or stops crossing) a page boundary
**Then** the `group_id` siblings are added/removed so the mark still = one annotation per page (AR-4); this cross-page case MUST be live-smoked at DPR>1 (the recurring full-page-leak risk)

**Given** the re-range
**Then** it flows through the command stack (do/undo, AR-7); the `TextAnchor` shape is unchanged (only its `rects`/`text` values are rewritten) — no contract/anchor-MODEL change (AR-3, AR-9)

## Epic 4: Reading & annotation fidelity (post-v1, Phase-1.5)

> Added 2026-06-30 via correct-course (`sprint-change-proposal-2026-06-30.md`). Groups the render/anchor correctness items surfaced in `deferred-work.md` during the Epic 1–2 build. Theme: the core read+annotate features WORK but have fidelity defects (text copies without inter-line spaces, selection bands render thick on trailing punctuation, same-line highlights bridge the column gutter, multi-column drag-select intrudes the other column, comment fill is indistinguishable from a highlight). Fix correctness, do not add capability. No new FRs. Sequenced post-v1; promote any single story to v1-blocking if it materially degrades core reading.

### Story 4.1: Text-layer copy & selection fidelity

> deferred-work: "copied text loses spaces at line breaks" + "trailing punctuation renders a thick selection band". Same root family — our custom text layer omits the pdf.js viewer's EOL whitespace + `endOfContent` handling.

As a reader,
I want copied text to keep its spaces and selections to look uniform,
So that copying a passage and selecting across lines behaves like a normal PDF reader.

**Acceptance Criteria:**

**Given** a multi-line selection
**When** I copy it
**Then** inter-line whitespace is preserved (words that wrap across a line break do NOT fuse); `selection.toString()` (and any stored `anchor.text`) matches the source text (FR-2, AR-2)

**Given** a selection that includes a line-ending mark (e.g. a trailing period)
**Then** its `::selection` band is the same height/weight as the rest of the run (no thick band) (FR-2)

**Given** the fix
**Then** it reproduces pdf.js's text-layer copy/selection handling (EOL whitespace + `endOfContent` element, mirroring `TextLayerBuilder`) and lives in `render/` only — no annotation/anchor change; highlight/underline geometry (per-line rects) is unaffected (AR-9)

**Given** the parallel test suite
**Then** the pre-existing flaky `Reader.test.tsx` Ctrl+wheel test (deferred-work 2026-06-29) is de-flaked here (flush the wheel-binding effect before dispatch / assert via `waitFor`) as a small co-located cleanup

### Story 4.2: Column-aware selection & highlight geometry

> deferred-work: "highlights on the same line across the two columns join across the gutter" (`mergeRects` unions by vertical overlap only) + the reverted "multi-column selection controller" (a drag in one column intrudes the other). Shared root: no column model. The user's direction is a LAYERED controller (cursor logical position → emitted column/line → selection on top), built once and reused by selection, copy, and highlight create.

As a reader,
I want selection and highlights to respect column boundaries,
So that a drag stays in its column and a same-line highlight never bridges the gutter.

**Acceptance Criteria:**

**Given** two text runs on the same visual line in different columns
**When** a highlight/selection covers one
**Then** `mergeRects` does NOT union across a large horizontal gap (the gutter) — each column gets its own band; the fix stays in `anchor/` behind the `Rect[]` contract so highlight/underline/preview all inherit it (FR-7, FR-13, NFR-3, AR-4)

**Given** a drag-select inside a two-column body
**Then** it stays within the pointed column (a projection-profile column detector + per-column line model); cross-column selection is expressed in reading order, column by column

**Given** the controller
**Then** it lives in ONE module with a narrow contract (cursor logical position → emitted column/line) that selection, copy, and highlight create-on-release (`rectsFromSelection`) consume — not spread across `render/`/`anchor/`/`annotations/`; design it before coding (own story already; see deferred-work history of the 4 failed patch attempts)

**Given** any column geometry change
**Then** it is live-smoked with a cross-column same-line selection AND a cross-page selection at DPR>1 (jsdom zeroes rects)

### Story 4.3: Distinct, non-obscuring on-page mark treatment — DESCOPED from v1 (2026-07-02)

> **DESCOPED (2026-07-02, product decision, never attempted).** No longer needed for v1; not built. `sprint-status.yaml` marks it `blocked` so Epic 4 can still close after 4.2 merges. The spec below is retained as the source if it is ever re-promoted (see `deferred-work.md` "Descoped: Story 4.3").
>
> deferred-work: "a text-comment must read differently from a plain highlight, and not obscure the text" + the memo revised direction ("drop memo color, black border + transparent background"). Both are `style-on-type` paint changes (AD-5), token-driven.

As a reader,
I want comment and memo marks to look distinct and keep the text readable,
So that I can tell a highlight from a comment at a glance and a memo doesn't hide the page.

**Acceptance Criteria:**

**Given** a `type=comment` `kind=text` mark
**Then** it paints differently from a plain highlight (e.g. lower-alpha fill + accent border, or a hatch/underline treatment — decide among the deferred-work options) so highlight / underline / comment read as three distinct treatments, and the underlying text stays legible (FR-11, UX-DR7, AD-5)

**Given** a memo box
**Then** its color row is dropped and it renders with a `{colors.ink}` (black) border and TRANSPARENT background (text floats over the page); `style.color` stays on the model (contract unchanged) but stops driving the memo's paint (FR-10, UX-DR7)

**Given** the treatments
**Then** they are token-driven (new `--annotation-comment-*` / memo tokens, no raw values), updated in DESIGN.md as the source, and re-smoked at DPR>1 incl. cross-page; AD-5 holds (geometry-on-kind, style-on-type)

## Epic 5: Reader preferences & polish (post-v1, Phase-1.5)

> Added 2026-06-30 via correct-course. Groups the preferences, color-system, interaction-polish, and structural-refactor items from `deferred-work.md`. Theme: let the reader tune the app and make the chrome recede further, plus pay down the structural debt the tool stories accrued. Post-v1.

### Story 5.0: Codebase structural refactor (data contracts + conditional/FSM unification + src split)

> deferred-work: "lean on data classes", "unify conditional logic + FSM-isolated state", "src folder structural refactoring" — ONE refactor thread. **Sequencing note:** this is ideally done at the Epic-2/Epic-3 boundary (before 3.1 builds the command path on the current sprawl). It is tracked in Epic 5 for grouping, but pull it EARLIER if Epic 3 work is blocked by the sprawl. No behavior/contract change.

As a developer,
I want the annotation code unified behind data contracts, a per-tool descriptor/FSM, and a clean module split,
So that adding a tool or an edit is one registration, not edits across five `if` chains.

**Acceptance Criteria:**

**Given** the per-tool/per-kind conditional sprawl (`AnnotationLayer`/`AnnotationInteraction`/`create.ts`/`store`)
**Then** it is unified behind ONE descriptor/registry keyed on `anchor.kind` + `type` (AD-5 as the dispatch key), so a new tool registers one entry; the near-twin builders and `set()` blocks consolidate (AR-9)

**Given** recurring loose shapes (create-options twins, `active*`/`setActive*`/`*Ref` fans, point/rect math)
**Then** they become typed data contracts (one "create request" per tool, one "active-tool defaults" object — ties into Story 5.2, narrower prop bundles); any data class WRAPS the generated `Annotation` type, never shadows it (AR-3)

**Given** the fragmented interaction state (selection / quick-box / pen-draft / memo-cleanup / flyout / Esc across components)
**Then** the overlay lifecycle consolidates into one explicit FSM (extends `machine.ts`, AD-11/PREP-3); the duplicated App+overlay Esc logic collapses (enables Story 5.6 layered Esc)

**Given** the refactor
**Then** client + server suites stay green and the tracked OpenAPI contract is byte-identical; both `vi.mock("./render")` barrels updated if any `render/` export moves; `no-raw-values` re-run after CSS moves; its own PR(s), never folded into a feature story

### Story 5.1: Settings modal + custom hotkey rebinding

> deferred-work: "Settings modal in the toolbox (hotkey rebinding first)". The real cost is the keymap-as-data enabler; the modal UI is secondary.

As a reader,
I want a Settings modal where I can rebind hotkeys,
So that the keyboard map fits my habits.

**Acceptance Criteria:**

**Given** the hard-coded `e.key === "h"` keydown literals in `App.tsx`
**Then** they are first refactored into a single keymap data structure (action → binding, a store slice + a `useKeymap` lookup) the document keydown reads — the enabler that makes rebinding possible (FR-24, AD-11)

**Given** a Settings affordance in the toolbox/tool-rail (Phosphor `Gear`/`Sliders`)
**When** I open it
**Then** a focus-trapped, `Esc`-dismissable `{component}` modal opens with a keybinding pane listing every action (UX-DR15 map) and a "press a key" capture field per action (exempt from the global tool keys while capturing) (FR-24, UX-DR17)

**Given** a rebind
**Then** conflict detection blocks two actions on one key, a reset-to-defaults exists, browser/OS-critical combos are reserved; preferences persist in `localStorage` (app-global, not per-doc `~/.paper-mate`); token-driven, no em-dash in copy; no contract change (FR-24)

### Story 5.2: Color system — per-tool default + custom slots — DESCOPED from v1 (2026-07-02)

> **DESCOPED (2026-07-02, product decision, never attempted).** No longer needed for v1; not built. `sprint-status.yaml` marks it `blocked` so Epic 5 can still close once its remaining stories reach `done`. The spec below is retained as the source if it is ever re-promoted (see `deferred-work.md` "Descoped: Story 5.2").

> deferred-work: "per-tool remembered default color" + "custom color slot(s) + color picker, cached in the browser". Both reshape the single shared `activeColor`; do together.

As a reader,
I want each tool to remember its own color and to add custom colors,
So that changing the highlight color doesn't change the pen, and I'm not limited to the fixed palette.

**Acceptance Criteria:**

**Given** the single shared `activeColor` (one store field, every tool writes it)
**Then** it becomes a per-tool map (`activeColorByTool` + `setActiveColor(tool, color)`); the create path reads the armed tool's color; each flyout shows/sets its own; recolor updates that mark's `type` only; the selection quick-box still shows the SELECTED mark's own color (FR-25)

**Given** a "More colors" affordance at the tail of every `ColorSwatchRow` (highlight/underline/pen/memo flyouts + selection quick-box)
**When** I pick a custom color
**Then** it slides into the row tail as a fixed-count FIFO window (newest appended, oldest off), persisted in `localStorage`; decide the window size and whether the named defaults can rotate off (FR-25)

**Given** the custom-hex contract risk
**Then** custom colors map to runtime CSS vars (`--color-annotation-custom-N`) seeded from `localStorage` at boot (PREFERRED — keeps `style.color` a token name, no contract break, stays in `theme/` + `annotations/`); `no-raw-values` is honored (hex routed through the theme layer, never inlined) (AR-3, AR-12)

### Story 5.3: React client structural refactor — modularize Reader/AnnotationLayer/AnnotationInteraction

> User request (2026-07-02): `Reader.tsx`, `AnnotationLayer.tsx`, and `AnnotationInteraction.tsx` have bloated since Story 5.0's gesture-hook extraction (2293 combined lines). Modularize further, deduplicate, remove dead code. A pure refactor thread, same footing as Story 5.0 — its own PR(s), never folded into a feature story.

As a developer,
I want `Reader`/`AnnotationLayer`/`AnnotationInteraction` split into cohesive, single-responsibility modules with no dead code or duplication,
So that the overlay/reader composition root stays legible and the next tool/story doesn't have to wade through three 600-800 line files to find where it hooks in.

**Acceptance Criteria:**

**Given** `Reader.tsx` / `AnnotationLayer.tsx` / `AnnotationInteraction.tsx` (2293 combined lines post-5.0)
**Then** each is decomposed into smaller, cohesive units (extracted hooks/components/pure helpers) along the SAME OOP/encapsulation approach Story 5.0 chose (each concern owns its own state/refs, not a shared conditional sprawl); no god-component remains the dumping ground for unrelated concerns

**Given** the extraction
**Then** duplicated logic (across these 3 files AND vs. the existing `gestures/`/`render/`/`anchor/` layers) is consolidated to one definition; dead code (unreferenced exports, stale branches, superseded comments) is deleted, not left "just in case"

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json`/`schema.d.ts` byte-identical, both `vi.mock("./render")` barrels updated if any export moves, re-smoked live at DPR>1 cross-page (the standing `annotations/` selection-geometry risk)

**Given** AD-9 layering (`render/` → `anchor/` → `annotations/` → `App`) and the zero-import-leaf convention (`tools.ts`, `domFocus.ts`)
**Then** the new module boundaries respect it; no upward imports introduced

### Story 5.4: React client `src/` module layout (folder-structure refactor)

> User request (2026-07-02): `client/src/` root is flat: 38 files (`.tsx`/`.ts`/`.css`/`.test.*`) piled beside the existing layer dirs (`anchor/`, `annotations/`, `render/`, `store/`, `api/`, `reader/`, `settings/`, `theme/`). Adopt the `/scaffold-react` folder convention (adapted to this Vite + TS + Zustand stack): colocate each component with its CSS + test, give hooks and pure leaves a home, keep only entry/config files at the root. A pure refactor thread, same footing as Story 5.0 / 5.3, so it gets its own PR(s), never folded into a feature story. No behavior/contract change.

As a developer,
I want `client/src/` reorganized into the scaffold-react folder layout instead of 38 flat root files,
So that a component, hook, or helper lives in an obvious place and the root stops being a dumping ground.

**Acceptance Criteria:**

**Given** the flat `client/src/` root (component `.tsx` + colocated `.css` + `.test.tsx` for `Reader`/`BankPanel`/`EmptyDropzone`/`SaveIndicator`/`Toast`/`TocPanel`/`ToolRail`/`ToolFlyout`/`ZoomControl`, plus loose `bank.ts`/`tools.ts`/`domFocus.ts`/`uuid.ts`/`useAutosave.ts`/`useLiveRef.ts` and their `.test.*` siblings)
**Then** each reusable component moves into `components/<Name>/` (its `.tsx` + `.css` + `.test.tsx` colocated, one folder per component, per the scaffold-react convention); hooks (`use*`) get a hooks home; pure zero-import leaves (`tools.ts`, `domFocus.ts`, `uuid.ts`, `bank.ts`) get a `lib/`-style home, so no reusable component or helper is left loose at the root

**Given** this repo's stack differs from the CRA source scaffold (Vite + TS + Zustand + generated tokens; a single-view reader with no `react-router` `pages/`)
**Then** the scaffold's ARCHITECTURE is adapted, not copied literally: the existing AD-9 layer dirs (`render/`, `anchor/`, `annotations/`, `store/`, `api/`, `reader/`, `settings/`, `theme/`) are preserved as-is (they already ARE the modular boundaries), only the flat root files are foldered, and no toolchain / token / generated-file / Storybook rules are introduced or changed (scaffold rule: preserve the target toolchain)

**Given** the entry + composition-root files (`main.tsx`, `App.tsx`/`App.css`, `index.css`, `vite-env.d.ts`) and the cross-cutting guard suites (`no-raw-values.test.ts`, `focus-ring.test.ts`)
**Then** the entry + `App` root stay at `src/` root (the scaffold keeps the app entry at root); the guard suites land wherever keeps their file-globbing valid; every moved file's imports AND every importer are updated, including both `vi.mock("./render")` barrels (`App.test`, `Reader.test`) fixed for their new relative paths

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` byte-identical, `no-raw-values` re-run after any CSS move, no upward imports introduced (AD-9 downward-only layering), and re-smoked live at DPR>1 cross-page (the standing `annotations/` selection-geometry risk); its own PR(s), never folded into a feature story

### Story 5.5: Hide/show all annotations toggle

> deferred-work: "hide/show all annotations toggle".

As a reader,
I want one toggle to hide/show ALL annotations,
So that I can read the clean page and bring my marks back.

**Acceptance Criteria:**

**Given** a top-bar `top-bar__actions` icon button (Phosphor eye / eye-slash, `aria-pressed`, plain `title`/`aria-label`, no em-dash)
**When** I toggle it OFF
**Then** the overlay paints NOTHING and marks are not pointer-interactive (no hover/select); the underlying text stays selectable; ON restores everything unchanged (FR-23, NFR-1)

**Given** the toggle
**Then** it is ONE global view-only flag (composition root or store, sibling of `activeTool`/`selectedId`), threaded to `AnnotationLayer` (skip render) and `AnnotationInteraction` (suppress create/select while hidden); it NEVER mutates/deletes an annotation; clear `selectedId` on hide; decide whether the flag survives reload (FR-23)

### Story 5.6: Interaction polish — layered Esc, in-editor confirm, collapsed stroke-width

> deferred-work: "layered Esc", "confirm (check) affordance on memo + comment editors", "collapse the pen stroke-width row into a single dropdown". Small UX refinements; layered Esc depends on Story 5.0's Esc consolidation.
>
> **2026-07-03 RESCOPE (user decision):** shipped as **layered-Esc ONLY**. AC-2 (in-editor confirm check) and AC-3 (collapsed pen stroke-width dropdown) below are **DISCARDED** — not built, not deferred. Kept here (marked) for provenance; the delivered scope is AC-1. See `.bmad/implementation-artifacts/epic-5/5-6-interaction-polish-esc-confirm-strokewidth.md`.

As a reader,
I want Esc to do the most-local thing, an explicit confirm on note editors, and a compact stroke-width control,
So that the annotate interactions feel precise and uncluttered.

**Acceptance Criteria:**

**Given** an `Esc` press
**Then** it resolves in priority order, consuming the event at the first match: (1) an open/edited transient box (empty memo removed, non-empty blurs) → cancel it; (2) else a selected mark → clear selection (stay in tool); (3) else → return the tool to cursor — so the FIRST Esc clears selection without disarming, a SECOND returns to cursor (UX-DR15; builds on Story 5.0)

**Given** the memo (`MemoBox`) and comment (`CommentBubble`) editors
**Then** each gets a check (Phosphor `Check`) confirm control that commits `body` and exits; preserve multi-line input (bind the button + `Ctrl/Cmd+Enter`, keep plain `Enter` as newline, or `Enter` confirms + `Shift+Enter` newline — pick one); keyboard-reachable, token icon, no em-dash; same `retext`/`clearSelection` path, no contract change (UX-DR8, UX-DR17)

**Given** the pen `StrokeWidthRow` (three preset dots in a row)
**Then** it becomes a compact collapsible control (trigger shows current width + caret → vertical thin/medium/thick list; pick collapses) matching the memo `SizeRow` pattern; update the Story 2.8 tests that asserted all three step buttons visible; presentation only, no model/contract change

### Story 5.7: Dim the Table-of-Contents panel until hovered — DESCOPED from v1 (2026-07-03)

> **DESCOPED (2026-07-03, product decision, never attempted).** No longer needed for v1; not built. `sprint-status.yaml` marks it `blocked` so Epic 5 can still close once its remaining stories reach `done`. The spec below is retained as the source if it is ever re-promoted (see `deferred-work.md` "Descoped: Story 5.7").

> deferred-work: "dim the Table-of-Contents panel until hovered". UX polish toward immersion (NFR-5).

As a reader,
I want the ToC panel dimmed at rest and full on hover,
So that it recedes while reading but is there when I reach for it.

**Acceptance Criteria:**

**Given** the `TocPanel` (Story 1.9) at rest
**Then** it sits at ~0.4 opacity and lifts to full opacity on `:hover`/`:focus-within` with a short transition; it stays clickable at rest (default read) (UX-DR11, NFR-5)

**Given** the fade
**Then** it respects `prefers-reduced-motion` (degrade to instant, UX-DR17), is token-driven (`--toc-panel-resting-opacity`, no raw values), and changes nothing in the contract/store — pure presentation

### Story 5.8: Doc-scope the annotation store (retire the cross-doc autosave guard)

> Correct-course 2026-07-02 (`sprint-change-proposal-2026-07-02.md`), closing action items AE-4 / AE3-3. The store holds `annotations` without owning which doc they belong to, so autosave leans on a `useAutosave` `generationRef` guard to stop one doc's marks flushing onto another across a doc switch (the Story 3.4 HIGH Codex finding). Make ownership atomic instead. A developer refactor story: no new FR, no contract change. Needs a doc-switch DPR>1 live smoke (AE-5) before done.

As a developer,
I want the store to own `(docId, annotations)` as one atomic unit,
So that a doc switch swaps both together and autosave can bind to the store's own `docId` instead of a defensive generation-counter guard.

**Acceptance Criteria:**

**Given** the store holds `annotations` without the owning `docId`, and `useAutosave` uses a `generationRef` to guard a stale flush from landing on the wrong doc (AR-6, the Story 3.4 HIGH finding)
**Then** the store owns `(docId, annotations)` atomically: opening/switching a doc sets both in one update, hydrate-on-open replaces both, and there is no window where `annotations` belong to one doc while `docId` reads another

**Given** the atomic ownership
**Then** autosave binds to `store.docId` (a flush targets the doc the store currently owns), and the `useAutosave` `generationRef` cross-doc guard is deleted, not left as a redundant belt-and-braces check (AR-6, AR-7)

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` byte-identical, and it is live-smoked across a doc SWITCH at DPR>1 (open doc A, annotate, open doc B, confirm A's marks never flush onto B and B restores its own) (AE-5, AR-6)

---

# Paper Mate Library (Phase 2)

> Added 2026-07-05 via `bmad-create-epics-and-stories`. Scope = the **Library** epic from `prd-paper-mate-library-2026-07-04` (+ addendum) and `architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md`. Phase-1 Epics 1-5 above are unchanged and stay `done`. Library requirements are namespaced (**LFR / LNFR / AL / L-UX-DR**) so they never collide with Phase-1 FR-1..27; each **LFR-n maps 1:1 to the Library PRD's FR-n**. Sync (F8, LFR-25..29) is captured but **deferred to a follow-on epic**, not built this sprint.

## Library Requirements Inventory

### Library Functional Requirements

Namespaced `LFR-n` = Library PRD `FR-n` (1:1).

**F1 · Collection & table view**

- **LFR-1** The Library is the app's default landing view on boot, listing all papers in the collection as a table.
- **LFR-2** The table shows columns Title, Authors, Added, and File type, and displays the total count ("N files in library").
- **LFR-3** Rows are multi-selectable via checkboxes for batch actions (move to folder, delete).
- **LFR-4** A Display control toggles column visibility.
- **LFR-5** A Sort control orders rows by any column, ascending or descending.
- **LFR-6** A Filter control narrows visible rows by column value.

**F2 · Add papers (upload + metadata extraction)**

- **LFR-7** The user adds papers by uploading one or more PDF files at once (bulk).
- **LFR-8** On upload, Title and Authors only are extracted from the PDF locally (embedded metadata + text); Added timestamp and File type are set automatically. Year/journal/abstract are not columns this sprint.
- **LFR-9** An optional external lookup (Crossref / Semantic Scholar) enriches or corrects metadata. Offline or on failure it never blocks the upload: the paper keeps its locally-parsed fields and a non-error notice reports enrichment was skipped.
- **LFR-10** If extraction yields nothing, the paper still enters the collection with best-effort or empty fields (filename as title). A paper is never lost to a failed parse.
- **LFR-11** Title and Authors are editable inline to correct extraction.

**F3 · Folders**

- **LFR-12** The user creates, renames, and deletes custom folders in the left panel; folders nest.
- **LFR-13** Each paper belongs to at most one folder. Papers with no folder appear in an All / Uncategorized view.
- **LFR-14** Selecting a folder filters the table to that folder's papers.
- **LFR-15** The user assigns or moves a paper (or a multi-selection) to a folder.
- **LFR-16** Deleting a folder deletes its whole subtree and re-homes every paper in that subtree to Uncategorized; it never deletes the papers (ratifies PRD A1, AL-5).

**F4 · Notes**

- **LFR-17** The data model and table support a "Note" file-type distinct from PDF documents, reserved and displayed. In-app note authoring is out of scope this sprint.

**F5 · Open in annotator**

- **LFR-18** Double-clicking a paper row opens it in the annotator; the reader is entered from the Library, not from an ad-hoc disk picker.
- **LFR-19** Each paper has a stable `doc_id`; opening it restores its existing annotations through the inherited doc-scoped annotation store (Story 5.8 / 3.5 seam). Annotations made in the reader belong to that Library paper.
- **LFR-20** From the reader, the user returns to the Library.

**F6 · Persistence**

- **LFR-21** The collection, folder structure, per-paper metadata, and folder assignments persist under `~/.paper-mate` and survive restart.

**F7 · Delete / Trash**

- **LFR-22** Deleting a paper (or a multi-selection) moves it to a Trash view (soft delete); its annotations are retained.
- **LFR-23** A Trash item is restorable to the collection.
- **LFR-24** Purging a Trash item removes the paper and its annotations permanently.

**F8 · Remote sync: DEFERRED (captured, NOT built this sprint; follow-on epic with its own discovery)**

- **LFR-25** Settings exposes a Sync configuration: pick a backend, enter connection details (WebDAV first; Google Drive later).
- **LFR-26** When sync is configured, the app pulls the remote library, merges with local, and pushes the result to converge across devices.
- **LFR-27** Sync mirrors the whole `~/.paper-mate` data directory (PDFs + metadata + folders + annotations) as one unit.
- **LFR-28** Conflicts resolve last-write-wins by timestamp.
- **LFR-29** Sync backends sit behind one switchable interface (WebDAV first, Google Drive later), mirroring the reserved agent-abstraction seam.

**F9 · Recent & Starred views (added 2026-07-07 via correct-course; not in the original Library PRD)**

> These two requirements were added after Epic 7 was underway, by user request (`sprint-change-proposal-2026-07-07.md`). They light up the two inert left-panel placeholders (`Recent`, `Starred`) that Story 7.1 shipped disabled, completing the fixed Library section. They replace the discarded Note file-type (LFR-17) as the remaining Epic-7 work.

- **LFR-30** A **Recent** view lists the papers the user has most recently opened, ordered most-recent-first, capped at the last 50. Selecting the left-panel `Recent` entry shows this view.
- **LFR-31** The user **stars** or unstars a paper (or a multi-selection). A starred paper shows a filled-star marker at the end of its title in the table, and the left-panel `Starred` entry lists all starred papers.

### Library NonFunctional Requirements

- **LNFR-1 Local-first.** Every Library feature works fully offline. The optional external metadata lookup is the only network call; opt-in, degrades gracefully offline or on failure.
- **LNFR-2 No auth.** Localhost, single user, no accounts (consistent with the app).
- **LNFR-3 Non-blocking add.** Uploading a batch of PDFs never freezes the table: extraction runs off the interaction path, rows appear as they resolve, and the user can keep browsing while extraction continues.
- **LNFR-4 Collection scale.** For a realistic personal collection of hundreds of papers, sort, filter, and scroll act without a visible stall.
- **LNFR-5 Durable, forward-compatible store.** Library metadata + folder structure persist under `~/.paper-mate` in an additive-tolerant format. A breaking schema change is an AD-8-class persisted-format break and takes a MAJOR version bump.
- **LNFR-6 Safe copy-in.** Copying an uploaded PDF into the collection never corrupts or loses the original; a failure mid-copy leaves the collection consistent.

### Library Additional Requirements

Technical requirements from the Library architecture spine (`AD-Ln`, surfaced here as `AL-n`) plus the parent invariants it inherits. **No new starter template**: the Library extends the existing greenfield scaffold; Epic 6 Story 1 stands up the router split + backend domain seam.

- **AL-1 (AD-L1) Collection store & authority split**: `~/.paper-mate/library.json` is the authoritative index for cross-doc state (folder tree incl. empty folders, membership paper→≤1 folder, trash state, inclusion + order). Per-doc `meta.json` stays authoritative for a paper's own fields (title, authors, added, page_count, file_type, status). `library.json` MAY carry a non-authoritative title/authors display cache (meta wins, refreshed on write) so the table renders in one read (LNFR-4). Boot reconcile: dir-without-index → add as Uncategorized; index-without-dir → prune. `schema_version`, additive only.
- **AL-2 (AD-L2) Metadata extraction on the backend**: a bounded, **pure** domain module (`server/app/domain/`, first tenant). `extract(pdf_bytes) → ExtractedMeta` (rung 1 embedded `/Info`+XMP, rung 2 font-size heuristic; **PyMuPDF** in-process, GROBID-swappable later) and `enrich(meta) → meta | "skipped"` (rung 3 external, **Crossref DOI-first then title/authors fallback**; offline/failure → `"skipped"`, never blocks). Both best-effort (failed parse → filename-title, never lost). Runs as a **background task**, never on the request path (LNFR-3); client learns results by **polling `GET /api/library`**. Storage stays the only writer: extraction returns data, storage persists.
- **AL-3 (AD-L3) Client routing / front-door flip**: **React Router in library/data mode** (`createBrowserRouter`), **not** framework mode (excluded by AD-2). Exactly two routes: `/` (Library home, boot landing) and `/reader/:docId`. Folder selection, sort/filter, and **Trash are view-state inside the Library route, not routes**. Settings stays a modal. Router owns navigation/history only, not collection/domain state.
- **AL-4 (AD-L4) Bulk-add flow & idempotent upload**: one **`POST /api/docs` per PDF**, client-throttled (concurrency cap ~4); each returns an optimistic row immediately (`doc_id`, title=filename, `status: extracting`). Status `extracting → ready | enrich-skipped | parse-failed`; client polls `GET /api/library` until all settle, then stops. Failure splits: store failure rejects that one file; parse failure enters filename-title, editable, never lost. **Idempotent dedupe by `doc_id`** (AD-8): re-upload creates no duplicate; a re-upload of a **trashed** paper restores it. Existing `annotations.json`/`meta.json` never overwritten. Safe copy-in = atomic temp+rename (LNFR-6).
- **AL-5 (AD-L5) Trash & folder lifecycle**: soft-delete flips `trashed` in `library.json` (annotations untouched, retains folder membership while trashed); restore clears it (returns to remembered folder, else Uncategorized); purge deletes the whole `{doc_id}/` dir + entry + annotations (manual only, no auto-purge); delete-folder = whole subtree, every paper in it → Uncategorized, never deletes papers; each paper ≤1 folder.
- **AL-6 (AD-L6) API boundary: document vs organization**: one entity (`doc_id`), two concern-scoped surfaces: **`/api/docs/{doc_id}`** = the document (`GET /api/docs` list, `POST /api/docs` upload/create: keeps the shipped import route, `GET`/`PATCH` own metadata, `DELETE` = **purge**, `GET .../file`, `GET`/`PUT .../annotations`); **`/api/library`** = organization (`GET /api/library` = table via display cache + poll target, `/api/library/folders` CRUD with subtree delete, set-based `POST /api/library/move | trash | restore` taking `{doc_ids}`). Trash is organizational (`/api/library`); purge destroys the document (`DELETE /api/docs/{id}`). All under AD-3 generated types + inherited `{detail}` error envelope.
- **AL-7 (AD-L7) Collection-index write concurrency**: storage **serializes all `library.json` mutations** (read-modify-write of the whole index under a process-level lock), so a background extraction cache-refresh never interleaves with a user move/trash/restore or a same-batch duplicate create. Per-`doc_id` creation serialized + idempotent (same bytes → one dir). Whole-file atomic write stands. Narrows inherited AD-6 "no concurrency" (still single user, now intra-process background work).
- **AL-8 Inherited invariants (read-only, from the initiative spine)**: AD-1 client never touches the filesystem, all upload/persistence via the API; AD-3 Pydantic → OpenAPI → generated TS types (all new Library API types generated); AD-6 filesystem is the source of truth (amended by AL-2/AL-7); AD-8 `~/.paper-mate/library/{doc_id}/` = `source.pdf`+`annotations.json`+`meta.json`, `doc_id` = SHA-256 of PDF bytes, idempotent import, `meta.json` extended additively; AD-9 storage is the only code touching `~/.paper-mate`; AD-10 single same-origin container, no CORS, no auth; AD-5/6/7 annotation model + doc-scoped store reused unchanged (a paper's `doc_id` is its annotation-store key).
- **AL-9 Stack & structural additions**: React Router **v7.x** (library/data mode, React 19-compatible, pin patch at scaffold); **PyMuPDF (fitz)** for backend parse (AGPL-3.0 → **repo relicense MIT→AGPL** at the extraction story, before distributing a bundled build); `httpx` (or equivalent) for the Crossref enrich call. GROBID sidecar (rung 4) deferred. New source dirs: `client/src/routes/` + `client/src/library/`; `server/app/domain/` (extraction); `storage/` extended (library.json read/write + boot-reconcile + display cache, still the only disk writer); `models.py` + `CollectionRow`, `Folder`, `ExtractedMeta`, status enum.

### Library UX Design Requirements

DESIGN.md (line 567) explicitly leaves Phase-2 Library surfaces **not yet styled**. These L-UX-DRs derive the Library UI from DESIGN.md's **existing token scales + generic controls** (`button-primary/secondary`, `text-input`, `badge-pill`, `toast`, `empty-dropzone`, `top-bar`, `toc-panel` width class) and the PRD/spine interaction descriptions. New surfaces (collection table, folder tree, status pills, Trash lens) must be built **within the existing token system** (no inline hex/px; `src/no-raw-values.test.ts` still governs). Inherits Phase-1 UX-DR17 (accessibility floor) and UX-DR18 (Obsidian-quiet voice).

- **L-UX-DR1 Library page layout (route `/`, the boot landing)**: no top bar. A left **folder panel** (hairline-bounded `{colors.surface-card}` column, ~280px, `{component.toc-panel}` width class) shows a `LIBRARY` caption label, `All` as a selected-nav-item pill, and the app version pinned to the bottom. A main region hosts the collection count and an Add control together in one toolbar row above the table, on the `{colors.reader-backdrop}` floor. Desktop-only; token-driven; nothing reflows on control open.
- **L-UX-DR2 Collection table**: columns Title / Authors / Added / File type, header row in `{typography.title-sm}`, rows in `{typography.body-sm}` `{colors.body}`; a leading per-row checkbox for multi-select; row hover → `{colors.surface-strong}`; **double-click a row opens the reader**. Title/Authors truncate with ellipsis; Added shown as a human date; File type as `{component.badge-pill}` (PDF / Note). A count line "N files in library" in `{typography.caption}`.
- **L-UX-DR3 Display / Sort / Filter controls**: a Display control toggles column visibility; a Sort control orders by any column with a visible asc/desc indicator on the active column; a Filter control narrows rows by column value. Controls sit in the table-header area as `{component.button-secondary}`-styled affordances; opening any of them **never reflows** the table or the page floor.
- **L-UX-DR4 Folder panel**: a nested folder tree in the left panel with **All** and **Uncategorized** pseudo-entries; create / rename / delete affordances (`{component.text-input}` for rename; delete asks confirm and states it re-homes papers, never deletes them); the selected folder is highlighted (`{colors.surface-strong}`); selecting a folder filters the table (LFR-14); empty folders still render. Assign/move a paper or multi-selection into a folder via a move action (and/or drag).
- **L-UX-DR5 Bulk upload affordance**: accept **one or more PDFs at once** via a drag-drop zone + a browse button, or via the Add control's dropdown (`File upload` / `Folder upload`, the latter recursing a chosen directory and silently skipping non-PDFs). When the collection is empty, reuse `{component.empty-dropzone}` (`Drop PDFs here` / `or browse…`); when non-empty, the Add control sits in the main-pane toolbar row next to the collection count. Dropping N files (anywhere in the main region) streams N optimistic rows into the table immediately.
- **L-UX-DR6 Upload / extraction status**: every new row shows an extraction status reflecting `extracting → ready | enrich-skipped | parse-failed` (AL-4): `extracting` reads as an in-progress/muted state, `ready` settles to the normal row, `enrich-skipped` surfaces a **non-error** notice, `parse-failed` shows the filename-title and stays editable. Status renders via `{component.badge-pill}` or an inline caption; polling updates rows **in place** without blocking browsing (LNFR-3).
- **L-UX-DR7 Inline metadata edit**: Title and Authors are editable inline (click/Enter to edit into a `{component.text-input}`, Esc cancels, Enter or blur commits), persisting via `PATCH /api/docs/{id}`; used to correct extraction (LFR-11).
- **L-UX-DR8 Trash lens**: Trash is a **view-state filter (not a route)** listing soft-deleted papers, each with **Restore** and **Purge** actions; Purge is destructive and asks confirm (states annotations go with it); empty copy "Trash is empty." Restore returns the paper to its remembered folder, else Uncategorized (AL-5).
- **L-UX-DR9 Notices & toasts**: enrichment-skipped is a **non-error** notice, visually distinct from the error `{component.toast}` (`{colors.surface-dark}`); errors (store failure on upload, purge failure) use the toast. Copy examples: "restored from Trash", "enrichment skipped for N papers", "couldn't add this file." No em-dash in any Library string (folder names UI, toasts, notices, column labels).
- **L-UX-DR10 Reader ↔ Library navigation**: the reader top bar carries a **back-to-Library** control that navigates to `/` (LFR-20); a table double-click navigates to `/reader/:docId` (LFR-18); browser back/forward and refresh preserve the user's place (AL-3 routes).
- **L-UX-DR11 Empty & loading states**: an empty collection shows the dropzone + "No papers yet." copy; table load shows skeleton rows that reserve layout (no stall, LNFR-4); the folder panel on an empty collection shows only All / Uncategorized.
- **L-UX-DR12 Accessibility floor**: every control keyboard-operable; visible 2px `{colors.ink}` focus rings; table rows reachable and openable by keyboard (Enter opens); checkboxes have associated labels; confirms are Esc-dismissable with focus management; respect `prefers-reduced-motion`. (Inherits UX-DR17.)
- **L-UX-DR13 Voice & microcopy**: Obsidian-quiet: sparse, plain, lowercase-leaning; no exclamation marks, no emoji, no em-dash; errors state the fact then the fallback. (Inherits UX-DR18.)
- **L-UX-DR14 Recent lens (added 2026-07-07)**: `Recent` is a **view-state filter, not a route** (like Trash, AL-3): selecting the left-panel `Recent` entry lists papers ordered by last-opened descending, capped at 50, with Open the primary row affordance (no Move/Delete/Star toolbar actions specific to it beyond what the normal lens offers). Trashed papers never appear. Empty copy reads "No recent papers." The `Recent` entry becomes a real selectable, keyboard-operable button with the shared active-highlight (retires the Story 7.1 inert placeholder).
- **L-UX-DR15 Starred lens + star affordance (added 2026-07-07)**: `Starred` is a **view-state filter, not a route**: selecting the left-panel `Starred` entry lists all starred (non-trashed) papers; empty copy reads "No starred papers." A starred paper renders a **filled star icon at the end of its Title cell text**, Google-Drive style: appended right after the title when the column has room, and holding its own space (the title truncates first) when it does not, so the star is never clipped. A **Star** toggle sits in the main toolbar row alongside Move / Delete / Add (enabled on a selection, mirroring the Story 7.5 bulk Restore/Purge pattern), toggling the star state of the whole selection; the button reflects whether the selection is starred. Star is org state, so the marker and lens membership persist across restart. The `Starred` entry becomes a real selectable button (retires the Story 7.1 inert placeholder). All new copy/labels em-dash-free (L-UX-DR13).

### Library FR Coverage Map

- **LFR-1** Library is the boot landing table → Epic 6
- **LFR-2** Table columns + "N files" count → Epic 6
- **LFR-3** Multi-select checkboxes for batch actions → Epic 7
- **LFR-4** Display control (column visibility) → Epic 7
- **LFR-5** Sort by any column asc/desc → Epic 7
- **LFR-6** Filter rows by column value → Epic 7
- **LFR-7** Bulk PDF upload → Epic 6
- **LFR-8** Local Title/Authors extraction → Epic 6
- **LFR-9** Optional external enrich (Crossref), non-blocking → Epic 6
- **LFR-10** Best-effort: paper never lost to a failed parse → Epic 6
- **LFR-11** Inline edit Title/Authors → Epic 6
- **LFR-12** Create/rename/delete nested folders → Epic 7
- **LFR-13** Paper ≤1 folder; All/Uncategorized view → Epic 7
- **LFR-14** Selecting a folder filters the table → Epic 7
- **LFR-15** Assign/move a paper (or selection) to a folder → Epic 7
- **LFR-16** Delete folder = subtree; papers → Uncategorized, never deleted → Epic 7
- **LFR-17** Note file-type reserved + displayed → Epic 7 **(DESCOPED 2026-07-07: Story 7.6 dropped by user request; deferred to a future notes epic)**
- **LFR-18** Double-click a row opens the annotator → Epic 6
- **LFR-19** Open restores existing annotations via doc-scoped store → Epic 6
- **LFR-20** Return from reader to Library → Epic 6
- **LFR-21** Collection/folders/metadata persist across restart → Epic 6
- **LFR-22** Delete = soft-delete to Trash; annotations retained → Epic 7
- **LFR-23** Restore a Trash item → Epic 7
- **LFR-24** Purge a Trash item permanently → Epic 7
- **LFR-25..29** Remote sync (WebDAV/Google Drive, whole-dir mirror, LWW) → Epic 8 **(DEFERRED, not built this sprint)**
- **LFR-30** Recent view (last-opened order, capped 50) → Epic 7 **(added 2026-07-07)**
- **LFR-31** Star/unstar a paper; filled-star title marker + Starred view → Epic 7 **(added 2026-07-07)**

## Library Epic List

### Epic 6: The library becomes home
On boot the user lands in their collection, not an empty reader. Drop one or more PDFs to add them; the backend extracts Title and Authors (locally via PyMuPDF, optionally enriched via Crossref) off the interaction path while rows stream into the table; double-click any row to open it in the annotator with its existing annotations restored, and return to the Library. Stands up the client router front-door flip (`/` + `/reader/:docId`), the backend metadata-extraction domain layer, and the concurrency-safe `library.json` collection index + display cache. This is the risk gate: it proves the front-door flip and the new backend domain/extraction seam. Standalone: a persistent, add-to-able, readable library on its own.
**LFRs covered:** LFR-1, LFR-2, LFR-7, LFR-8, LFR-9, LFR-10, LFR-11, LFR-18, LFR-19, LFR-20, LFR-21
**NFRs:** LNFR-1 (local-first enrich), LNFR-3 (non-blocking add), LNFR-5 (durable additive store), LNFR-6 (safe copy-in)
**Architecture:** AL-1 (collection store/authority split), AL-2 (backend extraction domain), AL-3 (router front-door flip), AL-4 (bulk/idempotent upload), AL-6 (docs vs library API boundary), AL-7 (index write-concurrency) + inherited AL-8, AL-9
**Goals:** G1 (persistent workspace) + G2 (one-action add)

### Epic 7: Organize & curate the collection
Shape the collection into nested custom folders, multi-select and batch-move papers, sort / filter / hide columns to find any paper in seconds, jump to recently-opened papers, star the ones that matter, and delete safely through a Trash lens (restore or permanently purge). Builds on Epic 6's table + collection index; stands alone as the curation layer without Epic 6 depending on it. (The Note file-type, LFR-17, was descoped 2026-07-07; Recent + Starred, LFR-30/31, were added the same day.)
**LFRs covered:** LFR-3, LFR-4, LFR-5, LFR-6, LFR-12, LFR-13, LFR-14, LFR-15, LFR-16, LFR-22, LFR-23, LFR-24, LFR-30, LFR-31 (LFR-17 descoped)
**NFRs:** LNFR-2 (no auth), LNFR-4 (collection scale: sort/filter/scroll no stall)
**Architecture:** AL-5 (trash + folder lifecycle), AL-6 (folder + set-based org endpoints)
**Goals:** G3 (find and open any paper in seconds)

### Epic 8: Remote sync (DEFERRED: captured, NOT built this sprint)
> A separate follow-on epic requiring its own discovery. A switchable sync-backend interface (WebDAV first, Google Drive a later adapter behind the same seam) that mirrors the whole `~/.paper-mate` directory (PDFs + metadata + folders + annotations) and converges across devices with last-write-wins by timestamp. Deferred per the PRD (F8) and architecture spine. Hard problems resolved in that epic's own discovery: trigger cadence, Google Drive OAuth on a localhost/Docker app, deletion/Trash propagation, interrupted-push consistency, credential encryption at rest.
**LFRs covered:** LFR-25, LFR-26, LFR-27, LFR-28, LFR-29: **not decomposed into stories this sprint**

## Epic 6: The library becomes home

On boot the user lands in their collection, not an empty reader. Drop one or more PDFs to add them; the backend extracts Title and Authors off the interaction path while rows stream into the table; double-click any row to open it in the annotator with its existing annotations restored, and return to the Library. Stands up the client router front-door flip, the backend metadata-extraction domain layer, and the concurrency-safe `library.json` collection index. Risk gate for Phase 2.

### Story 6.1: Router front-door flip and Library shell

As a returning reader,
I want the app to boot into a Library home instead of an empty reader,
So that my papers have a front door and the reader becomes one route among them.

**Acceptance Criteria:**

**Given** the SPA boots
**When** it loads
**Then** it mounts React Router via `createBrowserRouter` in library/data mode (not framework mode, excluded by AD-2) with exactly two routes, `/` (Library home) and `/reader/:docId` (Reader), and `/` is the boot landing (LFR-1, AL-3)

**Given** the existing reader
**When** it is placed under `/reader/:docId`
**Then** it reads the `:docId` route param and loads that document via the existing doc-load path (`GET /api/docs/{id}/file`), with no behavioral change to reading or annotating (AL-3, inherited AD-8)

**Given** the Library route at rest with no collection data yet
**Then** it renders a Library shell from DESIGN.md tokens (no inline hex/px): a left folder-panel region and a main region on `{colors.reader-backdrop}` showing the empty-collection dropzone copy `Drop PDFs here` / `or browse…` (L-UX-DR1, L-UX-DR11)

**Given** the Reader route
**When** the user activates the back-to-Library control in the top bar
**Then** the app navigates to `/` (LFR-20, L-UX-DR10)

**Given** browser back/forward or a refresh on either route
**Then** the user's place is preserved, the route being the source of navigation truth (AL-3)

**Given** any interactive chrome in the shell
**When** focused via keyboard
**Then** a visible 2px `{colors.ink}` focus ring shows (L-UX-DR12)

### Story 6.2: The collection index (papers persist and list)

As a reader,
I want the app to keep a durable index of every paper I have added,
So that my collection survives restarts and can be listed in one fast read.

**Acceptance Criteria:**

**Given** the storage module
**When** the app persists collection state
**Then** it writes `~/.paper-mate/library.json` as the authoritative index carrying `schema_version`, the folder tree (identity/nesting/names, incl. empty folders), folder membership (paper→≤1 folder), trash state, and paper inclusion + order; per-paper own fields stay in `meta.json` (AL-1)

**Given** `library.json`
**Then** it also carries a NON-authoritative title/authors display cache rebuildable from `meta.json` (meta wins on conflict, refreshed on every write) so the table renders in one read (AL-1, LNFR-4)

**Given** `GET /api/library`
**When** called
**Then** it returns the collection rows (`doc_id`, title, authors, added, file_type, status, folder, trashed, order) from the display cache in a single read; Pydantic models (`CollectionRow`, `Folder`, status enum) generate the TS client types (AL-6, AL-8 / AD-3)

**Given** app boot
**When** storage reconciles
**Then** a `{doc_id}/` dir absent from the index is added as Uncategorized, and an index entry whose dir vanished is pruned (AL-1 boot-reconcile)

**Given** any `library.json` mutation
**Then** it is a whole-index read-modify-write serialized under a process-level lock and committed via atomic temp+rename, so concurrent writers never drop a change; storage is the ONLY code that touches `~/.paper-mate` (AL-7, AL-9)

**Given** a paper imported via the existing `POST /api/docs`, then a restart
**When** `GET /api/library` is called
**Then** the paper still lists (LFR-21 persistence proof)

**Given** `library.json` schema evolves
**Then** changes are additive only; a breaking change is an AD-8-class format break requiring a MAJOR bump (LNFR-5)

### Story 6.3: Collection table view

As a reader,
I want my collection shown as a table of papers,
So that I can see everything I have at a glance.

**Acceptance Criteria:**

**Given** a non-empty collection
**When** the Library route renders
**Then** the main region shows a table with columns Title, Authors, Added, and File type, populated from `GET /api/library`, plus a count line "N files in library" (LFR-2, L-UX-DR2)

**Given** a table row
**Then** Title/Authors truncate with ellipsis, Added shows a human-readable date, and File type shows as a `{component.badge-pill}` (PDF / Note); labels use `{typography.title-sm}` and rows `{typography.body-sm}` `{colors.body}` (L-UX-DR2)

**Given** a row
**When** hovered
**Then** it shifts to `{colors.surface-strong}` (L-UX-DR2)

**Given** an empty collection
**Then** the dropzone + "No papers yet." copy shows instead of the table; during load, skeleton rows reserve layout with no stall (L-UX-DR11, LNFR-4)

**Given** a table of hundreds of rows
**When** scrolled
**Then** scrolling acts without a visible multi-second stall (LNFR-4)

**Given** every table label and copy string
**Then** none contains an em-dash (L-UX-DR13, DESIGN.md)

### Story 6.4: Bulk upload with optimistic rows

As a reader,
I want to drop or browse several PDFs at once and see them appear immediately,
So that adding papers is one action that never freezes the app.

**Acceptance Criteria:**

**Given** the Library
**When** I drag-drop or browse one or more PDF files
**Then** each file is uploaded as its own `POST /api/docs`, client-throttled to a concurrency cap (~4) (LFR-7, AL-4)

**Given** an upload starts
**Then** an optimistic row appears in the table immediately with `doc_id`, title = filename, and `status: extracting`; rows stream in as requests land, and I can keep browsing the collection meanwhile (AL-4, LNFR-3, L-UX-DR5, L-UX-DR6)

**Given** a re-upload of a PDF whose bytes resolve to an existing `{doc_id}/`
**Then** no duplicate row is created and the existing paper is returned; its `annotations.json`/`meta.json` are never overwritten (AL-4 idempotent dedupe, inherited AD-8)

**Given** a store failure on one file (not a PDF, or a disk error)
**Then** that one file is rejected with a per-file notice and the other uploads are unaffected (AL-4 failure split, L-UX-DR9)

**Given** a paper that fails to parse
**Then** it still enters the collection as a filename-title row and is not lost (full status handling lands in Story 6.5) (LFR-10, AL-4)

**Given** storage writes the copied PDF
**Then** `source.pdf` is written atomically (temp + rename) so a mid-copy failure leaves the collection consistent and never corrupts the original (LNFR-6, AL-4)

> The trash-restore-on-reupload edge (AL-4 point 4) is deferred to Story 7.5 (Trash does not exist yet).

### Story 6.5: Backend metadata extraction (extract + enrich)

As a reader,
I want the Title and Authors filled in automatically after I upload,
So that the table is useful without me typing metadata.

**Acceptance Criteria:**

**Given** extraction
**Then** it lives in a bounded, pure `server/app/domain/` module (the first tenant of the backend domain layer) exposing `extract(pdf_bytes) → ExtractedMeta` and `enrich(meta) → meta | "skipped"` (AL-2)

**Given** `extract`
**When** run
**Then** it resolves Title + Authors via rung 1 (embedded `/Info` + XMP) then rung 2 (font-size heuristic) using PyMuPDF in-process, and the `extract()` seam stays GROBID-swappable (AL-2, LFR-8)

**Given** `enrich`
**When** online
**Then** it queries Crossref DOI-first (DOI extracted from the PDF) then falls back to a title/authors query, correcting metadata; when offline or on failure it returns `"skipped"`, never blocks the add, and the client surfaces a NON-error notice that enrichment was skipped (LFR-9, AL-2, LNFR-1, L-UX-DR9)

**Given** a bulk add
**Then** extraction runs as a background task, never on the request path; the client polls `GET /api/library` until all statuses settle, then stops polling (AL-2, LNFR-3)

**Given** a paper's lifecycle
**Then** its status transitions `extracting → ready | enrich-skipped | parse-failed`; a parse failure enters the paper as a filename-title row with `status: parse-failed`, editable and never lost (AL-4, LFR-10, L-UX-DR6)

**Given** extraction produces data
**Then** storage (the only writer, AL-9) persists it to `meta.json` and refreshes the `library.json` display cache; the domain module itself never touches disk (AL-2, AL-1)

**Given** PyMuPDF (AGPL-3.0) is added
**Then** the repo relicenses MIT→AGPL-3.0 in the same change, before any bundled build is distributed (AL-9, spine Deferred)

### Story 6.6: Inline edit Title and Authors

As a reader,
I want to fix a wrong Title or Authors right in the table,
So that I can correct extraction without leaving the Library.

**Acceptance Criteria:**

**Given** a Title or Authors cell
**When** I click it or focus it and press Enter
**Then** it becomes an inline `{component.text-input}`; Enter or blur commits, Esc cancels (LFR-11, L-UX-DR7)

**Given** a committed edit
**Then** it persists via `PATCH /api/docs/{id}` authoritative on `meta.json`, and storage refreshes the `library.json` display cache so the table reflects the new value (AL-6, AL-1)

**Given** a `parse-failed` or `enrich-skipped` row
**Then** its Title/Authors are editable the same way, correcting a bad parse (LFR-10, LFR-11)

**Given** the inline editor
**When** focused
**Then** it shows a 2px `{colors.ink}` focus treatment and is keyboard-operable (L-UX-DR12)

### Story 6.7: Open a paper in the annotator with its annotations

As a reader,
I want to open a paper from the Library to read and annotate it, with my past marks intact,
So that the Library is a real entry point to reading, not just a list.

**Acceptance Criteria:**

**Given** a table row
**When** I hover it and click the Open button it reveals (or Tab to the button and press Enter/Space)
**Then** the app navigates to `/reader/:docId` for that paper (LFR-18, AL-3, L-UX-DR10). Delivered ahead of this story's formal planning by the 2026-07-05 "Library hover Open button" fix (`docs/superpowers/specs/2026-07-05-library-hover-open-button-design.md`); this AC now describes existing, shipped behavior in `CollectionTable.tsx`.

**Given** the reader opens a paper
**Then** it hydrates that paper's PDF (`GET /api/docs/{id}/file`) and its existing annotations through the inherited doc-scoped annotation store (Story 5.8 / 3.5 seam); the paper's `doc_id` IS its annotation-store key (LFR-19, inherited AD-5/6/7/8)

**Given** I annotate the opened paper
**Then** the new marks belong to that Library paper and autosave to its `annotations.json` (inherited AD-6, AD-7)

**Given** the paper opens
**Then** `meta.last_opened` updates via storage (AL-1, inherited AD-8)

**Given** I am reading a paper
**When** I use the back-to-Library control
**Then** the app returns to `/` and the collection is shown (LFR-20, L-UX-DR10)

**Given** a doc SWITCH (open paper A, annotate, back to Library, open paper B)
**Then** B restores its own annotations and A's marks never appear on B (inherited Story 5.8 atomic doc-scope; verify live at DPR>1)

### Story 6.8: Epic 6 structural refactor — modularize the library client and split the storage/domain backend

> User request (2026-07-05): Epic 6 landed the whole Library run (router flip, collection index, table, bulk upload, metadata extraction, inline edit, open-in-annotator) but grew structural debt: `server/app/storage/__init__.py` is a 621-line god-module spanning seven concerns; `server/app/domain/extraction.py` (274) fuses the PDF `extract` with the Crossref `enrich` network client behind no port; `routes/docs.py` (305) repeats the OpenAPI error-envelope block and the storage-exception→HTTP mapping in every handler; and the client `library/` dir keeps its components flat (`CollectionTable.tsx` 416, `LibraryPage.tsx` 386) with upload/optimistic/polling/inline-edit conditional sprawl, not the `components/<Name>/` colocation Story 5.4 adopted. Adopt the `/scaffold-react` layout for the client and an OOP/package decomposition for the server; audit inter-module dependencies, dedupe, abstract into classes/ports/data classes, and simplify overly conditional logic. A pure refactor thread, same footing as Story 5.0 / 5.3 / 5.4 — its own PR(s), never folded into a feature story. No behavior or contract change.

As a developer,
I want the Epic 6 code (client `library/` + backend `storage`/`domain`/`routes`) decomposed into cohesive, single-responsibility modules with dependencies audited, duplication removed, and conditional sprawl simplified,
So that the next Library story (Epic 7 folders/trash/sort) builds on legible modular seams instead of a 621-line storage god-module and 400-line flat components.

**Acceptance Criteria:**

**Given** `server/app/storage/__init__.py` (621 lines spanning error taxonomy, path/data-root resolution, atomic-IO primitives, PDF parse, the `meta.json` store, the `library.json` read-modify-write index, and the annotations store)
**Then** it is split into a `storage/` package of focused modules (e.g. errors, paths, atomic-IO, meta store, library index, annotations store) behind a stable `__init__` facade that re-exports the current public surface unchanged, so every `storage.<fn>` call site in routes stays byte-identical; storage remains the ONLY code that touches `~/.paper-mate` (AL-9) and the single process-level index lock stays the sole `library.json` writer (AL-7)

**Given** `server/app/domain/extraction.py` (274 lines fusing the pure PyMuPDF `extract` with the Crossref-network `enrich`)
**Then** `extract` (PDF-only, total, GROBID-swappable) and `enrich` (the backend's only network call) are separated into their own modules, with the Crossref access abstracted behind a small enricher port/class (interface + `CrossrefEnricher` implementation) so `enrich` is swappable and unit-testable without HTTP; the domain layer still imports nothing from `app.storage` and never touches disk (AD-L2)

**Given** `routes/docs.py` (305 lines) repeats the OpenAPI `ErrorEnvelope` `responses=` block ~6× and the `except DocumentNotFoundError → 404 / except StorageError → 500` mapping in every handler
**Then** the duplicated error-envelope responses and the storage-exception→HTTP mapping are each consolidated to one definition (a shared responses constant/factory + a single exception-mapping seam), leaving each handler a thin controller; the `run_extraction` extract→enrich→persist orchestrator is homed where it composes storage + domain cleanly

**Given** the client `library/` dir (components flat: `AddMenu`, `CollectionTable` 416, `LibraryPage` 386; hooks `useBulkUpload`/`useSettlePolling`; leaf `uploadQueue`)
**Then** it adopts the `/scaffold-react` convention (adapted to Vite + TS + Zustand as Story 5.4 established): each component in its own `components/<Name>/` folder colocated with its `.css` + `.test.tsx`, hooks given a hooks home, pure leaves a `lib/`-style home; `CollectionTable`/`LibraryPage` are decomposed so upload / optimistic-row / polling / inline-edit each own their state in a cohesive unit rather than one conditional sprawl, and the row/status shape is abstracted into a shared data type

**Given** duplication and dead code across the Epic 6 surface (client and server)
**Then** logic duplicated across these files (or vs. the existing `render/`/`anchor/`/`annotations/`/`store/` client layers and the `storage`/`domain` server layers) is consolidated to one definition, and dead code (unreferenced exports, stale branches, superseded comments) is deleted, not left "just in case"

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` regenerate byte-identical, both `vi.mock("./render")` barrels updated if any import path moves, `no-raw-values` re-run after any CSS move, no em-dash introduced in any UI string, and the Library→open-in-annotator and bulk-upload/table paths re-smoked live at DPR>1 (inherited `annotations/` selection-geometry + doc-switch risk); its own PR(s), never folded into a feature story

**Given** AD-9 downward layering (client `render/`→`anchor/`→`annotations/`→`App`; server `routes/`→`domain`/`storage`) and the domain's no-storage-import rule (AD-L2)
**Then** the new module boundaries respect it: no upward imports, routes stay thin, domain stays pure, storage stays the sole data-root writer

## Epic 7: Organize & curate the collection

Shape the collection into nested custom folders, multi-select and batch-move papers, sort / filter / hide columns to find any paper in seconds, jump to recently-opened papers, star the ones that matter, and delete safely through a Trash lens (restore or permanently purge). Builds on Epic 6's table + collection index; stands alone as the curation layer.

### Story 7.1: Folders (create, rename, delete, nest)

As a reader,
I want nested custom folders in the left panel,
So that I can group my papers however I think about them.

**Acceptance Criteria:**

**Given** the folder panel
**When** I create a folder
**Then** it appears in the left-panel tree with a UUIDv4 id and a mutable name, and can be nested under another folder (LFR-12, AL-5)

**Given** a folder
**When** I rename it
**Then** only its name changes; membership is keyed by id so a rename never orphans papers (LFR-12, AL-5)

**Given** a folder with a subtree and papers
**When** I delete it
**Then** the whole subtree is deleted and every paper anywhere in that subtree moves to Uncategorized; NO paper is deleted (LFR-16, AL-5, ratifies PRD A1)

**Given** the panel
**Then** the All and Uncategorized pseudo-entries always render, and empty folders still show (LFR-13, L-UX-DR4)

**Given** folder state
**Then** it persists in `library.json` through the storage-only serialized write path and survives restart (AL-1, AL-7, LFR-21)

**Given** the folders CRUD
**Then** it goes through `/api/library/folders` (subtree delete server-side) with generated types (AL-6, AL-8)

**Given** a folder delete
**When** triggered
**Then** a confirm states it re-homes papers and never deletes them, and the confirm is Esc-dismissable (L-UX-DR4, L-UX-DR12)

### Story 7.2: Assign and filter by folder

As a reader,
I want to put a paper in a folder and click a folder to see only its papers,
So that I can narrow the collection to what I am working on.

**Acceptance Criteria:**

**Given** a folder in the panel
**When** I select it
**Then** the table filters to that folder's papers as VIEW-STATE inside the Library route (not a route change) (LFR-14, AL-3)

**Given** All
**When** selected
**Then** every non-trashed paper shows; **Given** Uncategorized selected **Then** only papers with no folder show (LFR-13, L-UX-DR4)

**Given** a paper
**When** I move it to a folder (move action or drag)
**Then** its membership updates via `POST /api/library/move` and it belongs to at most one folder (a move replaces any prior folder) (LFR-13, LFR-15, AL-5, AL-6)

**Given** the move persists
**Then** `library.json` membership updates under the serialized write path (AL-7)

**Given** the selected folder
**Then** it is highlighted `{colors.surface-strong}` in the panel (L-UX-DR4)

### Story 7.3: Multi-select and batch move

As a reader,
I want to select several papers at once and move them together,
So that I can organize in bulk instead of one by one.

**Acceptance Criteria:**

**Given** the table
**When** I use per-row checkboxes (and a select-all)
**Then** multiple rows enter a selection state (LFR-3, L-UX-DR2)

**Given** a multi-selection
**When** I move it to a folder
**Then** all selected papers move in one set-based `POST /api/library/move` taking `{doc_ids}` (LFR-3, LFR-15, AL-6)

**Given** the batch op
**Then** it is applied through the serialized `library.json` write path so a concurrent background extraction refresh cannot drop it (AL-7)

**Given** a selection
**When** I clear it or a batch action completes
**Then** the selection state resets (L-UX-DR2)

**Given** every selectable control
**Then** it is keyboard-operable with visible focus rings (L-UX-DR12)

> Batch delete reuses this multi-select and lands in Story 7.5.

### Story 7.4: Display, Sort, and Filter controls

As a reader,
I want to hide columns, sort by any column, and filter rows,
So that I can find a paper in a large collection in seconds.

**Acceptance Criteria:**

**Given** the table header area
**When** I open the Display control
**Then** I can toggle the visibility of any column, and hidden columns are omitted with no reflow of the surrounding frame (LFR-4, L-UX-DR3)

**Given** the Sort control
**When** I choose a column and direction
**Then** rows order by that column ascending or descending, with a visible indicator on the active column; sort is client view-state, not persisted (LFR-5, AL-3, L-UX-DR3)

**Given** the Filter control
**When** I set a column value
**Then** only matching rows show (LFR-6, L-UX-DR3)

**Given** hundreds of papers
**When** I sort or filter
**Then** the result appears without a visible multi-second stall (LNFR-4)

**Given** the controls
**Then** they are `{component.button-secondary}`-styled, token-driven, keyboard-operable, and never reflow the canvas floor (L-UX-DR3, L-UX-DR12)

### Story 7.5: Trash (soft-delete, restore, purge)

As a reader,
I want deletes to go to a Trash I can restore from, and a permanent purge when I mean it,
So that I never lose a paper or its annotations by accident.

**Acceptance Criteria:**

**Given** a paper or a multi-selection
**When** I delete it
**Then** it soft-deletes: `trashed` flips in `library.json`, its annotations are untouched, it leaves normal and folder views and shows only in the Trash lens, and it retains its folder membership while trashed (LFR-22, AL-5)

**Given** the Trash lens
**Then** it is a view-state filter (not a route) listing trashed papers, each with Restore and Purge actions; empty copy reads "Trash is empty." (AL-3, L-UX-DR8)

**Given** a trashed paper
**When** I restore it
**Then** `trashed` clears and it returns to its remembered folder, or to Uncategorized if that folder no longer exists, with a "restored from Trash" notice (LFR-23, AL-5, L-UX-DR9)

**Given** a trashed paper
**When** I purge it
**Then** a confirm (stating annotations go with it, Esc-dismissable) precedes a `DELETE /api/docs/{id}` that removes the whole `{doc_id}/` dir and its `library.json` entry permanently; purge is manual only, no auto-purge (LFR-24, AL-5, AL-6, L-UX-DR8, L-UX-DR12)

**Given** a re-upload of a PDF that is currently trashed
**Then** the upload restores the existing paper ("restored from Trash") rather than creating a duplicate (AL-4 point 4, the edge deferred from Story 6.4)

**Given** batch delete
**Then** it reuses Story 7.3 multi-select and trashes all selected via the set-based org path (LFR-3, LFR-22, AL-6, AL-7)

**Given** any Trash label or notice copy
**Then** no string contains an em-dash (L-UX-DR9, L-UX-DR13)

### Story 7.6: Note file-type (reserved and displayed): DESCOPED from Epic 7 (2026-07-07)

> Dropped by user request (`sprint-change-proposal-2026-07-07.md`), never attempted: no story file, no code. The `file_type` enum already carries the reserved `"note"` value from Epic 6 (`DocMeta`/`CollectionRow`), but nothing displays or creates a Note this sprint. LFR-17 defers to a future notes epic (alongside in-app note authoring, which was always out of scope). Marked `blocked` in `sprint-status.yaml` so Epic 7 can still reach `done`. Section kept for traceability; the original spec follows.

As a reader,
I want the collection to recognize a Note file-type distinct from a PDF,
So that the model and table are ready for notes even before authoring exists.

**Acceptance Criteria (DESCOPED, not built):**

**Given** the data model
**Then** `meta.json` `file_type` and the `CollectionRow` model support a "Note" value distinct from "PDF" (LFR-17, AL-1)

**Given** a Note-type entry
**When** the table renders
**Then** File type shows a "Note" `{component.badge-pill}` visually distinct from "PDF" (LFR-17, L-UX-DR2)

**Given** this sprint
**Then** nothing in the app CREATES a note (authoring is out of scope); the type is reserved and displayed only (LFR-17, spine Deferred: note identity)

### Story 7.7: Recent view (recently-opened papers)

As a reader,
I want a Recent view that lists the papers I most recently opened,
So that I can jump straight back to what I was reading without hunting through the collection.

**Acceptance Criteria:**

**Given** the left-panel `Recent` entry (an inert placeholder from Story 7.1)
**When** I select it
**Then** it becomes a real selectable, keyboard-operable button (shared active-highlight) and shows the Recent view as VIEW-STATE inside the Library route, not a route change (LFR-30, AL-3, L-UX-DR14)

**Given** the Recent view
**Then** it lists papers ordered by last-opened descending, capped at the 50 most-recently-opened; trashed papers never appear (LFR-30, L-UX-DR14)

**Given** a paper is opened from the Library
**Then** its `last_opened` advances (already wired via `POST /api/docs/{id}/open`, Story 6.7) so it moves to the top of Recent on the next `GET /api/library` reconcile (LFR-30, AL-1)

**Given** the collection table's display cache
**Then** `CollectionRow` exposes `last_opened` (additive contract change: Pydantic → OpenAPI → regenerated TS types; `docs/API.md` updated) so the client can order the Recent lens in one read (AL-1, AL-6, AL-8)

**Given** the Recent view is empty
**Then** the empty copy reads "No recent papers." (L-UX-DR11, L-UX-DR14)

**Given** the ordering source
**Then** the 50-cap and last-opened ordering are client view-state over the returned rows (no new persistence: `last_opened` already persists in `meta.json` per AL-1); a design note resolves whether a never-opened paper (seeded `last_opened == added`) appears in Recent or Recent shows only genuinely-opened papers (see the sprint-change-proposal decision).

### Story 7.8: Star / unstar papers (filled-star marker + Starred view)

As a reader,
I want to star the papers that matter and see them together,
So that my most important papers are one click away and visibly marked in any view.

**Acceptance Criteria:**

**Given** a paper or a multi-selection
**When** I toggle Star (a toolbar button in the main row alongside Move / Delete / Add, enabled on a selection, mirroring the Story 7.5 bulk Restore/Purge pattern)
**Then** `starred` flips in `library.json` for every selected paper via a set-based `POST /api/library/star` / `unstar` taking `{doc_ids}`, applied through the serialized write path so a concurrent background refresh cannot drop it (LFR-31, AL-5, AL-6, AL-7)

**Given** a starred paper in ANY lens (All, a folder, Recent, Starred)
**When** the table renders its Title cell
**Then** a filled star icon appears at the end of the title text: appended right after the title when the column has room, and holding its own space so the title truncates first when it does not, so the star is never clipped (LFR-31, L-UX-DR15)

**Given** the left-panel `Starred` entry (an inert placeholder from Story 7.1)
**When** I select it
**Then** it becomes a real selectable button and shows a VIEW-STATE lens listing all starred, non-trashed papers; empty copy reads "No starred papers." (LFR-31, AL-3, L-UX-DR15)

**Given** the `starred` flag
**Then** it is org state in `library.json` (like `trashed`), surfaced on `CollectionRow` (additive contract change: regenerated TS types; `docs/API.md` updated) and persists across restart (LFR-31, AL-1, AL-8, LNFR-5)

**Given** the Star toolbar button
**Then** its label/pressed state reflect whether the current selection is starred (a mixed selection toggles all to starred), it is keyboard-operable with a visible focus ring, and hidden or inert in the Trash lens (LFR-31, L-UX-DR12, L-UX-DR15)

**Given** any new Star label, toolbar copy, or empty-view copy
**Then** no string contains an em-dash (L-UX-DR13, L-UX-DR15)

## Epic 8: Remote sync (DEFERRED)

Not decomposed into stories this sprint. See the Library Epic List entry and the architecture spine's Deferred section. LFR-25..29 remain captured; the sync epic runs its own discovery (trigger cadence, Google Drive OAuth on a localhost/Docker app, deletion/Trash propagation, interrupted-push consistency, credential encryption at rest) before any story is written.
