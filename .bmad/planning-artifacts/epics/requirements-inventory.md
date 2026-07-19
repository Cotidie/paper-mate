# Requirements Inventory

## Functional Requirements

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

> Surfaced during the Epic 1–2 build and logged in `.bmad/implementation-artifacts/deferred-work.md`. NOT in the original PRD FR-1..22; promoted here as **post-v1 (Phase-1.5)** scope grouped into Epic 4 (fidelity) and Epic 5 (preferences & polish). Fidelity bugs (copy-spaces, trailing-band, gutter-join, multi-column selection) and the on-page-treatment fixes are quality of existing FRs (FR-2/4/7/8/11) under NFR-3, so they are tracked as Epic-4 stories rather than new FRs; the small UX refinements (layered Esc, confirm-check, collapse stroke-width dropdown, dim ToC) are AC-level under existing UX-DRs.

> ⚠️ **SUPERSEDED NUMBERING (2026-07-18 reconciliation, do not cite these FR-23..27 numbers).** The 2026-07-11 correct-course RE-USED FR-23/24/25 for Annotation-Bank features and FR-26/27 for Epic 12 export/preview in the authoritative `prd.md`; the five capabilities below kept their scope but LOST these 2026-06-30 numbers. They are now tracked BY STORY, not by FR number. `prd.md` is the single FR source of truth (FR-1..33; the 2026-07-18 additions FR-28..33 landed inline there, not in a separate addendum). The five orphaned capabilities:
>
> - Hide/show ALL annotations at once (view-only global toggle, no mutation) → Epic 5 Story 5.5 (**done**)
> - Settings modal with custom hotkey rebinding (keymap-as-data enabler) → Epic 5 Story 5.1 (**done**)
> - Per-tool remembered default color + custom color slots → Epic 5 Story 5.2 (**blocked/descoped**)
> - Adjust the text range of a text-anchored annotation → Epic 3 Story 3.8 (**blocked**)
> - Convert an annotation between highlight and comment, both ways → Epic 3 Story 3.7 (**done**)

## NonFunctional Requirements

- **NFR-1 Layout stability** *(defining bar)* — the PDF area is pixel-stable regardless of UI state. The left rail, drag-to-change-tool picker, and Annotation Bank all overlay or reserve fixed space; none reflow or resize the page.
- **NFR-2 Smoothness** — scroll, zoom, and pan stay fluid (target ~60fps, no jank) on a large paper (50+ pages).
- **NFR-3 Anchor fidelity** — every annotation re-renders at its exact PDF coordinates across all zoom levels.
- **NFR-4 Durability** — annotations are never silently lost; local-first storage survives reload.
- **NFR-5 Immersion** — minimal Obsidian-style chrome; hairlines and restraint; UI recedes behind the paper (per DESIGN.md token scales only).

## Additional Requirements

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

## UX Design Requirements

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

## FR Coverage Map

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
> **Post-v1 capabilities (story-tracked; FR-23..27 numbers RE-USED in `prd.md`, see the FG-F SUPERSEDED note above).** These kept their scope but not their 2026-06-30 numbers:
- Hide/show all annotations toggle → Epic 5 Story 5.5 (**done**)
- Settings modal + hotkey rebinding (keymap-as-data enabler) → Epic 5 Story 5.1 (**done**)
- Per-tool default color + custom color slots → Epic 5 Story 5.2 (**descoped from v1**, 2026-07-02, product decision, never attempted; see `deferred-work.md`)
- Adjust annotation text range → Epic 3 Story 3.8 (**blocked**, attempted 2026-07-02, discarded on a hard Chromium `caretRangeFromPoint`/`caretPositionFromPoint` blocker during live smoke; see `deferred-work.md`)
- Convert highlight ↔ comment → Epic 3 Story 3.7 (**done**, post-v1 slice on the command path)

> **Quality/fidelity (no new FR — quality of existing FRs under NFR-3):** copy-text spaces (FR-2/4) → Epic 4 Story 4.1; trailing-punctuation selection band (FR-2) → Epic 4 Story 4.1; highlights join across the gutter + multi-column selection (FR-7/13, NFR-3) → Epic 4 Story 4.2; comment-vs-highlight distinct on-page treatment + memo transparent treatment (FR-10/11, UX-DR7) → Epic 4 Story 4.3.
