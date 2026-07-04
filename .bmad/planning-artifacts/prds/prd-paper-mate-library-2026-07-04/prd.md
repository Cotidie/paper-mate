---
title: Paper Mate Library PRD
status: final
created: 2026-07-04
updated: 2026-07-04
---

# Paper Mate Library PRD

## Overview

Today Paper Mate opens one PDF from disk with no memory of it. The Library gives papers a home: a persistent, organized collection that becomes the app's front door. On boot the user lands in the Library, not an empty reader. Upload a PDF and Paper Mate reads its metadata and files it into a sortable table; group papers into nested custom folders; double-click a row to drop straight into the annotator. It turns Paper Mate from a single-file viewer into a reading workspace.

Local-first, single-user, same `~/.paper-mate` store. The collection is files on disk the app indexes; no accounts, no cloud.

## Goals & Success Metrics

**Goals**

- **G1** Turn Paper Mate from a single-file viewer into a persistent multi-paper workspace: a collection that survives restarts and is the app's front door.
- **G2** Make adding a paper a single action, with metadata filled automatically well enough that the table is useful without manual data entry.
- **G3** Let the user find and open any paper in the collection in seconds via folders, sort, and filter.

**Success signals** (single-user local tool, qualitative, not analytics):

- Adding a paper is not more friction than the old open-from-disk flow it replaces (counter-metric: if upload + extract feels slower than just opening a file, the feature failed).
- The auto-extracted Title/Authors are correct often enough that inline editing is the exception, not the rule.
- A returning user lands in their collection and reaches the right paper without hunting.

## Features & Functional Requirements

### F1: Collection & table view

- **FR-1** The Library is the app's default landing view on boot, listing all papers in the collection as a table.
- **FR-2** The table shows columns Title, Authors, Added, and File type, and displays the total count ("N files in library").
- **FR-3** Rows are multi-selectable via checkboxes for batch actions (move to folder, delete).
- **FR-4** A Display control toggles column visibility.
- **FR-5** A Sort control orders rows by any column, ascending or descending.
- **FR-6** A Filter control narrows visible rows by column value.

### F2: Add papers (upload + metadata extraction)

- **FR-7** The user adds papers by uploading one or more PDF files at once (bulk).
- **FR-8** On upload, Paper Mate extracts **Title and Authors only** from the PDF locally (embedded PDF metadata + text); Added timestamp and File type are set automatically. Other bibliographic fields (year, journal, abstract) are not columns this sprint.
- **FR-9** An optional external lookup (e.g. Crossref / Semantic Scholar) enriches or corrects metadata. When offline or on failure it never blocks the upload: the paper keeps its locally-parsed fields and the app surfaces a non-error notice that enrichment was skipped.
- **FR-10** If extraction yields nothing, the paper still enters the collection with best-effort or empty fields (e.g. filename as title). A paper is never lost to a failed parse.
- **FR-11** Title and Authors are editable inline to correct extraction.

### F3: Folders

- **FR-12** The user creates, renames, and deletes custom folders in the left panel; folders nest.
- **FR-13** Each paper belongs to at most one folder. Papers with no folder appear in an All / Uncategorized view.
- **FR-14** Selecting a folder filters the table to that folder's papers.
- **FR-15** The user assigns or moves a paper (or a multi-selection) to a folder.
- **FR-16** `[ASSUMPTION]` Deleting a folder moves its papers to Uncategorized; it never deletes the papers.

### F4: Notes

- **FR-17** The data model and table support a "Note" file-type distinct from PDF documents, reserved and displayed. In-app note authoring is out of scope this sprint (see Out of Scope).

### F5: Open in annotator

- **FR-18** Double-clicking a paper row opens it in the annotator; the reader is entered from the Library, not from an ad-hoc disk picker.
- **FR-19** `[ASSUMPTION]` Each paper has a stable identity; opening it restores its existing annotations through the doc-scoped annotation store. Annotations made in the reader belong to that Library paper.
- **FR-20** `[ASSUMPTION]` From the reader, the user returns to the Library.

### F6: Persistence

- **FR-21** The collection, folder structure, per-paper metadata, and folder assignments persist under `~/.paper-mate` and survive restart.

### F7: Delete / Trash

- **FR-22** Deleting a paper (or a multi-selection) moves it to a Trash view (soft delete); its annotations are retained.
- **FR-23** A Trash item is restorable to the collection.
- **FR-24** Purging a Trash item removes the paper and its annotations permanently.

### F8: Remote sync (deferred to a later epic; captured here, NOT built in the Library sprint)

Sync is an exploratory, mostly-orthogonal capability. It is written down now because the Library is the thing that gets synced, but it is a **separate follow-on epic** built after the Library ships. Requirements below are directional; the open questions must be resolved in that epic's own discovery.

- **FR-25** Settings exposes a Sync configuration: the user picks a backend and enters its connection details. WebDAV ships first; Google Drive is a later adapter behind the same interface.
- **FR-26** When sync is configured, the app pulls the remote library, merges it with the local collection, and pushes the result, so the collection converges across devices.
- **FR-27** Sync mirrors the whole `~/.paper-mate` data directory (PDFs + metadata + folders + annotations) as one unit.
- **FR-28** Conflicts resolve last-write-wins by timestamp (adequate for a single user on one device at a time).
- **FR-29** Sync backends sit behind one switchable interface (WebDAV first, Google Drive a later adapter), mirroring the existing agent-abstraction seam.

## Non-Functional Requirements

- **NFR-1 Local-first.** Every Library feature works fully offline. The optional external metadata lookup is the only network call; it is opt-in and degrades gracefully when offline or failing.
- **NFR-2 No auth.** Consistent with the existing app: localhost, single user, no accounts.
- **NFR-3 Non-blocking add.** Uploading a batch of PDFs never freezes the table: extraction runs off the interaction path, rows appear as they resolve, and the user can keep browsing the collection while extraction continues.
- **NFR-4 Collection scale.** For a realistic personal collection of hundreds of papers, sort, filter, and scroll act without a visible stall (no multi-second freeze on the interaction).
- **NFR-5 Durable, forward-compatible store.** Library metadata + folder structure persist under `~/.paper-mate` in a format that tolerates additive change. A breaking schema change is an AD-8-class persisted-format break and takes a MAJOR version bump.
- **NFR-6 Safe copy-in.** Copying an uploaded PDF into the collection never corrupts or loses the original; a failure mid-copy leaves the collection in a consistent state.

## Out of Scope

- Global Search nav
- Chats tab
- Full-text indexing ("Full text: Available")
- Viewed / last-opened tracking

## Assumptions

Inferred, not explicitly ratified by the user. Confirm during architecture / story creation:

- **A1 (FR-16)** Deleting a folder re-homes its papers to Uncategorized rather than deleting them.
- **A2 (FR-19)** Each Library paper carries a stable docId that keys its annotation store (reuses the Story 5.8 doc-scoped store + 3.5 restore-on-reopen seam).
- **A3 (FR-20)** The reader offers a way back to the Library.

## Open Questions

**Library (resolve during architecture / epics):**

- Which external metadata service (Crossref vs Semantic Scholar vs both) and by what key (DOI extracted from the PDF vs title search)?
- Bulk-upload UX on partial failure: if 3 of 10 PDFs fail to parse, what does the user see?

**Sync (F8, resolve in the sync epic's own discovery, NOT this sprint):**

- **Trigger cadence:** manual "Sync now", on-launch, periodic, on-change, or a combination?
- **Google Drive OAuth on a localhost/Docker app:** redirect URI, client-secret handling, token refresh, storage.
- **Deletion / Trash propagation:** does a local purge delete on the remote? How does Trash reconcile across devices?
- **Merge granularity:** whole-file mtime last-write-wins vs record-level; behavior on an interrupted push.
- **Credential storage:** how are WebDAV credentials / OAuth tokens stored under `~/.paper-mate` (plaintext vs encrypted)?
