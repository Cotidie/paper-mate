# Epic 6: The library becomes home

On boot the user lands in their collection, not an empty reader. Drop one or more PDFs to add them; the backend extracts Title and Authors off the interaction path while rows stream into the table; double-click any row to open it in the annotator with its existing annotations restored, and return to the Library. Stands up the client router front-door flip, the backend metadata-extraction domain layer, and the concurrency-safe `library.json` collection index. Risk gate for Phase 2.

## Story 6.1: Router front-door flip and Library shell

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

## Story 6.2: The collection index (papers persist and list)

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

## Story 6.3: Collection table view

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

## Story 6.4: Bulk upload with optimistic rows

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

## Story 6.5: Backend metadata extraction (extract + enrich)

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

## Story 6.6: Inline edit Title and Authors

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

## Story 6.7: Open a paper in the annotator with its annotations

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

## Story 6.8: Epic 6 structural refactor — modularize the library client and split the storage/domain backend

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
