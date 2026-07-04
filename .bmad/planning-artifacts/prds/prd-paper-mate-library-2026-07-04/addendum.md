# Addendum: Paper Mate Library

Downstream depth (architecture / UX) captured during PRD discovery. Not PRD-level.

## Routing (architecture-how)
- Library-as-home flips the SPA front door. Currently one reader frame, no meta-framework, no router. Library needs a client route split: Library page (home) + Reader page (annotator), entered by double-clicking a row. Architecture must decide the routing approach (React Router vs minimal hash/state route) without a meta-framework.

## Metadata extraction (architecture-how)
- Local parse: pdf.js text + embedded PDF metadata (title/authors). Accuracy varies by paper.
- Optional external lookup: Crossref / Semantic Scholar by DOI or title for clean metadata. Enrich fallback/toggle. Adds a network path to a localhost-only app; must degrade gracefully offline.

## Storage model (copy-in)
- Uploaded PDF bytes are copied into `~/.paper-mate` (managed collection). Collection owns its copy; original can move/delete without breaking the row. Costs duplicate disk + a copy step per upload. Each paper gets a stable docId that keys its annotation store (ties to Story 5.8 doc-scoped store + 3.5 restore-on-reopen).

## Sync (F8: later epic, architecture-how)
- Whole-dir mirror of `~/.paper-mate` (PDFs + metadata + folders + annotations).
- Switchable backend interface, same shape as the reserved agent abstraction: WebDAV adapter first (URL + user/pass), Google Drive adapter later (OAuth browser flow, the hard part on a localhost/Docker app: redirect URI, secret + token storage/refresh).
- Merge = last-write-wins by timestamp; single-user-one-device-at-a-time makes real 3-way merge unnecessary. Whole-file mtime comparison is the likely granularity.
- Config lives in the existing Settings modal (client/src/settings/SettingsModal.tsx, Story 5.1).
- Open hard problems: trigger cadence, deletion/Trash propagation, interrupted-push consistency, credential encryption at rest.
