---
baseline_commit: f327b1d9ccbf52c52345913ff7735b4d750f35ad
---

# Story 7.7: Recent view (recently-opened papers)

Status: done

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

~~**AC-2 — Ordering + cap.** The Recent view lists papers **ordered by last-opened descending**, capped at the **50 most-recently-opened**.~~ **Superseded 2026-07-07** (see Change Log, Task 8): a post-review fix request replaced the numeric cap with a rolling time window. The Recent view lists papers **ordered by last-opened descending**, grouped under **Today / Yesterday / Last week / Last month** date-bucket headers (Google-Drive-style), and drops anything older than "last month" (30 days) entirely - no numeric cap. Trashed papers never appear. (LFR-30, L-UX-DR14)

**AC-3 — Opening floats a paper to the top.** When a paper is opened from the Library, its `last_opened` advances (already wired via `POST /api/docs/{id}/open`, Story 6.7), so on the next `GET /api/library` reconcile it moves to the top of Recent. No new open-side wiring — this AC is satisfied by AC-4 surfacing the already-advancing timestamp. (LFR-30, AL-1)

**AC-4 — `last_opened` on the row (additive contract).** `CollectionRow` exposes `last_opened` (additive: Pydantic → OpenAPI → regenerated TS types; `docs/API.md` updated) so the client orders the Recent lens from the one `GET /api/library` read (no per-row fetch). Additive-optional (mirrors the `filename` precedent), no `schema_version` bump; a pre-existing `library.json` entry cached before this field existed still validates and is backfilled on the next reconcile. (AL-1, AL-6, AL-8)

**AC-5 — Empty copy.** When the Recent view is empty, the empty line reads exactly `No recent papers.` (L-UX-DR11, L-UX-DR14)

**AC-6 — Recent semantics (design decision, Option A).** The last-opened ordering is **client view-state over the returned rows** (no new persistence: `last_opened` already persists in `meta.json`, AL-1). Because import seeds `last_opened == added`, a never-opened paper *does* appear in Recent at its add-time position and falls off the rolling window as it ages past "last month". **Adopt Option A (Recent = recently touched):** order all non-trashed papers by `last_opened` desc, no backend semantic change, no migration. (Option B — `last_opened` null-until-first-open + only-genuinely-opened — is explicitly **out of scope**; revisit only if never-opened-paper noise proves annoying in live use. See the sprint-change-proposal decision.) ~~Cap: 50 most-recently-opened.~~ **Superseded 2026-07-07** (Task 8): the cap is a rolling time window (Today/Yesterday/Last week/Last month), not a fixed count - see AC-2.

**AC-8 — Location column (post-review scope, Task 9).** `All` and `Recent` show a `Location` column: the owning folder's name, or `Uncategorized` when `folder_id` is null. Hideable (Display menu) and sortable (by the displayed folder name) like every other column, following the existing `tableView.ts`/`useColumnWidths.ts`/`useTableView.ts` pattern exactly. `Starred` (Story 7.8) is unbuilt and skipped - it inherits the column for free once that lens exists on the same shared `CollectionTable`; see `deferred-work.md` for the tracked gap. No new em-dash in the column label or empty-cell copy ("Uncategorized").

**AC-7 — No em-dash.** No new string (label, empty copy, count label) contains an em-dash. (L-UX-DR13)

## Tasks / Subtasks

- [x] **Task 1 — Surface `last_opened` on the collection row (backend, AC-4)**
  - [x] `server/app/models.py`: add `last_opened: str | None = None` to `CollectionRow` (place it right after `added`; the `str | None = None` default and the "additive, no schema_version bump, reconcile backfills it" rationale mirror the existing `filename` field exactly — reuse its comment shape).
  - [x] `server/app/storage/library_index.py`: add `"last_opened": meta.last_opened` to the dict returned by `_cache_from_meta` (library_index.py:90). This is the **single** display-cache projection point — `upsert_paper_entry`, `update_meta_and_reindex`, `touch_last_opened`, and `reconcile_library` all refresh through it, so opening a paper (which advances `meta.last_opened`, then re-projects the cache) already moves it to the top on the next read. No other backend edit is needed for AC-3.
  - [x] Verify (read, don't guess): `touch_last_opened` / the open path refreshes the `library.json` cache through `_cache_from_meta` after advancing `meta.last_opened`, and `reconcile_library` (library_index.py:322, runs on the `GET /api/library` read path) refreshes existing entries' cache (library_index.py:351) — so legacy `library.json` rows get `last_opened` backfilled on the next library read (the same mechanism that backfills `filename`).

- [x] **Task 2 — Regenerate the contract + docs (AC-4)**
  - [x] `cd server && PYTHONPATH= uv run python -m app.export_openapi` → writes `server/openapi.json`; then `cd client && npm run gen:api` → regenerates `client/src/api/schema.d.ts` (committed). Never hand-author the TS type.
  - [x] `docs/API.md`: add `last_opened` to the `CollectionRow` field list and the example `GET /api/library` row JSON (around docs/API.md:203-207); add a one-line changelog entry. Grep the new prose for `—` (em-dash) first.

- [x] **Task 3 — Recent lens filter (client, AC-2, AC-6)**
  - [x] `client/src/library/folderFilter.ts`: add `| { kind: "recent" }` to the `FolderSelection` union.
  - [x] Add the Recent branch to `filterPapers`: take the untrashed papers, order by `last_opened` **descending**, slice the top **50**. Ordering fallback: when `last_opened` is null (a legacy row not yet reconciled), fall back to `added` for the sort key so it still orders sensibly. Keep the pure-function, no-React shape of the file; do NOT mutate the input array (sort a copy). `isSelected` needs no change (its kind-only match already covers `recent`).

- [x] **Task 4 — Make the Recent panel entry real (client, AC-1)**
  - [x] `client/src/library/FolderPanel/FolderPanel.tsx`: replace the inert `Recent` `<li className="library-folder-panel__item" aria-disabled="true">` (FolderPanel.tsx:162-165) with a real `<button className="library-folder-panel__item ...">` that mirrors the `All` entry: `onClick={() => onSelect({ kind: "recent" })}`, active-highlight via `isSelected(selection, { kind: "recent" })`, keeping the `ClockCounterClockwise` icon with `aria-hidden` (already imported — no new import). Wrap it in an `<li>` like the others.
  - [x] `client/src/library/FolderPanel/FolderPanel.css`: update the now-stale comment at FolderPanel.css:97-99 ("Recent/Trash stay plain `<li>`") — Trash became a button in 7.5 and Recent becomes one here; only `Starred` stays an inert placeholder until Story 7.8. No new CSS rule is needed (the shared `.library-folder-panel__item` + `button.library-folder-panel__item` styles already cover it).

- [x] **Task 5 — Wire the lens into LibraryPage copy (client, AC-5, AC-7)**
  - [x] `client/src/library/LibraryPage.tsx` `emptySelectionMessage`: add `if (selection.kind === "recent") return "No recent papers.";`
  - [x] `LibraryPage.tsx` `selectionLabel`: add `if (selection.kind === "recent") return "Recent";` so the toolbar count reads `N files in Recent`.
  - [x] Confirm Recent is treated as a **normal (non-trash) lens**: the Move / Delete / Add toolbar stays as-is (Recent offers no lens-specific toolbar action beyond the normal lens — L-UX-DR14), `trashLens={selection.kind === "trash"}` is unaffected, and Open stays the primary row affordance.
  - [x] Pending-upload gating (`visiblePending`): keep a just-uploaded (optimistic, pre-settle) paper **out** of the Recent lens, the same way `folder`/`trash` already exclude it (extend the `selection.kind === "folder" || selection.kind === "trash"` guard to include `"recent"`). A real added paper still appears in Recent once it settles into `papers` (AC-6, Option A); this only keeps the transient optimistic row from flashing in.
  - [x] Grep the diff for `—` (em-dash) in any new string.

- [x] **Task 6 — Tests**
  - [x] `client/src/library/folderFilter.test.ts`: Recent branch — orders by `last_opened` desc; caps at 50 (feed >50 rows, assert length 50 and that the newest survive); excludes trashed; null-`last_opened` fallback to `added` orders sensibly.
  - [x] `client/src/library/FolderPanel/FolderPanel.test.tsx`: `Recent` is now a real button (no longer `aria-disabled`), selecting it calls `onSelect({ kind: "recent" })`, and it carries the active-highlight class when selected. Keyboard-operable (it is a native `<button>`, so Enter/Space activation comes for free — assert the role/name).
  - [x] `client/src/library/LibraryPage.test.tsx`: selecting Recent shows the ≤50 last-opened rows most-recent-first; empty Recent shows `No recent papers.`; the count label reads `... in Recent`.
  - [x] Backend `server/tests/test_models.py`: `CollectionRow` accepts and round-trips `last_opened`; a dict missing `last_opened` still validates (Optional default). `server/tests/test_storage.py`: `_cache_from_meta` projects `last_opened`; opening/touch advances the cached `last_opened`.

- [x] **Task 7 — Version, live smoke, review, done**
  - [x] Bump `[project].version` in `server/pyproject.toml` `0.5.5` → `0.5.6` and sync `server/uv.lock` (`uv lock`; `uv lock --check` clean). This is the single version source (→ `/api/health` → top-bar badge); do not hard-code the version anywhere else.
  - [x] Frontend `npm run typecheck` + `npm test` green; backend `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green.
  - [x] **Live smoke on your OWN fresh servers** (never a user-launched one — see CLAUDE.md): start a fresh `uvicorn` + `vite dev` on alternate ports against a scratch data dir with a few real PDFs. Verify: Recent lists most-recently-opened first; opening a paper from another lens floats it to the top of Recent on return; the 50-cap holds if you seed >50; trashed papers never appear; empty Recent shows `No recent papers.`; Tab reaches the Recent entry with a visible focus ring and Enter activates it. Tear both servers down after.
  - [x] **Cross-model Codex `bmad-code-review` (AE-6)**, first pass, on the pre-Task-8/9 diff: 0 High, 1 Medium (dismissed as a false positive - `server/openapi.json` is intentionally gitignored, its own comment says the committed contract artifact is `schema.d.ts`, confirmed never committed in git history), 2 Low (both fixed: a docs/API.md changelog wording bug, and the Recent sort switched from raw ISO-string comparison to parsed epoch millis matching `tableView.ts`'s own `added`-column convention).

- [x] **Task 8 — Post-review fix request: rolling time window replaces the 50-cap (user-directed, reverses part of AC-2/AC-6)**
  - [x] `client/src/library/folderFilter.ts`: new pure `recentBucket(iso, now)` (UTC calendar-day boundaries: Today / Yesterday / Last week / Last month / `null` past 30 days) and `recentGroupLabels(rows, now)` (a `doc_id` → bucket label map, one entry per bucket transition). `filterPapers`'s recent branch drops the `RECENT_CAP` slice entirely, filters by `recentBucket(...) !== null` instead, and takes an injectable `now` (default `Date.now()`) for deterministic tests.
  - [x] `client/src/library/CollectionTable/CollectionTable.tsx`: new optional `groupLabels?: Map<string, string>` prop; a header `<tr>` (full-width `<td colSpan>`) renders immediately before any row present in the map.
  - [x] `client/src/library/LibraryPage.tsx`: computes `recentGroups` via `recentGroupLabels` only when `selection.kind === "recent"` AND `tableView.sort === null` (a manual column sort suppresses headers - same "sort still works, doesn't pretend to lock order" precedent the original 50-cap Dev Notes set).
  - [x] Tests: `folderFilter.test.ts` (`recentBucket`/`recentGroupLabels` unit tests + filterPapers no-cap/cutoff-exclusion tests, all with an injected fixed `now`), `LibraryPage.test.tsx` (no-cap, cutoff-exclusion, bucket-header ordering, headers suppressed under an active sort).

- [x] **Task 9 — Post-review fix request: Location column (user-directed, new AC-8)**
  - [x] `client/src/library/tableView.ts`: `ColumnKey` gains `"location"`; `COLUMNS` gains the `Location` entry (hideable, sortable); new `UNCATEGORIZED_LABEL` export; `sortKey`/`sortRows` take a `folderNameById: Map<string, string>` (a `CollectionRow` only carries `folder_id`, not the folder's name).
  - [x] `client/src/library/useTableView.ts`: takes `folders: Folder[]`, builds `folderNameById` via `useMemo`, threads it into `sortRows`.
  - [x] `client/src/library/useColumnWidths.ts`: `location` default width (140px) + its own `useDragResize` call, following the existing per-column pattern exactly.
  - [x] `client/src/theme/components.css` / `CollectionTable.css`: `--collection-table-location-width` token + `.collection-table__col-location`; reused `--space-*` tokens for the new group-header row style (no bespoke dimension token).
  - [x] `CollectionTable.tsx`/`PaperRow.tsx`/`PendingRow.tsx`: resolve `folder_id` → name (or `Uncategorized`) once in `CollectionTable` (the row itself has no folder-name lookup); a pending upload always renders `Uncategorized` (Dev Notes: a fresh upload lands there deterministically, no lookup needed).
  - [x] `LibraryPage.tsx`: passes `folders` to both `useTableView` and `CollectionTable`.
  - [x] `deferred-work.md`: logged that `Starred` (Story 7.8, unbuilt) doesn't get the Location column yet - it inherits it for free once that lens exists on the same shared `CollectionTable`.
  - [x] Tests: `useColumnWidths.test.ts`, `CollectionTable.test.tsx` (resize-handle count), `LibraryPage.test.tsx` (fixed 6 pre-existing tests whose `getByText("Folder A")`/`getByText("Uncategorized")` nav clicks became ambiguous once a Location cell could render that same text - switched to `getByRole("button", { name: ... })` for the sidebar entry).
  - [x] Re-ran full frontend suite (1203 passed) + typecheck (clean) after both Task 8 and Task 9. No backend change in this batch (pure client view-state + display column); no version bump (UI-only, mirrors the 7.5 Task 13 precedent).
  - [x] **Cross-model Codex `bmad-code-review` (AE-6)**, second pass, focused on the Task 8/9 diff: 0 High, 1 Medium fixed (shared `recentNow`), 1 Low fixed (docs/API.md), 3 dismissed as false positives.
  - [x] Flip `sprint-status.yaml` `7-7-recent-view` → `done` at PR merge (AE3-1); fill the Dev Agent Record first (AE3-2).

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

**Task 8/9 additions (post-review scope, no version bump - UI-only):**

- `client/src/library/tableView.ts` — `ColumnKey`/`COLUMNS` gain `location`; `UNCATEGORIZED_LABEL`; `sortKey`/`sortRows` take `folderNameById` (UPDATE)
- `client/src/library/useTableView.ts` — takes `folders`, builds `folderNameById` (UPDATE)
- `client/src/library/useColumnWidths.ts` — `location` default width + resize hook (UPDATE)
- `client/src/theme/components.css`, `client/src/library/CollectionTable/CollectionTable.css` — `location` width token/class, group-header row style (UPDATE)
- `client/src/library/CollectionTable/CollectionTable.tsx` — `folders`/`groupLabels` props, `locationLabel` resolution, grouped-row rendering (UPDATE)
- `client/src/library/CollectionTable/PaperRow.tsx`, `PendingRow.tsx` — Location cell (UPDATE)
- `.bmad/implementation-artifacts/deferred-work.md` — Starred-lens Location-column gap logged (UPDATE)
- Tests: `folderFilter.test.ts` (`recentBucket`/`recentGroupLabels`), `useColumnWidths.test.ts`, `CollectionTable.test.tsx`, `LibraryPage.test.tsx` (UPDATE)

### Testing standards

- Frontend: Vitest + Testing Library, colocated `*.test.ts(x)` next to the unit (this repo's convention). Pure functions (`filterPapers`) get plain unit tests; components get render + interaction tests. No raw hex/px outside `src/theme/**` (`no-raw-values.test.ts` enforces it) — but this story adds no new colors/dims (it reuses `.library-folder-panel__item`).
- Backend: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`.
- **Live smoke is mandatory** (CLAUDE.md) and must run against your own fresh servers.

### Not in scope (explicitly)

- Story 7.8 (Star / unstar + Starred view) — the sibling, next story. Do NOT build the `Starred` button, the `starred` field, or `/api/library/star` here; leave the `Starred` placeholder inert. The Location column (Task 9, AC-8) does NOT extend to `Starred` for the same reason - it inherits the column for free once that lens exists on the shared `CollectionTable` (see `deferred-work.md`).
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

Claude Sonnet 5

### Debug Log References

- Live smoke (Task 7, pre-Task-8/9 diff): fresh `uvicorn` on port 8234 + `vite` on port 5234 (scratch data dir), never the user's pre-existing 8000/5183 servers.
- Seeded 55 duplicate PDFs + 3 real papers (58 total) via `POST /api/docs` to verify the (then-current) 50-cap.
- Verified via real browser (Chrome automation): Recent orders by `last_opened` desc, opening a paper from `All` floats it to the top of Recent on return, cap holds at 50/58, Tab reaches Recent with a visible focus ring and Enter activates it (`50 files in Recent`).
- Trashed-exclusion and empty-copy (`No recent papers.`) verified via Vitest integration tests (`LibraryPage.test.tsx`), not re-driven live (no incremental risk beyond what jsdom already covers for those two ACs).
- Codex `bmad-code-review` first pass (pre-Task-8/9): 0 High, 1 Medium (dismissed - `server/openapi.json` intentionally gitignored, never committed, `schema.d.ts` is the actual committed contract per the `.gitignore` comment), 2 Low (both fixed: docs/API.md "next read" → "next server start" wording, Recent sort raw-ISO-string → parsed-epoch to match `tableView.ts`'s own convention).
- Live smoke again after Task 8/9 (fresh servers, port 8234/5234, same scratch data dir + 58 seeded papers, plus a new folder with a deliberately very-long name assigned to one paper): confirmed via real browser the Location column shows a folder icon + the folder's name (or `Uncategorized` with no icon), long folder names truncate with an ellipsis (no wrap, no row-height growth) - a direct user fix request on top of Task 9's own build.
- Codex `bmad-code-review` second pass (post-Task-8/9): 0 High, 1 Medium (real - `filterPapers`/`recentGroupLabels` each called `Date.now()` independently, so row membership and header labels could disagree right at a UTC-midnight boundary, AND the mounted view never re-bucketed overnight; fixed with a single shared `recentNow` React state in `LibraryPage`, rescheduled at exactly the next UTC midnight via the new `msUntilNextUtcMidnight` helper), 1 Low (docs/API.md changelog still said "capped at 50" after Task 8 removed the cap; fixed), 3 dismissed as false positives (UTC-vs-local-day semantics is intentional; sort suppressing headers is by design per Dev Notes; the `deferred-work.md` Starred entry already exists, confirmed in the worktree).

### Completion Notes List

- `CollectionRow.last_opened: str | None = None` added (mirrors the `filename` precedent exactly); projected in the single `_cache_from_meta` projection point, so `upsert_paper_entry`/`touch_last_opened`/`reconcile_library` all pick it up with no other backend change (AC-3/AC-4).
- Contract regenerated (`openapi.json` → `schema.d.ts`); `docs/API.md` updated (field list, example row, changelog entry).
- `FolderSelection` gains `{ kind: "recent" }`; `filterPapers` adds the Recent branch (untrashed, sort by `last_opened` desc with `added` fallback for a legacy null, cap 50, no input-array mutation).
- `FolderPanel`'s `Recent` entry is now a real `<button>` (was an inert `aria-disabled` `<li>`), mirroring `All`/`Trash`; stale CSS comment fixed.
- `LibraryPage` wired: empty copy, toolbar count label, and `visiblePending` gating extended to `"recent"` (keeps a pre-settle optimistic upload out of the lens).
- New/updated tests: `folderFilter.test.ts` (4 new Recent cases + 1 `isSelected` case), `FolderPanel.test.tsx` (3 new cases replacing the old "inert" case), `LibraryPage.test.tsx` (4 new cases in a `Recent (Story 7.7)` describe block), `test_models.py` (2 new cases), `test_storage.py` (2 new cases). Full suites green: 225 backend, 1192 frontend; typecheck clean.
- Version bumped `0.5.5` → `0.5.6` (`server/pyproject.toml`, `server/uv.lock`); confirmed via `/api/health` on the smoke server.
- No em-dash introduced in any new user-facing string or doc prose (grepped the diff).

**Task 8 (post-review scope, user-directed):** the 50-cap is gone. `filterPapers`'s recent branch now filters by `recentBucket(...) !== null` (UTC calendar-day boundaries: Today/Yesterday/Last week/Last month, `null` past 30 days) instead of slicing to a count, and takes an injectable `now` for deterministic tests. `recentGroupLabels` maps a `doc_id` to a bucket label only where a new bucket starts (one header per transition, in row order) - `CollectionTable` renders a full-width header `<tr>` immediately before that row via a new `groupLabels` prop. `LibraryPage` computes these only for `selection.kind === "recent"` with no active column sort (a manual sort scrambles chronological order, so headers correctly disappear then, verified by a dedicated test).

**Task 9 (post-review scope, user-directed, new AC-8):** a `Location` column (owning folder's name, or `Uncategorized`) was added to the shared `CollectionTable`, following the exact existing column pattern - `tableView.ts`'s `COLUMNS`/`ColumnKey`, `useColumnWidths.ts`'s per-column `useDragResize`, `useTableView.ts`'s hidden/sort state. Sorting by Location needed a `folderNameById` lookup threaded into `sortRows`/`useTableView` (a `CollectionRow` only carries `folder_id`, not the folder's name). Visible in `All`/`Recent`; `Starred` (Story 7.8, unbuilt) is skipped and logged in `deferred-work.md` - it inherits the column for free once that lens exists on the same `CollectionTable`. Fixing six pre-existing `LibraryPage.test.tsx` tests was required: their `getByText("Folder A")`/`getByText("Uncategorized")` sidebar-nav clicks became ambiguous once a Location cell could render that same text; switched to `getByRole("button", { name: ... })` (the sidebar entry is a real button, distinguishable from a plain-text table cell).

**Post-Task-9 user fix requests (same Location column, folded in immediately, live-smoked in a real browser):** (1) a long Location value now truncates with an ellipsis instead of wrapping the row (`.collection-table__location`/`-text` CSS, mirroring the existing `.collection-table__authors` truncation pattern - the bare `<td>` I'd shipped had no such rule, unlike Title/Authors' dedicated classes). (2) A `Folder` icon (matches `FolderRow`'s own icon exactly) renders before a real folder's name; `Uncategorized` gets no icon (derived straight from `row.folder_id`, no new prop needed - `PaperRow` already receives the full row).

**Codex review's own Medium fix (Task 9, second pass):** `visiblePapers`'s `filterPapers` call and `recentGroups`'s `recentGroupLabels` call each used their own independent `Date.now()`, so they could disagree right at a UTC-midnight boundary and the mounted view never re-bucketed overnight without a reload. Fixed with one shared `recentNow` state in `LibraryPage`, rescheduled via a new `msUntilNextUtcMidnight(now)` helper (`folderFilter.ts`) at exactly the next UTC midnight - both computations now always see the identical `now`.

### File List

- `server/app/models.py`
- `server/app/storage/library_index.py`
- `server/openapi.json`
- `client/src/api/schema.d.ts`
- `docs/API.md`
- `client/src/library/folderFilter.ts`
- `client/src/library/folderFilter.test.ts`
- `client/src/library/FolderPanel/FolderPanel.tsx`
- `client/src/library/FolderPanel/FolderPanel.css`
- `client/src/library/FolderPanel/FolderPanel.test.tsx`
- `client/src/library/LibraryPage.tsx`
- `client/src/library/LibraryPage.test.tsx`
- `server/pyproject.toml`
- `server/uv.lock`
- `server/tests/test_models.py`
- `server/tests/test_storage.py`
- `client/src/library/tableView.ts`
- `client/src/library/useTableView.ts`
- `client/src/library/useColumnWidths.ts`
- `client/src/library/useColumnWidths.test.ts`
- `client/src/theme/components.css`
- `client/src/library/CollectionTable/CollectionTable.tsx`
- `client/src/library/CollectionTable/CollectionTable.css`
- `client/src/library/CollectionTable/CollectionTable.test.tsx`
- `client/src/library/CollectionTable/PaperRow.tsx`
- `client/src/library/CollectionTable/PendingRow.tsx`
- `docs/API.md` (Task 8/9 changelog wording fixes)
- `.bmad/implementation-artifacts/deferred-work.md`

### Change Log

- 2026-07-07: Added `CollectionRow.last_opened` (additive, mirrors `filename`); projected through the single `_cache_from_meta` point (Task 1).
- 2026-07-07: Regenerated `openapi.json`/`schema.d.ts`; updated `docs/API.md` (Task 2).
- 2026-07-07: Added the `{ kind: "recent" }` `FolderSelection` variant and its `filterPapers` branch (untrashed, `last_opened` desc with `added` fallback, cap 50) (Task 3).
- 2026-07-07: Converted `FolderPanel`'s inert `Recent` `<li>` into a real selectable button; fixed the stale CSS comment (Task 4).
- 2026-07-07: Wired `LibraryPage`'s empty copy, toolbar count label, and pending-upload gating for the Recent lens (Task 5).
- 2026-07-07: Added backend (`test_models`/`test_storage`) and client (`folderFilter`/`FolderPanel`/`LibraryPage`) test coverage for every AC (Task 6).
- 2026-07-07: Bumped `server/pyproject.toml`/`server/uv.lock` version `0.5.5` → `0.5.6`; live-smoked on own fresh servers (port 8234/5234, isolated data dir, 55 duplicate + 3 real sample PDFs): ordering, float-to-top on open, 50-cap, and keyboard reachability all verified (Task 7). Codex `bmad-code-review` first pass: 0 High, 1 Medium dismissed (false positive), 2 Low fixed.
- 2026-07-07 (post-review, user-directed, Task 8): replaced the 50-cap with a rolling time window - Today/Yesterday/Last week/Last month date buckets (UTC calendar days), nothing older than 30 days shows at all. New `recentBucket`/`recentGroupLabels` in `folderFilter.ts`; `CollectionTable` renders interleaved date-bucket header rows via a new `groupLabels` prop, computed in `LibraryPage` only when no column sort is active. Supersedes AC-2/AC-6's original cap wording (updated in place, mirrors the Story 7.5 Task 13 precedent).
- 2026-07-07 (post-review, user-directed, Task 9, new AC-8): added a `Location` column (owning folder's name, or `Uncategorized`) to the shared `CollectionTable`, following the existing column pattern exactly (`tableView.ts`/`useColumnWidths.ts`/`useTableView.ts`); sorting by it needed a `folderNameById` lookup threaded into `sortRows`. Visible in `All`/`Recent`; `Starred` (unbuilt, Story 7.8) skipped and logged in `deferred-work.md`. Fixed six pre-existing `LibraryPage.test.tsx` tests whose sidebar-nav text queries became ambiguous against the new column's cell text.
- 2026-07-07 (post-Task-9 user fix requests, live-smoked): a long Location value truncates with an ellipsis instead of wrapping the row; a `Folder` icon (matches `FolderRow`'s own) renders before a real folder's name, none for `Uncategorized`.
- 2026-07-07 (Codex `bmad-code-review` second pass): 0 High, 1 Medium fixed (shared `recentNow` state in `LibraryPage`, rescheduled at the next UTC midnight via new `msUntilNextUtcMidnight` helper, so `filterPapers` and `recentGroupLabels` can never disagree at a day-boundary and the mounted view re-buckets overnight without a reload), 1 Low fixed (docs/API.md changelog still said "capped at 50" after Task 8), 3 dismissed as false positives. Full suites re-verified green: 1210 frontend tests, typecheck clean; no backend change in this batch. No version bump (UI-only).
