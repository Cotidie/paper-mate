# Paper Mate API

Human-readable reference for the backend HTTP surface.

> **Source of truth = the Pydantic models, not this file.** The contract is
> generated `Pydantic (server/app/models.py) → FastAPI OpenAPI → server/openapi.json → client/src/api/schema.d.ts` (AD-3). This doc is a maintained companion — **update it in the same change that adds or alters an endpoint.** When in doubt, the running app's `/docs` (Swagger UI) and `server/openapi.json` win.

## Conventions

- **Base path:** all endpoints live under `/api`. Same-origin in prod (FastAPI serves API + built SPA); dev proxies `/api` → FastAPI (AD-10).
- **Format:** REST/JSON.
- **Errors:** one envelope only — FastAPI default `{ "detail": string }` — for every error, including validation failures (AR-11). Clients map failures to fixed user copy (e.g. the load-failure toast); the `detail` string is developer-facing.
- **IDs:** `doc_id` = SHA-256 hex of the original PDF bytes; `annotation.id`/`group_id` = UUIDv4 (Epic 2). **Dates:** ISO-8601 UTC strings.
- **Auth:** none (localhost, single user).

## Resources

### `GET /api/health`

Liveness probe. No filesystem access.

- **200** → `HealthStatus`
  ```json
  { "status": "ok", "version": "0.0.1" }
  ```
  `version` is the running app version. Single source = `server/pyproject.toml`
  (`[project].version`), read at runtime via `app.version.get_version()`.

### `POST /api/docs` — import a PDF

Upload a PDF from disk. The storage module computes `doc_id` = SHA-256 of the
bytes and stores `source.pdf` + `meta.json` under
`{data_root}/library/{doc_id}/`. Import is **idempotent by `doc_id`**: re-importing
the same bytes never overwrites an existing `annotations.json`/`meta.json` — only
`meta.last_opened` advances (AD-8).

A **new** import returns immediately at `status: "extracting"` and does the
metadata work off the request path (NFR-3, Story 6.5): a **background task**
runs `extract` (Title/Authors/DOI via PyMuPDF over `/Info` + XMP + a font-size
heuristic) then `enrich` (Crossref, DOI-first with a title/authors fallback,
degrading to a non-error skip when offline). Storage then settles the row to
`ready` (Crossref corrected it), `enrich-skipped` (local fields kept, no
external correction), or `parse-failed` (nothing found: a never-lost
filename-title row). The client **polls `GET /api/library`** until every row
settles. An **idempotent re-import** of an already-settled paper does **not**
re-extract; it keeps its stored `status` and only advances `last_opened`. If
the existing paper was **trashed**, the re-import also **restores** it
(clears `trashed`, keeps its retained `folder_id`, Story 7.5 AC-5), rather
than creating a duplicate row or a second `library/{doc_id}/` dir.

- **Request:** `multipart/form-data`, field `file` = the PDF.
- **200** → `Doc`
  ```json
  {
    "doc_id": "40cb003b…c0347f4",
    "filename": "paper.pdf",
    "title": "A Paper",          // string | null (from PDF metadata)
    "page_count": 12,
    "added": "2026-06-28T00:00:00+00:00",
    "last_opened": "2026-06-28T00:00:00+00:00",
    "authors": null,             // string | null; derived join of authors_list, never authored directly
    "authors_list": [],          // string[]; the authoritative multi-value field, filled by background enrichment
    "file_type": "pdf",          // "pdf" | "note"
    "status": "extracting",      // a new import; settles to ready | enrich-skipped | parse-failed
    "doi": null,                  // string | null; extraction-sourced, filled on settle
    "venue": null,                // string | null; Crossref-sourced, filled on settle
    "year": null,                 // int | null; Crossref-sourced, filled on settle
    "schema_version": 1
  }
  ```
- **400** → `{ "detail": "Could not read PDF file" }` — corrupt, empty, or non-PDF bytes. Nothing is written.

> `Doc` = `doc_id` + the on-disk `meta.json` schema (`DocMeta`:
> `filename, title, page_count, added, last_opened, authors, authors_list, file_type, status, doi, venue, year, schema_version`).
> `doc_id` is the library folder name and is **not** stored inside `meta.json`
> (AD-8). `authors`/`file_type`/`status` are additive (Story 6.2); `doi`/`venue`/`year`
> are additive (Story 7.9, Crossref new-imports-only). `authors_list` is additive
> (Story 7.11, no `schema_version` bump): it is the authoritative multi-value
> field; `authors` is always its derived join, never independently authored.
> A pre-7.11 `meta.json` (a joined `authors` string, no `authors_list` key)
> self-heals on read: `authors_list` is derived by splitting on `", "`
> (best-effort — exact unless an author name itself contains `", "`). A new
> import lands at `status: "extracting"`; the background pipeline (Story 6.5)
> drives the `extracting -> ready | enrich-skipped | parse-failed` transitions
> and fills `authors_list` and (when Crossref matches) `doi`/`venue`/`year`.
> This import also indexes the paper into `library.json` (see `GET
> /api/library` below) as Uncategorized, untrashed, at the next order.

### `GET /api/docs/{doc_id}` — get a document's own metadata

Return a document's own metadata, so a route that only has a `doc_id` (e.g.
the router's `/reader/:docId`, Story 6.1, AD-L6) can resolve `filename`/
`page_count` without re-parsing the PDF.

- **200** → `Doc` (same shape as the `POST /api/docs` response).
- **404** → `{ "detail": "Document not found" }` — no `meta.json` for `doc_id`.
- **500** → `{ "detail": "Could not read document" }` — a corrupt or
  unknown-version on-disk record.

### `POST /api/docs/{doc_id}/open` — mark a document opened

Advance `meta.last_opened` when a paper opens from the Library (Story 6.7,
AC-4). A mutation, so `POST` rather than a side-effecting `GET`: `GET
/api/docs/{doc_id}` above stays a pure, side-effect-free read of a document's
own metadata; opening uses this endpoint instead. `meta.json` is authoritative
for `last_opened`; the write also refreshes the `library.json` display cache
through the same write-and-reindex core `PATCH` uses, but that cache carries
no `last_opened`, so the rendered collection row is unchanged (no v1 UI
surfaces this field). The client's `ReaderPage` fires this as a best-effort,
error-swallowed side effect after hydrate succeeds; a failure here never
aborts an otherwise-readable open.

- **Request body:** none.
- **200** → `Doc` (the full updated document, same shape as `GET /api/docs/{doc_id}`).
- **404** → `{ "detail": "Document not found" }` — no `meta.json` for `doc_id`.
- **500** → `{ "detail": "Could not update document" }` — a storage failure.

### `PATCH /api/docs/{doc_id}` — partially update title/authors/venue/year

Correct a wrong `title`, `authors`, `venue`, or `year` in place (Story 6.6;
`venue`/`year` added by a Story 7.9 fix request; `authors` -> `authors_list`
in Story 7.11, AD-L6). `meta.json`
is authoritative; the write also refreshes the `library.json` display cache
(`GET /api/library` reflects the change with no separate read path). Editing
never changes `status`, `page_count`, `added`, or `last_opened`. `doi` is
NOT patchable here (link-only cell, Story 7.9's scope boundary).

- **Request body:** `DocPatch` — `{ "title"?: string | null, "authors_list"?: string[] | null, "venue"?: string | null, "year"?: int | null }`.
  Only fields present in the body change (`exclude_unset` partial semantics);
  a present empty/whitespace `title`/`venue` normalizes to `null` (Title
  falls back to the filename display fallback; Venue renders empty).
  `authors_list` is a **full-list replacement** (add appends, remove drops,
  the client sends the whole intended list): each entry is stripped and
  blanks are dropped, and an empty resulting list is a legitimate "cleared
  authors" edit (derives `authors: null`), not a no-op. `extra="forbid"`: a
  non-editable field (e.g. `status`, `doi`) is rejected, not silently dropped.
- **200** → `Doc` (the full updated document, same shape as `GET /api/docs/{doc_id}`).
- **400** → `{ "detail": "No fields to update" }` — empty body.
- **404** → `{ "detail": "Document not found" }` — no `meta.json` for `doc_id`.
- **422** → `{ "detail": string }` — a malformed or forbidden field (AR-11 envelope).
- **500** → `{ "detail": "Could not update document" }` — a storage failure.

### `DELETE /api/docs/{doc_id}`: purge a document

Permanently delete a document (Story 7.5 AC-4, AL-5.3, AL-6): removes the
whole `library/{doc_id}/` dir (`source.pdf` + `meta.json` + `annotations.json`)
**and** its `library.json` entry. Manual only: no auto-purge, no retention
timer, no undo. Crash-safe ordering: the on-disk dir is removed **before** the
index entry is pruned (both under the same serialized lock), so a crash
between the two steps never resurrects the purged paper on the next boot's
reconcile.

- **Request body:** none.
- **200** → `Library` (the same shape as `GET /api/library`: the purged paper
  is absent, every other paper/folder unchanged), so the client reconciles
  from one round-trip.
- **404** → `{ "detail": "Document not found" }`: unknown or already-purged
  `doc_id`.
- **500** → `{ "detail": "Could not purge document" }`: a storage failure.

### `GET /api/docs/{doc_id}/file` — stream the stored PDF

Return the raw bytes of a document's stored `source.pdf`. The render layer
fetches this by `doc_id` (never the filesystem); storage owns the path (AR-9).

- **200** → `application/pdf` (the exact stored bytes; `FileResponse`).
- **404** → `{ "detail": "Document not found" }` — no document or `source.pdf` for `doc_id`.

### `PUT /api/docs/{doc_id}/annotations` — overwrite the full annotation set

Client autosave path (AR-7, H6): a debounced, single-flight PUT that sends the
**entire current annotation set** for the document, every time. The backend is
a dumb store: it has no history, undo, or merge logic, and overwrites
`{data_root}/library/{doc_id}/annotations.json` atomically (temp + rename)
with exactly what it received.

- **Request body:** bare `Annotation[]` (H9: the API body is bare; the
  `{schema_version, annotations}` envelope is added only on disk, inside
  storage).
- **200** → the same `Annotation[]` it received (echoed; the client ignores
  the body).
- **404** → `{ "detail": "Document not found" }` — `doc_id` has no `meta.json`
  (never imported). An annotations file is never created for an unknown doc.
- **422** → `{ "detail": string }` — malformed body (AR-11 envelope).
- **500** → `{ "detail": "Could not save annotations" }` — a storage failure
  other than an unknown doc.

> On-disk shape (internal, never sent/received over the API): `{ "schema_version": 1, "annotations": [Annotation, ...] }`.

### `GET /api/docs/{doc_id}/annotations` — read the saved annotation set

Hydrate-on-open path (AR-6, AD-6): the client GETs this once when a document is
opened and restores the marks into its working copy, BEFORE the reader mounts.
The disk envelope is stripped inside storage — the API body is the bare list (H9).

- **200** → bare `Annotation[]` (the saved set). An **imported-but-unannotated**
  doc (no `annotations.json` on disk) returns `[]` (a normal 200, not a 404).
- **404** → `{ "detail": "Document not found" }` — `doc_id` has no `meta.json`
  (never imported).
- **500** → `{ "detail": "Could not read annotations" }` — a corrupt
  `annotations.json` or an unknown on-disk `schema_version` (rejected, never
  guessed — AD-8).

### `GET /api/library` — read the collection index

The organization layer (AD-L6): the collection table + folder tree in **one
read** from `{data_root}/library.json`, no per-doc `meta.json` fan-out. This is
the collection list (`GET /api/docs` list stays Reserved). `folders` reflects
whatever the folder CRUD below (`/api/library/folders`, Story 7.1) has
created; a paper is Uncategorized (`folder_id: null`) until assigned to one
(assignment is Story 7.2) and untrashed until Story 7.5.

- **200** → `Library`
  ```json
  {
    "papers": [
      {
        "doc_id": "40cb003b…c0347f4",
        "title": "A Paper",
        "authors": null,
        "authors_list": [],
        "added": "2026-06-28T00:00:00+00:00",
        "last_opened": "2026-06-28T00:00:00+00:00",
        "file_type": "pdf",
        "status": "ready",
        "folder_id": null,
        "trashed": false,
        "starred": false,
        "order": 0,
        "filename": "a-paper.pdf",
        "doi": null,
        "venue": null,
        "year": null
      }
    ],
    "folders": []
  }
  ```
- **500** → `{ "detail": "Could not read library" }` — an unreadable or
  wrong-shape `library.json` (unknown `schema_version`, invalid JSON/shape).

> `library.json` is the authoritative index for **cross-doc** state: the
> folder tree, membership (paper → ≤1 folder), trash, star, and paper order. A
> paper's **own** fields (title/authors/authors_list/added/last_opened/file_type/status/
> filename/doi/venue/year) stay authoritative in its `meta.json`;
> `CollectionRow`'s display fields are a non-authoritative cache of that
> projection, refreshed from `meta.json` on every index write, so this
> endpoint never opens N `meta.json` files (LNFR-4). At boot, storage
> reconciles `library.json` against `library/{doc_id}/` dirs on disk (adds an
> unindexed dir as Uncategorized, prunes an index entry whose dir vanished,
> best-effort skip on a missing/corrupt `meta.json`) so papers imported
> before Story 6.2 (or out-of-band) still show up here. `filename` (Story 6.3
> fix), `last_opened` (Story 7.7, drives the client Recent lens), and
> `doi`/`venue`/`year` (Story 7.9) are optional (`null` on a pre-existing row
> cached before the field existed) and backfill on the next reconcile; the
> client falls back to `filename` when `title` is null. `starred` (Story 7.8)
> is org state authoritative in `library.json` itself (like `trashed`), not
> meta-derived: `bool = False` default so a pre-existing row cached before
> the field existed still validates as unstarred, with no forced backfill.
> `doi`/`venue`/`year` are Crossref new-imports-only (Story 7.9): a paper
> imported before this feature, or with no Crossref match, keeps `null`
> until it is re-imported; `doi` is sourced from the PDF extraction (not the
> matched Crossref work), `venue`/`year` from Crossref's `container-title` /
> `issued` date, falling back to arXiv's own record (fix request) when
> Crossref has no venue and the PDF carries an arXiv id.

### `POST /api/library/folders` — create a folder

Appends a folder to the organizing tree (AL-5/AL-6, Story 7.1), optionally
nested under an existing folder.

- **Body** → `FolderCreate`
  ```json
  { "name": "Reading list", "parent_id": null }
  ```
- **200** → `Folder`
  ```json
  { "id": "c3b2b7b0-…-9e2a", "name": "Reading list", "parent_id": null }
  ```
- **404** → `{ "detail": "Folder not found" }` — `parent_id` does not
  reference an existing folder.
- **422** → a blank/whitespace `name` (rejected before it can ever persist)
  or an extra/forbidden field.
- **500** → `{ "detail": "Could not update folders" }` — an unreadable or
  wrong-shape `library.json`.

### `PATCH /api/library/folders/{folder_id}` — rename a folder

Changes only a folder's `name`; membership is keyed by `id`, so a rename
never orphans a paper (AC-2, Story 7.1).

- **Body** → `FolderRename` (`{ "name": "..." }`)
- **200** → `Folder` (the renamed folder)
- **404** → `{ "detail": "Folder not found" }` — unknown `folder_id`.
- **422** → a blank/whitespace `name`.
- **500** → `{ "detail": "Could not update folders" }`.

### `DELETE /api/library/folders/{folder_id}` — delete a folder (subtree)

Deletes the folder **and its whole subtree** (every descendant folder), and
re-homes every paper anywhere in that subtree to Uncategorized (`folder_id:
null`). **No paper is ever deleted** (ratifies PRD A1, Story 7.1).

- **200** → `Library` (the same shape as `GET /api/library`: the re-homed
  papers + the surviving folders), so the client reconciles both from one
  response.
- **404** → `{ "detail": "Folder not found" }` — unknown `folder_id`.
- **500** → `{ "detail": "Could not update folders" }`.

### `POST /api/library/move` — move papers to a folder

Set-based assignment (AD-L6, Story 7.2): the same `{doc_ids}` contract Story
7.3's batch move and Story 7.5's batch trash/restore reuse. Assigns every id
in `doc_ids` to `folder_id`; `folder_id: null` clears membership
(Uncategorized). A move **replaces** any prior folder, so a paper belongs to
at most one folder at a time. A single-paper move is just `doc_ids: [oneId]`.

- **Body** → `MoveRequest`
  ```json
  { "doc_ids": ["3fae1c…"], "folder_id": "c3b2b7b0-…-9e2a" }
  ```
- **200** → `Library` (the same shape as `GET /api/library`: updated
  membership + the unchanged folder tree), so the client reconciles from one
  round-trip.
- **404** → `{ "detail": "Folder not found" }` — `folder_id` does not
  reference an existing folder — **or** `{ "detail": "Document not found" }`
  — some id in `doc_ids` does not reference an existing paper. Either fault
  aborts the whole move (all-or-nothing, no partial write).
- **422** → `doc_ids` is empty, or an extra/forbidden field.
- **500** → `{ "detail": "Could not update the collection" }` — an unreadable
  or wrong-shape `library.json`.

> `MoveRequest` subclasses a base `DocIdSet` (`{ "doc_ids": [...] }`,
> `extra="forbid"`, `doc_ids` non-empty): the shared set-based org-op
> contract every trash/restore/move route reuses (AD-L6, Story 7.5). `trash`
> and `restore` below take a bare `DocIdSet` (no target field); `MoveRequest`
> adds only `folder_id`.

### `POST /api/library/trash`: soft-delete papers

Set-based soft-delete (AD-L6, Story 7.5 AC-1, AL-5.1): flips `trashed` to
`true` for every id in `doc_ids`. `folder_id`, `order`, and every stored
per-document file (`annotations.json`/`meta.json`/`source.pdf`) are
**untouched**: this is organizational only. A trashed paper leaves the
normal/folder views (excluded by the client's folder filter) and surfaces
only in the Trash lens, retaining its `folder_id` while trashed.

- **Body** → `DocIdSet`
  ```json
  { "doc_ids": ["3fae1c…"] }
  ```
- **200** → `Library` (the same shape as `GET /api/library`).
- **404** → `{ "detail": "Document not found" }`: some id in `doc_ids` does
  not reference an existing paper (all-or-nothing, no partial write).
- **422** → `doc_ids` is empty, or an extra/forbidden field.
- **500** → `{ "detail": "Could not update the collection" }`.

### `POST /api/library/restore`: restore trashed papers

Set-based restore (AD-L6, Story 7.5 AC-3, AL-5.2): flips `trashed` to `false`
for every id in `doc_ids`. `folder_id` is left as-is: it is the remembered
folder; if that folder was deleted while the paper was trashed, `delete_folder`
already re-homed it to Uncategorized (`folder_id: null`) regardless of
`trashed`, so restoring always lands on a live folder or Uncategorized, never
a dangling id.

- **Body** → `DocIdSet`
  ```json
  { "doc_ids": ["3fae1c…"] }
  ```
- **200** → `Library` (the same shape as `GET /api/library`).
- **404** → `{ "detail": "Document not found" }`: some id in `doc_ids` does
  not reference an existing paper (all-or-nothing, no partial write).
- **422** → `doc_ids` is empty, or an extra/forbidden field.
- **500** → `{ "detail": "Could not update the collection" }`.

### `POST /api/library/star`: star papers

Set-based star (AD-L6, Story 7.8 AC-1, AL-5): flips `starred` to `true` for
every id in `doc_ids`. `folder_id`, `order`, `trashed`, and every stored
per-document file (`annotations.json`/`meta.json`/`source.pdf`) are
**untouched**: this is organizational only.

- **Body** → `DocIdSet`
  ```json
  { "doc_ids": ["3fae1c…"] }
  ```
- **200** → `Library` (the same shape as `GET /api/library`).
- **404** → `{ "detail": "Document not found" }`: some id in `doc_ids` does
  not reference an existing paper (all-or-nothing, no partial write).
- **422** → `doc_ids` is empty, or an extra/forbidden field.
- **500** → `{ "detail": "Could not update the collection" }`.

### `POST /api/library/unstar`: unstar papers

Set-based unstar (AD-L6, Story 7.8 AC-1, AL-5): flips `starred` to `false`
for every id in `doc_ids`.

- **Body** → `DocIdSet`
  ```json
  { "doc_ids": ["3fae1c…"] }
  ```
- **200** → `Library` (the same shape as `GET /api/library`).
- **404** → `{ "detail": "Document not found" }`: some id in `doc_ids` does
  not reference an existing paper (all-or-nothing, no partial write).
- **422** → `doc_ids` is empty, or an extra/forbidden field.
- **500** → `{ "detail": "Could not update the collection" }`.

## Reserved (not yet built)

Declared by the architecture (AR-11), implemented in later stories. Do not
assume these exist until they appear above.

| Method & path | Purpose | Story |
| --- | --- | --- |
| `GET /api/docs` | List library documents | TBD |

> **`Style` fields:** `color` (token name), `stroke_width` (pen-only, scale-1.0 px; `null` for text/region marks), `alpha` (pen-only transparency 0..1; `null` = render at the default highlighter opacity `0.4`; additive optional field, Story 2.13, AD-8), `collapsed` (memo-only; `null`/`false` = expanded (default), `true` = show only the memo's first line; additive optional field, user feature request 2026-07-02, AD-8), `bubble_width`/`bubble_height` (comment-only, CSS px chrome size of the note popup, NOT page-anchored geometry; `null` = default CSS size until the user drags the bubble's corner handle to resize it; additive optional fields, user feature request 2026-07-03, AD-8).

## Changelog

- **2026-07-10 (Story 7.11):** `authors` becomes a first-class list end-to-end. `DocMeta` and `CollectionRow` gain `authors_list: string[]` (additive, default `[]`, no `schema_version` bump); `authors` stays but is now always the derived join of `authors_list` (never independently authored). A pre-7.11 `meta.json`/`library.json` row (a joined `authors` string, no `authors_list` key) self-heals its list on read by splitting on `", "` (best-effort). `DocPatch.authors` is replaced by `DocPatch.authors_list: string[] | null` — a full-list replacement (the client sends the complete intended author list; an empty list is a legitimate clear, not a no-op). No new path; contract shape change on `Doc`/`CollectionRow`/`DocPatch`.
- **2026-07-08 (Story 7.9 fix request):** venue/year/doi/authors gain an arXiv fallback during the existing background enrichment: when Crossref leaves `venue` unset AND the PDF carries an arXiv id (a stamp like `arXiv:2103.12345v2` found in the extracted text), arXiv's own record (via the `arxiv` client library) fills `venue` (its `journal_ref` if the preprint was later formally published, else the literal `"arXiv"`) and `year` (the submission year); when the PDF/Crossref left `doi`/`authors` empty too, arXiv's own self-assigned DOI (the deterministic `10.48550/arXiv.<id>` pattern) and its author list fill those in as well. Crossref, when it does have an answer, stays authoritative; the fallback only fires on a Crossref miss, and never overwrites a real extraction/Crossref-sourced value. No contract change (still the same `DocMeta`/`CollectionRow` fields from Story 7.9), no new path.
- **2026-07-08 (Story 7.9 fix request):** `DocPatch` gains `venue: str | null`, `year: int | null` (additive; `PATCH /api/docs/{doc_id}` now edits Venue/Year inline alongside Title/Authors). `doi` stays NOT patchable (link-only cell). No new path, no `schema_version` bump.
- **2026-07-08 (Story 7.9):** `CollectionRow` gains `doi: str | null`, `venue: str | null`, `year: int | null` (additive, all default `null`; `GET /api/library`'s `Library` response); `DocMeta` gains the same three fields (its `meta.json`-authoritative source); `ExtractedMeta` (internal, not in the OpenAPI schema) gains `venue`/`year` alongside its existing `doi`. Meta-derived cache (like `filename`/`last_opened`), projected through `_cache_from_meta` so it auto-seeds new imports and backfills a pre-existing row on the next reconcile. `venue`/`year` are captured from Crossref (`container-title[0]`, and the first of `issued`/`published-print`/`published-online`/`published` `date-parts[0][0]`) during the existing enrichment; `doi` stays the PDF-extraction-sourced value (not the matched Crossref work's `DOI`). Crossref new-imports-only: no backfill/re-enrich pass over the existing library. No new path, no `schema_version` bump.
- **2026-07-07 (Story 7.8):** added `POST /api/library/star`, `POST /api/library/unstar` (set-based `DocIdSet`: `{doc_ids}`, reused verbatim, no new schema). `CollectionRow` gains `starred: bool = False` (additive, org state authoritative in `library.json`, peer of `trashed`, not meta-derived; the key being absent on a pre-existing row cached before the field existed defaults to unstarred, no forced backfill). Star/unstar 404 on an unknown `doc_id` (all-or-nothing, no partial write). Contract shape change: two new paths + `CollectionRow.starred`.
- **2026-07-07 (Story 7.7):** `CollectionRow` gains `last_opened: str | null` (additive, default `null`; `GET /api/library`'s `Library` response), projected from `meta.json` (already advanced on open by `POST /api/docs/{doc_id}/open`, Story 6.7). Populated on every index write through the existing `_cache_from_meta` projection; `reconcile_library()` backfills a pre-existing row cached before the field existed on the next server start. Drives the client's Recent lens (order by `last_opened` desc, grouped under Today/Yesterday/Last week/Last month date buckets, dropping anything older than 30 days - no numeric cap); no new endpoint.
- **2026-07-07 (Story 7.5):** added `POST /api/library/trash`, `POST /api/library/restore` (set-based `DocIdSet`: `{doc_ids}`, `extra="forbid"`, `doc_ids` non-empty) and `DELETE /api/docs/{doc_id}` (purge: removes the whole `library/{doc_id}/` dir and its `library.json` entry, crash-safe rmtree-then-prune order). New base schema `DocIdSet`, which `MoveRequest` now subclasses (adds only `folder_id`; `MoveRequest`'s emitted shape is unchanged). `POST /api/docs`'s idempotent re-import branch now also restores a trashed paper (clears `trashed`, keeps its retained `folder_id`), rather than creating a duplicate row. Trash/restore 404 on an unknown `doc_id` (all-or-nothing); purge 404s on an unknown or already-purged `doc_id`. Contract shape change: three new paths + one new schema (`DocIdSet`).
- **2026-07-06 (Story 7.2):** added `POST /api/library/move` — set-based paper→folder assignment (`MoveRequest`: `{doc_ids, folder_id}`, `extra="forbid"`, `doc_ids` non-empty). `folder_id: null` clears membership; a move replaces any prior folder (at most one). TWO distinct 404s: bad `folder_id` → `"Folder not found"`, unknown `doc_id` → `"Document not found"`; either aborts all-or-nothing. Contract shape change: one new path + one new schema (`MoveRequest`).
- **2026-07-06 (Story 7.1):** added `/api/library/folders` folder CRUD — `POST` (create, optional `parent_id` nesting), `PATCH /{folder_id}` (rename, name-only), `DELETE /{folder_id}` (subtree delete: removes the folder and every descendant, re-homes every paper in the subtree to Uncategorized, returns the updated `Library` in one round-trip; never deletes a paper). New request models `FolderCreate`/`FolderRename` (`extra="forbid"`; a blank/whitespace `name` is a 422). A missing folder is 404 `"Folder not found"`, distinct from the doc-specific `"Document not found"` literal. Contract shape change: three new paths + two new schemas.
- **2026-07-05 (Story 6.7):** added `POST /api/docs/{doc_id}/open` — advances `meta.last_opened` when a paper opens (200 `Doc`, 404 unknown doc, 500 storage failure). A mutation, not the pure `GET /api/docs/{doc_id}` read; reuses the existing `Doc` response model (no new schema). `ReaderPage` fires it as a best-effort, error-swallowed side effect on open; a failure never gates the reader rendering the paper. No UI surfaces `last_opened` (out-of-scope last-opened *tracking* feature, not built). Ratifies the already-shipped open path (hover Open button → `/reader/:docId`, doc-scoped hydrate/autosave/back-to-Library, atomic doc-switch isolation) with test coverage; no other endpoint changed.
- **2026-07-05 (Story 6.6):** added `PATCH /api/docs/{doc_id}` — partial `title`/`authors` edit (new `DocPatch` request model, `extra="forbid"`, `exclude_unset` semantics; 200 `Doc`, 400 empty body, 404 unknown doc, 422 malformed/forbidden field, 500 storage failure). `meta.json`-authoritative; refreshes the `library.json` display cache through the same write-and-reindex core `apply_extraction` uses (`storage.update_doc_meta`). Editing never changes `status`/`page_count`/`added`/`last_opened`. Contract shape change: new path + `DocPatch` schema.
- **2026-07-05 (Story 6.5):** `POST /api/docs` now imports asynchronously. A new import returns at `status: "extracting"` and runs `extract` + `enrich` (Title/Authors/DOI via PyMuPDF, then optional Crossref correction) as a **background task** off the request path; storage settles the row to `ready | enrich-skipped | parse-failed`; the client polls `GET /api/library` until statuses settle. An idempotent re-import does not re-extract. **No contract shape change** (the `status` enum has carried all four values since 6.2; the only generated-file change is the `POST /api/docs` description text). New internal backend: a pure `app/domain/` layer (`extract`/`enrich`, AD-L2) and a storage `apply_extraction` writer. PyMuPDF (AGPL-3.0) added and httpx promoted to a runtime dependency; the repo is relicensed MIT to AGPL-3.0 in the same change.
- **2026-07-05 (Story 6.3 fix, user fix request):** `CollectionRow` gains `filename: str | null` (additive, default `null`; `GET /api/library`'s `Library` response). Populated from `meta.json` on every index write; `reconcile_library()` now also refreshes already-indexed entries (not just newly-discovered dirs), so a `library.json` row cached before this field existed backfills it on the next server start. The client falls back to this (extension stripped) when `title` is null.
- **2026-07-05 (Story 6.2):** added `GET /api/library` (the collection index in one read: `Library = { papers: CollectionRow[], folders: Folder[] }`; 500 on a corrupt/unknown-version `library.json`). `DocMeta`/`Doc` gain `authors: str | null`, `file_type: "pdf" | "note"`, `status: "extracting" | "ready" | "enrich-skipped" | "parse-failed"` (additive, no `schema_version` bump). `POST /api/docs` now also indexes the import into `library.json`; boot reconcile aligns the index with on-disk `library/{doc_id}/` dirs. `GET /api/docs` list stays reserved (the collection list is `GET /api/library`, not a docs scan).
- **2026-07-05 (Story 6.1):** added `GET /api/docs/{doc_id}` (own metadata; 404 unknown doc, 500 corrupt/unknown-version disk record). `GET /api/docs` stays reserved (Story 6.2).
- **2026-07-03 (comment bubble resize, user feature request):** `Style` gains `bubble_width: float | null` + `bubble_height: float | null` (comment-only; `null` = default CSS size; additive, no format break, AD-8). No endpoints added.
- **2026-07-02 (memo collapse/expand, user feature request):** `Style` gains `collapsed: bool | null` (memo-only; `null` = expanded, the default; additive, no format break, AD-8). No endpoints added.
- **2026-07-01 (Story 3.5):** added `GET /api/docs/{doc_id}/annotations` (hydrate-on-open; bare list, `[]` when unannotated, 500 on a corrupt/unknown-version disk file). `components.schemas` shape unchanged (`list[Annotation]` already emitted by the 3.4 PUT). `GET /api/docs` + `GET /api/docs/{doc_id}` stay reserved.
- **2026-07-01 (Story 3.4):** added `PUT /api/docs/{doc_id}/annotations` (overwrite full set, atomic). GET stays reserved (3.5). The manual `Annotation` OpenAPI injection in `app/main.py` is removed: the real PUT route now emits `Annotation` (+ its anchor variants) into the contract.
- **2026-06-30 (Story 2.13):** `Style` gains `alpha: float | null` (pen stroke transparency, 0..1; optional with default `null` = render at highlighter opacity; additive, no format break, AD-8). No endpoints added.
- **2026-06-29 (Story 2.2):** added the `Annotation` entity (+ `Anchor` variants `TextAnchor`/`RectAnchor`/`PathAnchor`, `Rect`, `Point`, `Style`) to `components.schemas` for the generated client type. No endpoints added (the `/annotations` GET/PUT stay Epic 3).
- **2026-06-29:** `HealthStatus` gains `version` (app version, single source `server/pyproject.toml`); surfaced for the top-bar version badge.
- **2026-06-28 (Story 1.3):** added `GET /api/docs/{doc_id}/file` (stream stored PDF bytes).
- **2026-06-28 (Story 1.2):** added `POST /api/docs` (PDF import) + `Doc`/`DocMeta` models.
- **2026-06-28 (Story 1.1):** `GET /api/health` + the contract-generation pipeline.
