# Sprint Change Proposal: Library UX requests (2026-07-06)

## 1. Issue Summary

During Story 7.3 (multi-select + Shift-click range) live smoke and the immediate follow-up chat, the user raised four small Library UX gaps discovered by using the app with real, nested data:

1. **Move menu is a flat folder list.** `MoveMenu.tsx` renders `folders.map(f => f.name)` with no indentation, even though folders nest (Story 7.1, LFR-12). With more than a couple of nested folders, the flat list loses the hierarchy the sidebar `FolderPanel` already shows correctly — a user can't tell which folder is which. Evidence: user screenshot of Zotero's nested folder picker as the desired shape; code inspection confirms `MoveMenu.tsx` never adopted `FolderPanel.tsx`'s existing `flattenTree` depth logic.
2. **Table columns are fixed-width.** A long title or author list truncates with no way to see more without resizing the column.
3. **Authors column shows the full comma list.** With several authors, the cell truncates mid-name; a compact "First Author et al." would be more scannable.
4. **No way to mark and find important papers.** The sidebar already has an inert "Starred" placeholder (`FolderPanel.tsx` comment: "an unimplemented mock per user request") with no way to actually star a paper or view the starred set.

All four are discovered-in-use gaps, not conflicts with the PRD or a misunderstanding of a shipped story — they are small, additive UX completions within Epic 7's existing "Organize & curate the collection" scope.

## 2. Impact Analysis

- **Epic impact:** None disruptive. Epic 7 continues as planned; these are four new small stories appended after the existing 7.1-7.6 (no renumbering).
- **Story impact:** No existing story's text, ACs, or shipped code is invalidated. Story 7.2's `MoveMenu` and Story 6.5's author-flattening are extended, not reworked.
- **Artifact conflicts:**
  - PRD: none. LFR-12 (nested folders) already covers the underlying capability; these requests raise the *display fidelity* of features already in scope, not new MVP scope.
  - Architecture: none. All four are client-only or a single additive backend field (`starred: bool`, same shape as `trashed`) + one new endpoint mirroring `move_papers` exactly (AD-L6, AD-L7 unaffected — same serialized `mutate_index` write path). No `schema_version` bump (additive fields only, precedent: `authors`/`file_type`/`status` additions, `models.py:55-59`).
  - UX spec: no existing UX doc section describes the Move-menu's own hierarchy rendering or a resize affordance — these are additions, not contradictions, to `ux-designs/ux-paper-mate-2026-06-28`.
- **Technical impact:** Minor. Three of four items (7.7, 7.8, 7.9) are entirely client-side. Item 7.10 (Starred) needs one new Pydantic model + one new route + one new storage function + a generated-contract regen (`gen:api`) + a client filter-view addition — the same shape as Story 7.2's move endpoint, so low risk.

## 3. Recommended Approach

**Option 1: Direct Adjustment.** All four items are addressed by adding four small stories within the existing Epic 7 structure (7.7-7.10) and implementing them directly — no rollback, no MVP/PRD scope change.

- Effort: Low (7.7, 7.9 trivial; 7.8 small self-contained client feature; 7.10 the largest, still a single small endpoint + client wiring mirroring an existing pattern).
- Risk: Low. No architectural pattern is bent — each reuses an existing precedent in the codebase (see Section 4).
- Rollback (Option 2) and MVP review (Option 3) were not viable/needed: nothing to roll back (net-new, additive), and MVP is unaffected (Phase 1 already shipped; this is Phase-2 Library polish within Epic 7's own charter).

## 4. Detailed Change Proposals

### Story 7.7 — Move menu shows folder hierarchy

- Extract `flattenTree` (currently private to `FolderPanel.tsx`, lines ~22-39) into a shared `client/src/library/folderTree.ts`.
- `MoveMenu.tsx` renders folders via `flattenTree(folders)` in pre-order, indenting each `<button>` by `depth` using the same `--folder-panel-indent-step` CSS var `FolderPanel` already uses.
- No backend/contract change.

### Story 7.8 — Resizable table columns

- Add a drag handle to each column boundary in `CollectionTable`'s `<colgroup>`/header; on drag, adjust the adjacent `--collection-table-*-width` CSS custom property with a minimum-width floor.
- Persist widths to `localStorage` (new small helper, no existing settings store to extend) and hydrate on mount.
- No backend/contract change — a client display preference only, not part of `library.json`.

### Story 7.9 — Author display "et al."

- New helper in `client/src/library/row.ts` (alongside `formatAdded`/`stripPdfExtension`): split `row.authors` on `", "`; if more than one name, render `` `${first} et al.` ``, else the single name unchanged.
- `PaperRow.tsx`'s Authors cell renders the formatted text; the `title=` tooltip keeps the full string. Inline-edit (Story 6.6) is unaffected — it already seeds/saves the raw full string via `seedFieldValue`/`currentFieldValue`, only the settled *read* view changes.
- No backend change (backend already flattens `authors` to one string, `extraction.py:34`).

### Story 7.10 — Starred papers

- Backend: `CollectionRow.starred: bool = False` (models.py, additive sibling to `trashed`); `library_index.py` sets `"starred": False` on new entries (mirrors `"trashed": False`); new `POST /api/library/star` route with `StarRequest{doc_ids: list[str], starred: bool}` → `storage.star_papers(doc_ids, starred)` → same validate-all-ids-then-`mutate_index` shape as `move_papers` → `read_library()`. Regenerate `client/src/api/schema.d.ts` (`gen:api`) and `docs/API.md`.
- Client: new toolbar Star button beside Move/+Add (`LibraryPage.tsx`'s `.library-toolbar__actions`), disabled with an empty selection, toggling star/unstar the current `selectedIds` (mirrors `MoveMenu`'s selection-driven pattern exactly). Minimal per-row indicator: a small filled `Star` icon (phosphor `weight="fill"`, precedent: `AnnotationLayer.tsx:357-358`'s fill/regular toggle) next to the title when starred, nothing otherwise — no reserved column.
- `folderFilter.ts`: extend `FolderSelection` with `{kind: "starred"}`; `filterPapers` branches `untrashed.filter(p => p.starred)`. `FolderPanel.tsx`'s existing inert "Starred" row becomes a real `onSelect({kind: "starred"})` button, completing its own long-standing placeholder comment.

## 5. Implementation Handoff

- **Scope classification: Minor.** All four stories are additive, low-risk, within the existing Epic 7 structure and existing architectural patterns (no new component classes, no contract-breaking changes). Routed to: **Developer agent, direct implementation** (this session), no separate PM/Architect escalation needed.
- **Sequencing:** 7.7 → 7.9 → 7.8 → 7.10 (ascending implementation complexity; each is its own branch/commit/push per CLAUDE.md's branch-per-story convention).
- **Success criteria per story:** existing test suite stays green, new unit tests cover the new behavior, `npm run typecheck` clean, a live smoke pass on own fresh servers for anything with real interaction surface (7.7 menu open, 7.8 drag-resize + reload persistence, 7.10 star toggle + filter view). 7.9 is pure formatting — unit tests suffice, no live smoke required.
