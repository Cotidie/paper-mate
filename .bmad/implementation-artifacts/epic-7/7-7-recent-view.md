# Story 7.7: Recent view (recently-opened papers)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a Recent view that lists the papers I most recently opened, most-recent-first,
so that I can jump straight back to what I was reading without hunting through the collection.

## Context

This story lights up the first of the two inert placeholders Story 7.1 shipped in `FolderPanel` (`Recent`, `Starred`). It replaces the descoped Story 7.6 (Note file-type). Story 7.8 (Starred) is the sibling and comes next.

Recent is deliberately the small, low-risk half of the pair: it is **almost entirely a client view-state lens** (the same shape as the Trash lens from Story 7.5 and the folder lenses from Story 7.2), plus **one additive contract field** (`last_opened` on `CollectionRow`). There is **no new persistence, no new endpoint, and no new org state** — `last_opened` already exists in `DocMeta` and is already advanced on open by `POST /api/docs/{id}/open` (Story 6.7). This story only *surfaces* that timestamp on the collection row and adds a client lens that orders and caps by it.

**Source:** `sprint-change-proposal-2026-07-07.md` (added this story), `epics.md` Story 7.7 (full ACs), LFR-30, L-UX-DR14.

## Acceptance Criteria

**AC-1 — Recent becomes a real lens button.** The left-panel `Recent` entry (an inert `aria-disabled` `<li>` placeholder from Story 7.1) becomes a real selectable, keyboard-operable `<button>` with the shared active-highlight, exactly like `All` / `Uncategorized` / `Trash`. Selecting it shows the Recent view as **VIEW-STATE inside the Library route** (a new `{ kind: "recent" }` on `FolderSelection`), never a route/URL change. (LFR-30, AD-L3, L-UX-DR14)

**AC-2 — Ordering + cap.** The Recent view lists papers **ordered by last-opened descending**, capped at the **50 most-recently-opened**. Trashed papers never appear. (LFR-30, L-UX-DR14)

**AC-3 — Opening floats a paper to the top.** When a paper is opened from the Library, its `last_opened` advances (already wired via `POST /api/docs/{id}/open`, Story 6.7), so on the next `GET /api/library` reconcile it moves to the top of Recent. No new open-side wiring — this AC is satisfied by AC-4 surfacing the already-advancing timestamp. (LFR-30, AL-1)

**AC-4 — `last_opened` on the row (additive contract).** `CollectionRow` exposes `last_opened` (additive: Pydantic → OpenAPI → regenerated TS types; `docs/API.md` updated) so the client orders the Recent lens from the one `GET /api/library` read (no per-row fetch). Additive-optional (mirrors the `filename` precedent), no `schema_version` bump; a pre-existing `library.json` entry cached before this field existed still validates and is backfilled on the next reconcile. (AL-1, AL-6, AL-8)

**AC-5 — Empty copy.** When the Recent view is empty, the empty line reads exactly `No recent papers.` (L-UX-DR11, L-UX-DR14)

**AC-6 — Recent semantics (design decision, Option A).** The 50-cap and last-opened ordering are **client view-state over the returned rows** (no new persistence: `last_opened` already persists in `meta.json`, AL-1). Because import seeds `last_opened == added`, a never-opened paper *does* appear in Recent at its add-time position and falls off the 50-cap as others are opened. **Adopt Option A (Recent = recently touched):** order all non-trashed papers by `last_opened` desc, cap 50, no backend semantic change, no migration. (Option B — `last_opened` null-until-first-open + only-genuinely-opened — is explicitly **out of scope**; revisit only if never-opened-paper noise proves annoying in live use. See the sprint-change-proposal decision.)

**AC-7 — No em-dash.** No new string (label, empty copy, count label) contains an em-dash. (L-UX-DR13)

## Tasks / Subtasks

- [ ] **Task 1 — Surface `last_opened` on the collection row (backend, AC-4)**
  - [ ] `server/app/models.py`: add `last_opened: str | None = None` to `CollectionRow` (place it right after `added`; the `str | None = None` default and the "additive, no schema_version bump, reconcile backfills it" rationale mirror the existing `filename` field exactly — reuse its comment shape).
  - [ ] `server/app/storage/library_index.py`: add `"last_opened": meta.last_opened` to the dict returned by `_cache_from_meta` (library_index.py:90). This is the **single** display-cache projection point — `upsert_paper_entry`, `update_meta_and_reindex`, `touch_last_opened`, and `reconcile_library` all refresh through it, so opening a paper (which advances `meta.last_opened`, then re-projects the cache) already moves it to the top on the next read. No other backend edit is needed for AC-3.
  - [ ] Verify (read, don't guess): `touch_last_opened` / the open path refreshes the `library.json` cache through `_cache_from_meta` after advancing `meta.last_opened`, and `reconcile_library` (library_index.py:322, runs on the `GET /api/library` read path) refreshes existing entries' cache (library_index.py:351) — so legacy `library.json` rows get `last_opened` backfilled on the next library read (the same mechanism that backfills `filename`).

- [ ] **Task 2 — Regenerate the contract + docs (AC-4)**
  - [ ] `cd server && PYTHONPATH= uv run python -m app.export_openapi` → writes `server/openapi.json`; then `cd client && npm run gen:api` → regenerates `client/src/api/schema.d.ts` (committed). Never hand-author the TS type.
  - [ ] `docs/API.md`: add `last_opened` to the `CollectionRow` field list and the example `GET /api/library` row JSON (around docs/API.md:203-207); add a one-line changelog entry. Grep the new prose for `—` (em-dash) first.

- [ ] **Task 3 — Recent lens filter (client, AC-2, AC-6)**
  - [ ] `client/src/library/folderFilter.ts`: add `| { kind: "recent" }` to the `FolderSelection` union.
  - [ ] Add the Recent branch to `filterPapers`: take the untrashed papers, order by `last_opened` **descending**, slice the top **50**. Ordering fallback: when `last_opened` is null (a legacy row not yet reconciled), fall back to `added` for the sort key so it still orders sensibly. Keep the pure-function, no-React shape of the file; do NOT mutate the input array (sort a copy). `isSelected` needs no change (its kind-only match already covers `recent`).

- [ ] **Task 4 — Make the Recent panel entry real (client, AC-1)**
  - [ ] `client/src/library/FolderPanel/FolderPanel.tsx`: replace the inert `Recent` `<li className="library-folder-panel__item" aria-disabled="true">` (FolderPanel.tsx:162-165) with a real `<button className="library-folder-panel__item ...">` that mirrors the `All` entry: `onClick={() => onSelect({ kind: "recent" })}`, active-highlight via `isSelected(selection, { kind: "recent" })`, keeping the `ClockCounterClockwise` icon with `aria-hidden` (already imported — no new import). Wrap it in an `<li>` like the others.
  - [ ] `client/src/library/FolderPanel/FolderPanel.css`: update the now-stale comment at FolderPanel.css:97-99 ("Recent/Trash stay plain `<li>`") — Trash became a button in 7.5 and Recent becomes one here; only `Starred` stays an inert placeholder until Story 7.8. No new CSS rule is needed (the shared `.library-folder-panel__item` + `button.library-folder-panel__item` styles already cover it).

- [ ] **Task 5 — Wire the lens into LibraryPage copy (client, AC-5, AC-7)**
  - [ ] `client/src/library/LibraryPage.tsx` `emptySelectionMessage`: add `if (selection.kind === "recent") return "No recent papers.";`
  - [ ] `LibraryPage.tsx` `selectionLabel`: add `if (selection.kind === "recent") return "Recent";` so the toolbar count reads `N files in Recent`.
  - [ ] Confirm Recent is treated as a **normal (non-trash) lens**: the Move / Delete / Add toolbar stays as-is (Recent offers no lens-specific toolbar action beyond the normal lens — L-UX-DR14), `trashLens={selection.kind === "trash"}` is unaffected, and Open stays the primary row affordance.
  - [ ] Pending-upload gating (`visiblePending`): keep a just-uploaded (optimistic, pre-settle) paper **out** of the Recent lens, the same way `folder`/`trash` already exclude it (extend the `selection.kind === "folder" || selection.kind === "trash"` guard to include `"recent"`). A real added paper still appears in Recent once it settles into `papers` (AC-6, Option A); this only keeps the transient optimistic row from flashing in.
  - [ ] Grep the diff for `—` (em-dash) in any new string.

- [ ] **Task 6 — Tests**
  - [ ] `client/src/library/folderFilter.test.ts`: Recent branch — orders by `last_opened` desc; caps at 50 (feed >50 rows, assert length 50 and that the newest survive); excludes trashed; null-`last_opened` fallback to `added` orders sensibly.
  - [ ] `client/src/library/FolderPanel/FolderPanel.test.tsx`: `Recent` is now a real button (no longer `aria-disabled`), selecting it calls `onSelect({ kind: "recent" })`, and it carries the active-highlight class when selected. Keyboard-operable (it is a native `<button>`, so Enter/Space activation comes for free — assert the role/name).
  - [ ] `client/src/library/LibraryPage.test.tsx`: selecting Recent shows the ≤50 last-opened rows most-recent-first; empty Recent shows `No recent papers.`; the count label reads `... in Recent`.
  - [ ] Backend `server/tests/test_models.py`: `CollectionRow` accepts and round-trips `last_opened`; a dict missing `last_opened` still validates (Optional default). `server/tests/test_storage.py`: `_cache_from_meta` projects `last_opened`; opening/touch advances the cached `last_opened`.

- [ ] **Task 7 — Version, live smoke, review, done**
  - [ ] Bump `[project].version` in `server/pyproject.toml` `0.5.5` → `0.5.6` and sync `server/uv.lock` (`uv lock`; `uv lock --check` clean). This is the single version source (→ `/api/health` → top-bar badge); do not hard-code the version anywhere else.
  - [ ] Frontend `npm run typecheck` + `npm test` green; backend `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green.
  - [ ] **Live smoke on your OWN fresh servers** (never a user-launched one — see CLAUDE.md): start a fresh `uvicorn` + `vite dev` on alternate ports against a scratch data dir with a few real PDFs. Verify: Recent lists most-recently-opened first; opening a paper from another lens floats it to the top of Recent on return; the 50-cap holds if you seed >50; trashed papers never appear; empty Recent shows `No recent papers.`; Tab reaches the Recent entry with a visible focus ring and Enter activates it. Tear both servers down after.
  - [ ] **Cross-model Codex `bmad-code-review` (AE-6)** on the diff; resolve High/Med before done. Backend pytest is run-it-yourself on the host (not the sandboxed reviewer) — see the CLAUDE.md Backend-tests Sandbox note.
  - [ ] Flip `sprint-status.yaml` `7-7-recent-view` → `done` at PR merge (AE3-1); fill the Dev Agent Record first (AE3-2).

## Dev Notes

### The compose pipeline (where Recent slots in)

`LibraryPage` builds the visible rows in one line (LibraryPage.tsx:176):

```
visiblePapers = applyTableView(filterPapers(papers, selection))
```

- `filterPapers(papers, selection)` (folderFilter.ts:19) is the **lens** — your Recent branch lives here and does the untrashed-filter + last-opened-desc order + 50-slice.
- `applyTableView(rows)` = `sortRows(rows, sort)` (useTableView.ts / tableView.ts:82). Crucial: **`sortRows` returns `rows` unchanged when `sort` is null** (tableView.ts:83), and `sort` defaults to null. So in the default state the last-opened order your filter produced is exactly what the table paints. If the user clicks a column header while in Recent, the 50-membership stays fixed (already sliced) and only the *display order* of those 50 re-sorts — this is the same "sort works in any lens" behavior Trash already has, and is acceptable (L-UX-DR14 pins the lens's *ordering*, not a sort lock). Do **not** try to disable the sort headers in Recent.

### Why no backend endpoint / no new persistence

`last_opened` is already a required `str` on `DocMeta` (models.py:66), already advanced on open by `POST /api/docs/{id}/open` → `touch_last_opened` (Story 6.7). The *only* gap is that it wasn't projected into the `CollectionRow` display cache. Task 1 closes that in the one projection function (`_cache_from_meta`). Everything else about "opening floats it to the top" (AC-3) already works — you are surfacing an existing timestamp, not building new behavior.

### The `filename` precedent (follow it exactly for `last_opened`)

`CollectionRow.filename` (models.py:191) is the template for an additive display-cache field added after `library.json` already had entries: `str | None = None`, no `schema_version` bump, "reconcile backfills it." `reconcile_library` (library_index.py:344-351) re-projects every existing entry through `_cache_from_meta` on each library read, so the moment you add `last_opened` there, legacy rows get it filled in on the next `GET /api/library`. Keep `last_opened` Optional anyway (a read that projects straight from a not-yet-reconciled cache must still validate).

### Files to touch (all UPDATE except tests)

- `server/app/models.py` — `CollectionRow.last_opened` (UPDATE)
- `server/app/storage/library_index.py` — `_cache_from_meta` (UPDATE, one line)
- `server/openapi.json`, `client/src/api/schema.d.ts` — regenerated (do not hand-edit)
- `docs/API.md` — `CollectionRow` field list + example + changelog (UPDATE)
- `client/src/library/folderFilter.ts` — `FolderSelection` + `filterPapers` recent branch (UPDATE)
- `client/src/library/FolderPanel/FolderPanel.tsx` — Recent placeholder → button (UPDATE)
- `client/src/library/FolderPanel/FolderPanel.css` — stale comment fix (UPDATE)
- `client/src/library/LibraryPage.tsx` — `emptySelectionMessage`, `selectionLabel`, `visiblePending` gate (UPDATE)
- `server/pyproject.toml`, `server/uv.lock` — version bump (UPDATE)
- Tests: `folderFilter.test.ts`, `FolderPanel/FolderPanel.test.tsx`, `LibraryPage.test.tsx`, `server/tests/test_models.py`, `server/tests/test_storage.py` (UPDATE)

### Testing standards

- Frontend: Vitest + Testing Library, colocated `*.test.ts(x)` next to the unit (this repo's convention). Pure functions (`filterPapers`) get plain unit tests; components get render + interaction tests. No raw hex/px outside `src/theme/**` (`no-raw-values.test.ts` enforces it) — but this story adds no new colors/dims (it reuses `.library-folder-panel__item`).
- Backend: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`.
- **Live smoke is mandatory** (CLAUDE.md) and must run against your own fresh servers.

### Not in scope (explicitly)

- Story 7.8 (Star / unstar + Starred view) — the sibling, next story. Do NOT build the `Starred` button, the `starred` field, or `/api/library/star` here; leave the `Starred` placeholder inert.
- Option B semantics (`last_opened` null-until-first-open + migration) — AC-6 adopts Option A.
- Any Recent behavior under remote-sync (Epic 8, deferred).
- A Recent-specific toolbar action — Recent is a normal lens; Open is the row affordance.

### Project Structure Notes

- Aligns with the established Library module layout (`client/src/library/` with colocated component folders + `*.ts` leaves like `folderFilter.ts` / `tableView.ts` / `useTableView.ts`). No new files needed on the client (all edits land in existing modules); backend adds no new module either. Smallest correct structure — this is a lens addition, not a subsystem.
- No structural refactor is bundled: the seams (`FolderSelection` union, `filterPapers`, `_cache_from_meta`) are already the right shape for an additive lens/field. Reuse them; do not reshape them.

### References

- Story ACs + LFR-30 / L-UX-DR14: [Source: .bmad/planning-artifacts/epics.md#Story 7.7]
- Scope change + Recent semantics decision (Option A): [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-07.md]
- Compose pipeline: [Source: client/src/library/LibraryPage.tsx:176], [Source: client/src/library/useTableView.ts], [Source: client/src/library/tableView.ts:82]
- Lens union + filter: [Source: client/src/library/folderFilter.ts]
- Panel placeholders: [Source: client/src/library/FolderPanel/FolderPanel.tsx:162]
- Display-cache projection + reconcile backfill: [Source: server/app/storage/library_index.py:90], [Source: server/app/storage/library_index.py:322]
- `CollectionRow` / `DocMeta.last_opened` / `filename` precedent: [Source: server/app/models.py:66], [Source: server/app/models.py:174]
- Trash-lens structural analog + learnings: [Source: .bmad/implementation-artifacts/epic-7/7-5-trash-soft-delete-restore-purge.md]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
