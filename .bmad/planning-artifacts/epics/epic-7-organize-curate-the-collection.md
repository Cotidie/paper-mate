# Epic 7: Organize & curate the collection

Shape the collection into nested custom folders, multi-select and batch-move papers, sort / filter / hide columns to find any paper in seconds, jump to recently-opened papers, star the ones that matter, and delete safely through a Trash lens (restore or permanently purge). Builds on Epic 6's table + collection index; stands alone as the curation layer.

## Story 7.1: Folders (create, rename, delete, nest)

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

## Story 7.2: Assign and filter by folder

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

## Story 7.3: Multi-select and batch move

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

## Story 7.4: Display, Sort, and Filter controls

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

## Story 7.5: Trash (soft-delete, restore, purge)

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

## Story 7.6: Note file-type (reserved and displayed): DESCOPED from Epic 7 (2026-07-07)

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

## Story 7.7: Recent view (recently-opened papers)

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

## Story 7.8: Star / unstar papers (filled-star marker + Starred view)

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

## Story 7.9: Venue, Year & DOI columns (added 2026-07-07)

As a reader,
I want Venue, published Year, and DOI columns in the library table,
So that I can scan and sort my papers by where and when they were published and jump straight to a paper's DOI.

**Acceptance Criteria:**

**Given** the per-document model
**Then** `DocMeta` gains `doi`, `venue`, and `year` (additive, no `schema_version` bump; an existing `meta.json` missing them still validates via defaults), and `ExtractedMeta` gains `venue` + `year` (it already carries `doi`) (LFR-32, AL-1, AL-2)

**Given** the Crossref enrichment of a newly imported paper
**When** `enrich()` resolves a Crossref `work`
**Then** it captures `container-title` as Venue and the `issued`/`published` date-parts year as Year (alongside the existing title/authors/doi), and the route projects `doi`/`venue`/`year` onto `DocMeta` (LFR-32, AL-2)

**Given** a paper imported before this feature, or one with no Crossref match
**Then** its Venue/Year/DOI cells render blank (no backfill/re-enrich this story: the decision is Crossref new-imports-only) (LFR-32)

**Given** the collection index display cache
**Then** `CollectionRow` exposes `doi`, `venue`, `year` (additive contract change: Pydantic → OpenAPI → regenerated TS types; `docs/API.md` updated), projected in `_cache_from_meta` (LFR-32, AL-1, AL-6, AL-8)

**Given** the collection table
**Then** Venue, Year, and DOI appear as columns that are sortable and hideable via the Display menu (Title stays non-hideable); Year sorts numerically, Venue/DOI as strings with empty values sorting last (LFR-32, L-UX-DR-table)

**Given** the DOI cell of a paper with a DOI
**Then** it offers a way to open `https://doi.org/{doi}` without also triggering the row's open/arm gesture (a link that stops propagation, mirroring the Title Open button) (LFR-32)

**Given** any new column header, label, or empty-cell copy
**Then** no string contains an em-dash (L-UX-DR13)

> **Out of scope (this story):** backfilling/re-enriching already-imported papers; inline-editing Venue/Year/DOI; any Crossref capture beyond `container-title`/`issued`. **Open design calls for create-story:** DOI-as-link vs muted text; whether DOI is hidden by default; `year` as `int` vs the raw issued string (recommend `int`).

## Story 7.10: Reorder columns by drag-and-drop (persisted table layout) (added 2026-07-08)

> User request (2026-07-08): drag a column header to reorder the collection-table columns, and have that order survive a reload. Extends Story 7.4's column model (`tableView.ts` `COLUMNS` + `useTableView` visibility/sort + `useColumnWidths`), which today is a fixed const order held in ephemeral view-state. This introduces the first CLIENT-SIDE PERSISTED table layout: column order, visibility (the 7.4 Display toggle), and widths persist in a `localStorage` "table view preferences" store (app-global, one layout for the collection table), decided with the user. Sort stays ephemeral (re-sort per session). Row ordering is untouched (still the client sort / library.json insertion order per AD-L1). No backend/contract change: table LAYOUT prefs are client-only UI state and never enter `library.json`/`meta.json` (storage stays the sole writer of those; AD-9, AL-7).

As a reader,
I want to drag columns into the order I prefer and have it remembered,
So that the table opens the way I left it every time.

**Acceptance Criteria:**

**Given** the table header
**When** I drag a column header onto another
**Then** the columns reorder to the drop position, with a clear drag affordance and drop indicator (token-driven, no raw values); the reorder is also keyboard-operable (an accessible move, e.g. focus a header and move it left/right) (LFR-4, L-UX-DR3, L-UX-DR12)

**Given** a reordered / re-hidden / resized table
**When** I reload the app or revisit the Library
**Then** the column ORDER, VISIBILITY (7.4 Display toggle), and WIDTHS are restored from a client-only `localStorage` table-view-preferences store; the active SORT is NOT persisted (re-sort per session); row order is unchanged (LFR-4, AL-3-amended)

**Given** Title carries the Open button + inline-edit affordance (7.4 AC-1: never hideable)
**Then** the reorder respects that constraint (Title stays reachable as the primary column); decide at create-story whether Title is pinned first or may move while staying non-hideable

**Given** the persisted preferences store
**Then** it is a client-only, app-global UI-prefs surface (NOT per-doc, NOT in `library.json`/`meta.json`), it degrades safely on a missing/corrupt/older-shape value (fall back to the default `COLUMNS` order + all-visible), and an unknown/removed column key in a stored layout is ignored so a future column-set change can't break an old saved layout (LNFR-5-style forward-compat, AL-3-amended)

**Given** the change
**Then** `tableView.ts`'s fixed `COLUMNS` const becomes an ordered, persisted list threaded through `useTableView`; client tests + typecheck stay green, `no-raw-values` re-run after any CSS, no em-dash in any new UI string; the reorder + persistence are live-smoked (reorder, hide, resize, reload → layout restored)

> **Out of scope (this story):** persisting the active sort; per-doc or server-synced layout (this is one app-global client layout); adding/removing columns beyond reordering the existing set. **Open design calls for create-story:** whether Title is drag-pinned-first or freely movable; the exact drag library vs a hand-rolled HTML5 DnD (adopt a stable primitive per CLAUDE.md if it fits); the localStorage key + versioned schema for the prefs blob.

## Story 7.11: Tag-type columns, Author as editable, filterable tags (added 2026-07-08)

> User request (2026-07-08, with a Notion screenshot): columns should support a "tag" cell type (Notion-style chips), and the Author column should be the first to use it. Today the domain layer already carries the honest `ExtractedMeta.authors: list[str]`, but storage FLATTENS it to a single joined `DocMeta.authors: str | None` display string, and the client renders/inline-edits that one string. This story introduces a column CELL-TYPE seam (a column declares text / number / badge / tag; the renderer dispatches) and makes Author a `tag` column: each author is a chip, the multi-value list is surfaced end-to-end, and authors become editable (add/remove chips) and filterable (click/scope to an author). Colors are NOT in this slice (decided with the user): chips render with a uniform token style, per-value color assignment is a follow-up. This is the larger of the two 2026-07-08 stories, it changes the authors representation (a `meta.json` schema decision), the API contract (Pydantic → OpenAPI → TS), and the inline-edit + filter seams.

As a reader,
I want the Author column to show each author as its own tag that I can add, remove, and filter by,
So that authorship reads and behaves like a real multi-value field instead of one flat string.

**Acceptance Criteria:**

**Given** the collection table
**Then** a column can declare a `cellType` (text / number / badge / tag) and the table dispatches rendering on it (a small registry/descriptor, not a per-column `if` chain); this story introduces the cell-type dispatch seam, which the Epic 7 refactor (Story 7.12, now the last story) later consolidates as the canonical column-descriptor/renderer seam, with Author declared `tag` (LFR-4, AD-5-style dispatch)

**Given** the authors value (domain already `list[str]`, storage currently joins it to one string)
**Then** authors are surfaced as a first-class list end-to-end: `meta.json`/`DocMeta` holds the list (schema handling is an open call, additive `authors_list` kept alongside the derived join, vs a typed migration with a `schema_version` bump + old-doc read path), `CollectionRow` exposes the list (additive contract: Pydantic → OpenAPI → regenerated TS types; `docs/API.md` updated), projected in `_cache_from_meta` (AL-1, AL-6, AL-8, NFR-5)

**Given** the Author cell rendered as tags
**Then** each author is a distinct chip (uniform token style this story, no per-value colors yet, but the chip style is token-driven and color-ready), the cell wraps to multiple chips, and it truncates/never reflows the frame like the other cells (L-UX-DR3)

**Given** a selected paper's Author cell
**When** I add or remove an author tag (a Notion-style "select or create" affordance)
**Then** the change persists to `meta.json` through the existing edit path (extends Story 6.6 inline-edit / the command path, AR-7/AD-7): `DocPatch` (or a successor) accepts the author list or an add/remove op; the `library.json` display cache refreshes; no author is silently lost (LFR-4, FR-10-style never-lost)

**Given** the tag filter
**When** I click an author chip or set an Author filter
**Then** the table filters to rows containing that author, integrating with Story 7.4's Filter control (a tag filter is a set-membership match on the author list, not a substring on a joined string) (LFR-6)

**Given** any new UI string (chip labels, the add-author affordance, the filter copy, aria-labels)
**Then** none contains an em-dash (L-UX-DR13); the chips + editor are keyboard-operable with visible focus (L-UX-DR12)

> **Out of scope (this story):** per-value / user-assignable tag COLORS (deferred follow-up, the chip style is left color-ready); applying `tag` type to columns other than Author (Topics/Type/etc. from the screenshot come later once the seam is proven); a general tag-management surface (rename/merge/recolor a tag across the collection). **Open design calls for create-story:** the `meta.json` authors-list schema handling (additive field vs type migration + `schema_version` bump); whether editing tags flows through `DocPatch` (widened to a list) or a dedicated add/remove endpoint; the author-string → list parse/back-compat for papers imported before this; sequencing: the Epic 7 refactor (Story 7.12) now runs AFTER this and consolidates the cell-type seam this story introduces, and vs Story 7.9 (both add/alter columns; 7.9 lands first).

## Story 7.12: Epic 7 structural refactor (modularize the whole organize/curate surface) (added 2026-07-07, resequenced to last 2026-07-08)

> User request (2026-07-07; resequenced to the LAST Epic 7 story 2026-07-08): the Epic 7 structural refactor runs after EVERY feature story has landed, so it decomposes the whole Epic 7 surface in one pass instead of chasing a moving target. By the time it runs, that surface includes folders CRUD + nest, assign/filter, batch move, display/sort/hide + column-resize, Trash, Recent, Starred, the Venue/Year/DOI metadata columns (Story 7.9), the drag-reorder + persisted table-view-preferences `localStorage` store (Story 7.10), and the column cell-type/tag seam with Author-as-tags (Story 7.11). As of the 2026-07-07 baseline the debt already included: `client/src/library/CollectionTable/CollectionTable.tsx` (629 lines fusing header/sort menus, column-resize, selection + Shift-range, drag-preview, group headers, and row rendering), which 7.10 (drag-reorder) and 7.11 (the cell-type dispatch + tag cell + tag editor) grow further; `LibraryPage.tsx` (449, per-lens copy + two-branch toolbar + star/trash/move/selection sprawl); the near-twin optimistic op hooks (`useMovePapers`/`useTrashPapers`/`useStarPapers`, plus any 7.11 author-edit op); the client column model spread across `tableView.ts` (`COLUMNS`/`sortKey`) + `useTableView` + `useColumnWidths` + the new 7.10 table-view-prefs store; `server/app/storage/library_index.py` (453, folder CRUD + subtree delete + the near-identical set-based `move`/`trash`/`restore`/`star`/`unstar` mutators, plus the 7.9 `_cache_from_meta` growth and any 7.11 author-list projection); and `routes/library.py`'s repeated `DocIdSet -> storage_errors -> storage.X_papers` handler bodies. Audit inter-module dependencies, dedupe, abstract the recurring shapes into shared units, and simplify conditional sprawl. A pure refactor thread, same footing as Story 5.0 / 5.3 / 5.4 / 6.8, its own PR(s), never folded into a feature story. No behavior or contract change.

As a developer,
I want the full Epic 7 code (client `library/` + backend `storage`/`domain`/`routes`), including the 7.9 metadata columns, the 7.10 persisted table-layout store, and the 7.11 cell-type/tag seam, decomposed into cohesive single-responsibility modules with dependencies audited, duplication removed, and conditional sprawl simplified,
So that Epic 7 closes on legible modular seams instead of an over-large table component, a bloated composition root, near-twin op hooks, and an ad-hoc cell-type dispatch.

**Acceptance Criteria:**

**Given** `client/src/library/CollectionTable/CollectionTable.tsx` (the header + per-column sort/hide menus, column-resize AND drag-reorder handles, the selection + Shift-click range model, the custom drag-preview, Recent group-header rows, the cell-type/tag dispatch, and row rendering)
**Then** it is decomposed into cohesive units under `CollectionTable/` (e.g. a header/column-controls unit, the selection/range model as a hook or leaf, the drag-preview builder, the group-header rows, the cell-type renderers), each colocated with its `.css` + `.test.tsx` per the Story 5.4 `components/<Name>/` convention, so no single file owns more than one concern; the table's public props stay unchanged so `LibraryPage` is unaffected

**Given** `LibraryPage.tsx` (fetch/loading wiring + per-lens `emptySelectionMessage`/`selectionLabel`/`visibleColumns` derivations + a two-branch toolbar + star/trash/move/purge/selection handlers)
**Then** the per-lens view-state derivations and the toolbar are extracted into cohesive units (e.g. a lens-copy/columns helper module and a `LibraryToolbar` component owning the trash-vs-non-trash branch), leaving `LibraryPage` a thin composition root; behavior (which button shows in which lens, the counts, the empty copy) is byte-identical

**Given** the near-twin paper-org op hooks `useMovePapers` / `useTrashPapers` / `useStarPapers` (and any Story 7.11 author-edit op), each an optimistic patch -> API call -> reconcile-from-returned-`Library` -> revert-`prior`+error-toast skeleton sharing one `mountedRef` + monotonic `opSeqRef` guard
**Then** the shared optimistic-mutation machinery is abstracted into ONE reusable seam (e.g. a `useOptimisticLibraryOp` the verbs configure with an optimistic patch + API fn + error copy), so adding the next org op is registering one descriptor, not copying another near-twin hook; the StrictMode `mountedRef` reset and stale-response `opSeqRef` guard live in one place

**Given** the client column + table-layout model spread across `tableView.ts`, `useTableView`, `useColumnWidths`, and the Story 7.10 `localStorage` table-view-preferences store (order + visibility + widths)
**Then** the table-view-preferences persistence (its degrade-safe load/parse/versioned schema and the unknown-column-key skip) lives in ONE cohesive client-only leaf, not scattered across the view-state hooks, and the column model (descriptor + cell-type + sort-key + widths) reads as one coherent set of leaves; the Story 7.11 cell-type registry is consolidated as the canonical column-descriptor/renderer seam (7.11 introduces it under feature pressure; 7.12 makes it the clean seam), not an ad-hoc branch

**Given** `server/app/storage/library_index.py` (folder create/rename/delete + subtree re-home, the near-identical set-based `move`/`trash`/`restore`/`star`/`unstar` mutators, and the `_cache_from_meta` projection grown by 7.9's doi/venue/year and any 7.11 author-list, each a `mutate_index` closure)
**Then** the folder-tree operations and the set-based paper-org mutators are separated into cohesive modules behind the stable `storage` facade (every `storage.<fn>` call site stays byte-identical), and the repeated build-`papers_by_id` -> validate-unknown-ids -> apply-field pattern is consolidated to one helper the flag-flip mutators share; storage stays the ONLY code touching `~/.paper-mate` (AL-9) and the single index lock stays the sole `library.json` writer (AL-7)

**Given** `routes/library.py` repeats a near-identical handler body for `trash`/`restore`/`star`/`unstar` (a `DocIdSet` body -> `storage_errors("Could not update the collection")` -> `storage.X_papers(body.doc_ids)`, plus the same 404/422/500 `responses=` map)
**Then** the duplicated `responses=` map and the set-based-op handler shape are each consolidated to one definition (a shared responses constant + a thin dispatch), leaving each route a thin controller; the distinct-404 move route and the folder CRUD routes stay explicit where their error surface differs

**Given** duplication and dead code across the Epic 7 surface (client and server)
**Then** logic duplicated across these files (or vs. the Epic 6 `library/` units and the `storage`/`domain` server layers) is consolidated to one definition, and dead code (unreferenced exports, stale branches, superseded comments) is deleted, not left "just in case"

**Given** the refactor
**Then** it is BEHAVIOR- and CONTRACT-identical: client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` regenerate byte-identical, `no-raw-values` re-run after any CSS move, no em-dash introduced in any UI string, and the folder-filter / batch-move / Trash / Starred / sort / reorder / tag paths re-smoked live (the folder-view Location-hide, the never-clip star, the toolbar lens branches, a reload-restores-layout check, a tag add/remove); its own PR(s), never folded into a feature story

**Given** AD-9 downward layering (client `render/`->`anchor/`->`annotations/`->`App`; server `routes/`->`domain`/`storage`) and the domain's no-storage-import rule (AD-L2)
**Then** the new module boundaries respect it: no upward imports, routes stay thin, storage stays the sole data-root writer, and the client `library/` units keep the view-state lens (`folderFilter`/`tableView`) as pure, React-free leaves

> **Out of scope (this story):** any new organize capability, column, or lens (7.12-7.11 are the feature stories; this is cleanup only); the descoped Note file-type (7.6). **Open design calls for create-story:** whether the shared optimistic-op seam is a hook factory vs a descriptor map; how far to split `CollectionTable` without over-fragmenting; whether the backend split is two modules (`folders` + `paper_org`) or a lighter dedupe-in-place; whether the Story 7.11 cell-type registry is already the right seam or needs further generalization.
