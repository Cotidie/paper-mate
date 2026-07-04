---
id: SPEC-paper-mate-library
companions:
  - ../../planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md
  - ../../../DESIGN.md
  - ../../../EXPERIENCE.md
sources:
  - ../../planning-artifacts/prds/prd-paper-mate-library-2026-07-04/prd.md
  - ../../planning-artifacts/prds/prd-paper-mate-library-2026-07-04/addendum.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents in frontmatter are traceability only.

# Paper Mate — Library (Phase 2)

## Why

A **vision to realize** for a single reader (Wonseok). Today Paper Mate opens one PDF from disk with no memory of it: every session starts from an empty reader frame. The Library gives papers a home, a persistent, organized collection that becomes the app's front door. On boot the user lands in the Library, not an empty reader; uploading a PDF files it into a sortable table with auto-filled metadata; papers group into nested folders; a double-click drops straight into the annotator. It turns Paper Mate from a single-file viewer into a reading workspace. Local-first, single-user, same `~/.paper-mate` store, the collection is files on disk the app indexes, no accounts, no cloud.

## Capabilities

- **CAP-1** — Collection & table.
  - **intent:** On boot the user lands in the Library: a table of every paper (Title, Authors, Added, File type, total count) that they can multi-select and whose columns, sort, and filter they control.
  - **success:** Booting opens the table with the four columns and an "N files" count; the user toggles a column, sorts any column ascending/descending, filters by a column value, and multi-selects rows via checkboxes.
- **CAP-2** — Add papers.
  - **intent:** The user adds one or more PDFs in a single bulk action; Paper Mate auto-extracts Title and Authors (embedded metadata + text), optionally enriches them from an external service, and lets the user correct them inline; a paper is never lost to a failed parse.
  - **success:** Dropping N PDFs at once adds N rows without freezing the table; most rows show correct Title/Authors auto-filled; a PDF that yields nothing still enters (filename as title, editable); when enrichment is offline or failing the paper keeps its local fields and a non-error notice says enrichment was skipped.
- **CAP-3** — Folders.
  - **intent:** The user organizes papers into nested custom folders (create, rename, delete), assigns each paper to at most one folder (unfiled papers show under All / Uncategorized), moves papers or multi-selections between folders, and filters the table to a selected folder.
  - **success:** The user creates nested folders, moves a paper (and a multi-selection) into one, selecting a folder filters the table to it, and deleting a folder re-homes its papers to Uncategorized without deleting them.
- **CAP-4** — Open in annotator.
  - **intent:** The user opens a paper into the annotator by double-clicking its row (not an ad-hoc disk picker); the paper's stable identity restores its existing annotations; the user can return to the Library from the reader.
  - **success:** Double-clicking a row enters the annotator on that paper with its prior annotations intact, and a control returns the user to the Library.
- **CAP-5** — Persistence.
  - **intent:** The collection, folder structure, per-paper metadata, and folder assignments persist under `~/.paper-mate` and survive restart.
  - **success:** After restarting the app, the same papers, folders, metadata, and folder assignments are present.
- **CAP-6** — Trash / delete.
  - **intent:** The user soft-deletes a paper (or multi-selection) to a Trash view that retains its annotations, restores a trashed paper to the collection, or purges it to permanently remove the paper and its annotations.
  - **success:** Deleting moves a paper to Trash with its annotations retained; restore returns it to the collection; purge permanently removes the paper and its annotations.
- **CAP-7** — Note file-type (reserved).
  - **intent:** The data model and table support a "Note" file-type distinct from PDF documents, displayed but not authored in-app this sprint.
  - **success:** The table can display a Note-typed entry distinct from a PDF; no in-app note authoring exists.

## Constraints

- **Local-first:** every Library feature works fully offline; the external metadata lookup is the only network call, opt-in, and degrades gracefully offline or on failure (it never blocks the add). (NFR-1)
- **Non-blocking add:** a bulk upload never freezes the table, extraction runs off the interaction path, rows appear as they resolve, and browsing continues during extraction. (NFR-3; see spine AD-L2, AD-L4)
- **Collection scale:** for hundreds of papers, sort, filter, and scroll act without a visible stall. (NFR-4; see AD-L1 display cache)
- **Durable, forward-compatible store:** Library metadata and folder structure persist under `~/.paper-mate` in an additive-tolerant format; a breaking schema change is an AD-8-class persisted-format break and takes a MAJOR version bump. (NFR-5)
- **Safe copy-in:** the uploaded PDF is copied into the collection; the copy never corrupts or loses the original, and a mid-copy failure leaves the collection consistent. (NFR-6; see AD-L4)
- **Same store and identity:** a Library paper reuses the existing `~/.paper-mate/library/{doc_id}/` store and the doc-scoped annotation store; `doc_id` = SHA-256 of PDF bytes is both its identity and its annotation key. (inherited AD-8)
- **No auth, localhost single-user:** no accounts, no multi-user, no CORS. (NFR-2; inherited AD-10)

## Non-goals

- No remote sync, WebDAV, or Google Drive this sprint (F8). It is a planned follow-on epic; the architecture reserves the switchable-backend seam (mirroring the agent abstraction) but does not build it here.
- No in-app note authoring. Note is a reserved, displayed file-type only (CAP-7).
- No Global Search nav, Chats tab, full-text indexing ("Full text: Available"), or viewed / last-opened tracking.
- No change to the annotation model or the reader/annotator itself. The Library only routes into the existing annotator (Epics 1–5); it adds no new annotation entity.

## Success signal

Wonseok boots Paper Mate into his Library, not an empty reader. He drops a dozen papers at once; rows stream in without the table freezing, most already titled and attributed correctly; he files them into nested folders, double-clicks one into the annotator to find last week's highlights intact, and on restart the whole collection, its folders, and its assignments are exactly as he left them.

## Open Questions

- Cross-artifact reconciliation: this epic's AD-L2 (backend domain layer) and AD-L7 (index-write concurrency) amend the parent spine's AD-6 ("no domain logic" / "no concurrency"). The parent spine (`architecture-paper-mate-2026-06-28`) and the whole-project spec (`spec-paper-mate`) need a companion amendment to stay consistent, now or in the next epic.

<!-- Resolved (now in the spine, AD-L2): PDF parse = PyMuPDF this sprint (repo relicenses MIT→AGPL) + GROBID reserved for Phase 2; enrich = DOI-first then title/authors fallback via Crossref. -->

