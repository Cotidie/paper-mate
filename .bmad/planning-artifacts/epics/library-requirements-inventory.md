# Library Requirements Inventory

## Library Functional Requirements

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

**F10 · Bibliographic columns (added 2026-07-07 via correct-course; not in the original Library PRD)**

> Added by user request (`sprint-change-proposal-2026-07-07-metadata-columns.md`) while iterating on the Library table. Extends Story 7.4's column model with three bibliographic columns sourced from the existing Crossref enrichment (new imports only; no backfill of already-imported papers).

- **LFR-32** The collection table offers **Venue**, **Year** (published year), and **DOI** columns, sortable and hideable via the Display menu. Venue and Year are captured from the Crossref enrichment (`container-title`, `issued`); DOI is persisted from the existing extraction. Populated on new / re-imported papers; papers imported before this feature (or with no Crossref match) show blank cells.

## Library NonFunctional Requirements

- **LNFR-1 Local-first.** Every Library feature works fully offline. The optional external metadata lookup is the only network call; opt-in, degrades gracefully offline or on failure.
- **LNFR-2 No auth.** Localhost, single user, no accounts (consistent with the app).
- **LNFR-3 Non-blocking add.** Uploading a batch of PDFs never freezes the table: extraction runs off the interaction path, rows appear as they resolve, and the user can keep browsing while extraction continues.
- **LNFR-4 Collection scale.** For a realistic personal collection of hundreds of papers, sort, filter, and scroll act without a visible stall.
- **LNFR-5 Durable, forward-compatible store.** Library metadata + folder structure persist under `~/.paper-mate` in an additive-tolerant format. A breaking schema change is an AD-8-class persisted-format break and takes a MAJOR version bump.
- **LNFR-6 Safe copy-in.** Copying an uploaded PDF into the collection never corrupts or loses the original; a failure mid-copy leaves the collection consistent.

## Library Additional Requirements

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

## Library UX Design Requirements

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

## Library FR Coverage Map

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
- **LFR-25..29** Remote sync (WebDAV/Google Drive, whole-dir mirror, LWW) → deferred follow-on, UNNUMBERED (PRD F8/FR-25..29 + reserved architecture sync seam) **(DEFERRED; un-numbered 2026-07-11 correct-course, no longer "Epic 8")**
- **LFR-30** Recent view (last-opened order, capped 50) → Epic 7 **(added 2026-07-07)**
- **LFR-31** Star/unstar a paper; filled-star title marker + Starred view → Epic 7 **(added 2026-07-07)**
- **LFR-32** Venue / Year / DOI columns (Crossref-sourced, sortable + hideable, new imports only) → Epic 7 **(added 2026-07-07)**
