# Library Epic List

## Epic 6: The library becomes home
On boot the user lands in their collection, not an empty reader. Drop one or more PDFs to add them; the backend extracts Title and Authors (locally via PyMuPDF, optionally enriched via Crossref) off the interaction path while rows stream into the table; double-click any row to open it in the annotator with its existing annotations restored, and return to the Library. Stands up the client router front-door flip (`/` + `/reader/:docId`), the backend metadata-extraction domain layer, and the concurrency-safe `library.json` collection index + display cache. This is the risk gate: it proves the front-door flip and the new backend domain/extraction seam. Standalone: a persistent, add-to-able, readable library on its own.
**LFRs covered:** LFR-1, LFR-2, LFR-7, LFR-8, LFR-9, LFR-10, LFR-11, LFR-18, LFR-19, LFR-20, LFR-21
**NFRs:** LNFR-1 (local-first enrich), LNFR-3 (non-blocking add), LNFR-5 (durable additive store), LNFR-6 (safe copy-in)
**Architecture:** AL-1 (collection store/authority split), AL-2 (backend extraction domain), AL-3 (router front-door flip), AL-4 (bulk/idempotent upload), AL-6 (docs vs library API boundary), AL-7 (index write-concurrency) + inherited AL-8, AL-9
**Goals:** G1 (persistent workspace) + G2 (one-action add)

## Epic 7: Organize & curate the collection
Shape the collection into nested custom folders, multi-select and batch-move papers, sort / filter / hide columns to find any paper in seconds, jump to recently-opened papers, star the ones that matter, and delete safely through a Trash lens (restore or permanently purge). Builds on Epic 6's table + collection index; stands alone as the curation layer without Epic 6 depending on it. (The Note file-type, LFR-17, was descoped 2026-07-07; Recent + Starred, LFR-30/31, were added the same day.)
**LFRs covered:** LFR-3, LFR-4, LFR-5, LFR-6, LFR-12, LFR-13, LFR-14, LFR-15, LFR-16, LFR-22, LFR-23, LFR-24, LFR-30, LFR-31, LFR-32 (LFR-17 descoped)
**NFRs:** LNFR-2 (no auth), LNFR-4 (collection scale: sort/filter/scroll no stall)
**Architecture:** AL-5 (trash + folder lifecycle), AL-6 (folder + set-based org endpoints)
**Goals:** G3 (find and open any paper in seconds)

## Remote sync (DEFERRED, UNNUMBERED follow-on; was "Epic 8")
> Removed from the numbered epic roadmap 2026-07-11 (correct-course, user: "not important right now"). Deprioritized, NOT deleted: the capability stays captured in PRD F8 (FR-25..29) and the architecture spine's reserved switchable-backend sync seam. A switchable sync-backend interface (WebDAV first, Google Drive a later adapter behind the same seam) that mirrors the whole `~/.paper-mate` directory (PDFs + metadata + folders + annotations) and converges across devices with last-write-wins by timestamp. If picked up as a future epic it runs its own discovery: trigger cadence, Google Drive OAuth on a localhost/Docker app, deletion/Trash propagation, interrupted-push consistency, credential encryption at rest.
**LFRs covered:** LFR-25, LFR-26, LFR-27, LFR-28, LFR-29: **captured, not decomposed into stories, no epic number**
