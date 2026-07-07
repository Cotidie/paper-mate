---
baseline_commit: b240ed4857dcaec632f60e866740f4dc31e5899b
---

# Story 7.9: Venue, Year & DOI columns (Crossref-sourced, new imports only)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want Venue, published Year, and DOI columns in the library table,
so that I can scan and sort my papers by where and when they were published and jump straight to a paper's DOI.

## Context

Three new bibliographic columns on the collection table (Story 6.3 / 7.4): **Venue** (journal / conference / container title), **Year** (published year), **DOI**. This is a **full-stack additive slice** with no new endpoint, no migration, and no architectural decision. It touches no `done` story's behavior.

**Two distinct precedents apply, one per half of the change. Get them right and the story is small:**

1. **The persisted fields follow the `last_opened` / `filename` precedent (Story 7.7 / 6.3-fix), NOT the `starred` one (Story 7.8).** Venue/Year/DOI are **meta-derived display-cache fields** projected from `meta.json` → the `library.json` row, exactly like `title`/`authors`/`last_opened`/`filename`. So they live in `DocMeta` and flow through the single `_cache_from_meta` projection point (`library_index.py:90`). Because both the upsert append and the reconcile append already spread `**_cache_from_meta(meta)`, adding the three keys there **auto-seeds new imports AND backfills existing rows on the next reconcile** with no separate append-dict edit. (Contrast `starred`, which was org state authoritative in `library.json`, seeded by hand in two append dicts and deliberately kept OUT of `_cache_from_meta`. Do NOT copy that shape here.)

2. **The column plumbing follows the `location` column precedent (post-7.4).** The client column model (`tableView.ts` `ColumnKey` / `COLUMNS` / `sortKey`), the per-cell render in `PaperRow`, the CSS `col-*` width class + token, and the `useColumnWidths` `DEFAULT_WIDTHS` record are all the exact shape the `location` column added after Story 7.4 shipped. `DisplayMenu` picks up any new `hideable` column automatically (it filters `COLUMNS`), so hide/show needs no menu edit.

The **one genuinely new UI piece** is the DOI cell: a clickable `https://doi.org/{doi}` link that must NOT also arm/open the row (mirror the Title cell's Open button: `stopPropagation` on click + keydown).

**Crossref, new imports only (user decision, locked at correct-course).** Venue and Year come from the existing Crossref enrichment; DOI is the DOI the extraction pipeline already finds but currently drops. Papers imported before this story, or with no Crossref match, show blank cells. **There is NO backfill/re-enrich pass over the existing library this story** (a re-enrich pass is a possible follow-up, out of scope). Note this is subtly different from the automatic `reconcile` backfill: reconcile re-projects `meta.json` → the row cache, so a pre-existing paper's row will start carrying `doi/venue/year: null` (the new cache keys) after the next server start, but those values stay `null` until the paper is re-imported and re-enriched, because its `meta.json` was written before the extraction captured them.

**Source:** `sprint-change-proposal-2026-07-07-metadata-columns.md` (added this story), `epics.md` Story 7.9 (full ACs, lines 1778-1808), LFR-32 (line 1219).

## Acceptance Criteria

**AC-1, Model gains the three fields (additive, no schema bump).** Given the per-document model, then `DocMeta` gains `doi: str | None = None`, `venue: str | None = None`, `year: int | None = None`, and `ExtractedMeta` gains `venue: str | None = None` + `year: int | None = None` (it already carries `doi`). All additive-optional with defaults: an existing `meta.json` missing them still validates, no `schema_version` bump. (LFR-32, AL-1, AL-2)

**AC-2, Crossref captures Venue + Year; the route projects doi/venue/year onto DocMeta.** Given the Crossref enrichment of a newly imported paper, when `enrich()` resolves a Crossref `work`, then `_meta_from_work` captures `container-title[0]` as Venue and the first available `issued` / `published-print` / `published-online` / `published` `date-parts[0][0]` as Year (alongside the existing title/authors/doi), and `run_extraction` projects `doi`/`venue`/`year` from the final `ExtractedMeta` onto `DocMeta` through `apply_extraction`. **DOI is persisted from the existing extraction (`extract()`'s DOI regex), NOT newly pulled from the Crossref `work`** (see the scope boundary, capture beyond container-title/issued is out). (LFR-32, AL-2)

**AC-3, Blank cells for pre-feature / no-match papers.** Given a paper imported before this feature, or one with no Crossref match, then its Venue/Year/DOI cells render blank (no backfill/re-enrich this story: Crossref new-imports-only). (LFR-32)

**AC-4, CollectionRow exposes the three fields (additive contract), projected in `_cache_from_meta`.** Given the collection index display cache, then `CollectionRow` exposes `doi: str | None = None`, `venue: str | None = None`, `year: int | None = None` (additive: Pydantic → OpenAPI → regenerated TS types; `docs/API.md` updated), projected in `_cache_from_meta`. Additive-optional (mirrors the `last_opened`/`filename` precedent): a pre-existing `library.json` entry cached before these fields existed still validates (defaults `None`) and backfills on the next `reconcile_library`. No `schema_version` bump. (LFR-32, AL-1, AL-6, AL-8, LNFR-5)

**AC-5, Three columns, sortable + hideable.** Given the collection table, then Venue, Year, and DOI appear as columns that are sortable and hideable via the Display menu (Title stays non-hideable). **Year sorts numerically**; Venue and DOI sort as strings; **empty values sort last** in either direction (the existing `compareForSort` contract). (LFR-32, L-UX-DR-table, L-UX-DR3)

**AC-6, DOI is a link that does not arm/open the row.** Given the DOI cell of a paper with a DOI, then it renders a link to `https://doi.org/{doi}` that opens the DOI without also triggering the row's arm/open gesture (the link `stopPropagation`s its click + keydown, mirroring the Title cell's Open button). A paper with no DOI shows a blank DOI cell. (LFR-32)

**AC-7, DOI hidden by default; Venue + Year visible by default.** Given a fresh Library load, then Venue and Year are visible and DOI is hidden (revealed via the Display menu), keeping the default table uncluttered. (Design call, per the proposal's recommendation; DOI strings are long.)

**AC-8, No em-dash.** Given any new column header, label, or empty-cell copy ("Venue", "Year", "DOI", the DOI link, aria-labels), then no string contains an em-dash. (L-UX-DR13, CLAUDE.md)

## Scope boundary (read first, prevents scope creep)

**In scope:**

- **Backend model:** `ExtractedMeta` += `venue`/`year`; `DocMeta` += `doi`/`venue`/`year`; `CollectionRow` += `doi`/`venue`/`year`, all additive-optional, no `schema_version` bump.
- **Backend extraction:** `crossref._meta_from_work` captures `container-title` → venue and `issued`/`published*` year → year; `run_extraction` threads `doi`/`venue`/`year` from the final `ExtractedMeta` into `apply_extraction`; `apply_extraction` writes them through `update_meta_and_reindex`.
- **Backend cache:** `_cache_from_meta` projects `doi`/`venue`/`year` (this alone seeds new imports via `upsert_paper_entry`'s append AND backfills existing rows via `reconcile_library`'s per-entry refresh, both already spread `**_cache_from_meta`).
- **Contract:** regenerate `openapi.json` + `schema.d.ts`; update `docs/API.md` + changelog. No new request schema, no new path.
- **Client columns:** `tableView.ts` `ColumnKey` + `COLUMNS` + `sortKey` gain `venue`/`year`/`doi`; `useColumnWidths` `DEFAULT_WIDTHS` + hook calls; `PaperRow` renders the three cells (DOI as a link); `CollectionTable.css` + `components.css` widths; `useTableView` seeds DOI into the default hidden set. `DisplayMenu` needs no edit (auto-derives from `COLUMNS`).
- **Client optimistic row:** `docToRow` maps `doc.doi`/`venue`/`year` → the optimistic `CollectionRow` (mirror the `starred` line added in 7.8).
- Unit tests (backend + client) + a live smoke (own fresh servers). Version PATCH bump `0.5.7` → `0.5.8` at story done.

**Out of scope (do NOT build):**

- **Backfilling / re-enriching the existing library.** Crossref new-imports-only (locked user decision). No re-enrich pass, no bulk Crossref call over old papers.
- **Any Crossref capture beyond `container-title` / `issued`.** In particular, do NOT start persisting `work["DOI"]`: DOI stays the extraction-sourced value (`extract()`'s regex). A title-matched paper with no PDF-embedded DOI keeps a blank DOI cell even though Crossref knew it. (A future story can source DOI from the matched `work`; flag it, don't build it.)
- **Inline-editing Venue/Year/DOI.** Display-only this story. Do NOT extend `useInlineEdit`/`DocPatch`/`EditableCell` to them (that is a follow-up).
- **A `schema_version` bump / any migration.** All three fields are additive-optional; existing files validate via defaults.
- **Column reordering to slot Venue/Year "nicely" among the existing columns.** Append them; reorder-and-persist is Story 7.11. Do not reshuffle the existing `COLUMNS` order.
- **A structural refactor of `CollectionTable`/`LibraryPage`/`library_index.py`.** That is Story 7.10. This story is additive against the current seams; reuse them, do not reshape them.

## Tasks / Subtasks

- [ ] **Task 1, Backend model fields (AC-1, AC-4)**
  - [ ] `server/app/models.py`: `ExtractedMeta` (models.py:34) += `venue: str | None = None` and `year: int | None = None`, after `doi` (models.py:46). Comment: captured from Crossref (`container-title`/`issued`); the domain's honest shape before storage projects them.
  - [ ] `server/app/models.py`: `DocMeta` (models.py:49) += `doi: str | None = None`, `venue: str | None = None`, `year: int | None = None`, after `status` (models.py:69) and before `schema_version`. Comment them additive/optional exactly like the existing `authors`/`file_type`/`status` note (models.py:55-59): an existing `meta.json` missing them validates via defaults, no `schema_version` bump.
  - [ ] `server/app/models.py`: `CollectionRow` (models.py:174) += `doi: str | None = None`, `venue: str | None = None`, `year: int | None = None`. Place them with the other meta-derived cache fields (near `filename`, models.py:200) and comment them additive/optional, mirroring the `last_opened` note (models.py:183-186): meta-derived cache, defaults `None`, `reconcile_library` backfills a pre-existing row, no `schema_version` bump. **Not** the `starred` org-state note, these are meta-derived, not authoritative in `library.json`.

- [ ] **Task 2, Crossref captures Venue + Year (AC-2)**
  - [ ] `server/app/domain/crossref.py`: add two small pure helpers next to `_authors_from_crossref` (crossref.py:53):
    - `_venue_from_work(work: dict) -> str | None`: `containers = work.get("container-title") or []; return clean(containers[0]) if containers else None` (mirror how `_meta_from_work` reads `title`, crossref.py:67-68, `container-title` is a list too).
    - `_year_from_work(work: dict) -> int | None`: try `issued`, `published-print`, `published-online`, `published` in order; each is `{"date-parts": [[year, month, day]]}` (month/day optional). Guard defensively (`date-parts` may be `[[]]` or `[[null]]`): return the first `date_parts[0][0]` that is an `int`, else `None`. Keep the key order in a module constant, e.g. `_YEAR_KEYS = ("issued", "published-print", "published-online", "published")`.
  - [ ] `server/app/domain/crossref.py`: `_meta_from_work` (crossref.py:64) returns `ExtractedMeta(title=title, authors=_authors_from_crossref(work), doi=doi, venue=_venue_from_work(work), year=_year_from_work(work))`. **`doi` stays the passed-in argument** (the extraction-sourced DOI), do NOT switch it to `work.get("DOI")` (scope: DOI is extraction-sourced). No change to `enrich()`'s two-call flow, the DOI-first/title-fallback branches, or `_titles_match`.

- [ ] **Task 3, Route projection: thread doi/venue/year through apply_extraction (AC-2)**
  - [ ] `server/app/storage/documents.py`: `apply_extraction` (documents.py:116) signature += `doi: str | None`, `venue: str | None`, `year: int | None` (keyword-only, alongside `title`/`authors`/`status`). Add them to the `update_meta_and_reindex` updates dict (documents.py:130-132): `{"title": title, "authors": authors, "status": status, "doi": doi, "venue": venue, "year": year}`. (The shared `update_meta_and_reindex` core writes them onto `meta.json` and refreshes the cache, no other storage edit needed.)
  - [ ] `server/app/routes/extraction.py`: `run_extraction` (extraction.py:12), in the success branch pass `doi=final.doi, venue=final.venue, year=final.year` (extraction.py:36); in the **exception/parse-failed fallback** (extraction.py:43) pass `doi=None, venue=None, year=None` too (a total-failure settle carries no bibliographic data). `authors = ", ".join(final.authors) or None` is unchanged.
  - [ ] **Do NOT touch `import_pdf`'s new-doc `DocMeta(...)` construction** (documents.py:102-110): a fresh import lands at `status="extracting"` with the three fields defaulting to `None`; the background `run_extraction` → `apply_extraction` fills them in on settle. That is correct.

- [ ] **Task 4, Backend cache projection (AC-4)**
  - [ ] `server/app/storage/library_index.py`: `_cache_from_meta` (library_index.py:90) += `"doi": meta.doi, "venue": meta.venue, "year": meta.year`. **This is the only storage-write edit.** It auto-seeds new imports (`upsert_paper_entry`'s append spreads `**_cache_from_meta`, library_index.py:135) and backfills existing rows (`reconcile_library`'s per-entry `entry.update(_cache_from_meta(meta))`, library_index.py:390, and its append at :406 both spread it). Do NOT hand-add the keys to either append dict, that would be the `starred` pattern, wrong for a meta-derived field, and would duplicate the projection.

- [ ] **Task 5, Regenerate the contract + API docs (AC-4, AC-8)**
  - [ ] `cd server && PYTHONPATH= uv run python -m app.export_openapi` → `server/openapi.json`; then `cd client && npm run gen:api` → `client/src/api/schema.d.ts` (committed). Never hand-author the TS type. `git diff` the generated `schema.d.ts`: the ONLY delta should be `CollectionRow`/`Doc`/`DocMeta` gaining optional `doi`/`venue`/`year` (no path churn, no `DocIdSet`/`MoveRequest` change).
  - [ ] `docs/API.md`: add `doi`/`venue`/`year` to the `CollectionRow` field list + the example `GET /api/library` row JSON (API.md:196-237); update the "own fields" projection note (API.md:222-237) to include them; add a `2026-07-08 (Story 7.9)` changelog line (three additive `CollectionRow` fields, meta-derived, Crossref-sourced venue/year + extraction-sourced doi, new-imports-only, no new path/schema). Grep the new prose for `—` (em-dash) first.

- [ ] **Task 6, Client column model + sort (AC-5)**
  - [ ] `client/src/library/tableView.ts`: `ColumnKey` (tableView.ts:9) += `| "venue" | "year" | "doi"`. `COLUMNS` (tableView.ts:20) += three entries **appended after `location`** (do not reorder existing columns, Story 7.11 owns reorder): `{ key: "venue", label: "Venue", hideable: true, sortable: true }`, `{ key: "year", label: "Year", hideable: true, sortable: true }`, `{ key: "doi", label: "DOI", hideable: true, sortable: true }`.
  - [ ] `sortKey` (tableView.ts:52) += cases: `case "venue": return row.venue ?? "";`, `case "year": return row.year ?? "";` (numeric when present → numeric compare; `""` when null → sorts last, via `compareForSort`), `case "doi": return row.doi ?? "";`. `row.year` is `number | null`, so `row.year ?? ""` is `number | ""`, `compareForSort` already handles number-vs-number numerically and empty-string-last. Do NOT add a stray `default` (the switch is exhaustive over `ColumnKey`; a `default` would defeat TS's exhaustiveness check).

- [ ] **Task 7, Client column widths (AC-5)**
  - [ ] `client/src/library/useColumnWidths.ts`: `DEFAULT_WIDTHS` (useColumnWidths.ts:7) is a **total** `Record<ColumnKey, number>`, so adding the three keys is required (it will not typecheck otherwise). Add `venue: 200, year: 80, doi: 200`. Add three `useDragResize(...)` calls (venue/year/doi), and the three entries to both `byKey` and `widths` (useColumnWidths.ts:31-45). Static hook-call count is preserved (rules of hooks, `COLUMNS` is compile-time fixed).

- [ ] **Task 8, Client cell rendering (AC-5, AC-6)**
  - [ ] `client/src/library/CollectionTable/PaperRow.tsx`: after the `location` cell (PaperRow.tsx:161-166), gate three new `<td>`s on `visibleColumns.has(...)`:
    - **Venue:** `<td className="collection-table__venue" title={row.venue ?? undefined}>{row.venue ?? ""}</td>` (truncating text cell, mirror `location`/`authors`).
    - **Year:** `<td className="collection-table__year">{row.year ?? ""}</td>` (short; no truncation needed).
    - **DOI (the one new piece):** `<td className="collection-table__doi">` containing, when `row.doi`, an `<a href={`https://doi.org/${row.doi}`} target="_blank" rel="noreferrer" className="collection-table__doi-link" title={row.doi} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{row.doi}</a>`, else nothing. The `stopPropagation` on click AND keydown is load-bearing (AC-6): mirror the Open button (PaperRow.tsx:112-122) so clicking/activating the link never arms or opens the row. `target="_blank"` + `rel="noreferrer"` open the resolver without navigating away from the Library.
  - [ ] `columnClassSuffix` (`CollectionTable.tsx:20`) needs **no** change: `venue`/`year`/`doi` are already valid class-name segments (only `file_type` needed the underscore-stripping special case).

- [ ] **Task 9, Client CSS: widths + DOI link (AC-5, AC-6, AC-8)**
  - [ ] `client/src/theme/components.css`: after `--collection-table-location-width` (components.css:222) add `--collection-table-venue-width: 200px; --collection-table-year-width: 80px; --collection-table-doi-width: 200px;`.
  - [ ] `client/src/library/CollectionTable/CollectionTable.css`: after `.collection-table__col-location` (css:32) add `.collection-table__col-venue { width: var(--collection-table-venue-width); }`, `-year`, `-doi` blocks. Add a `.collection-table__venue` truncating text cell rule (overflow hidden + ellipsis + nowrap, mirror `.collection-table__location-text`/`.collection-table__added`), and `.collection-table__doi` (truncate) + `.collection-table__doi-link` (a token-colored link, e.g. `{colors.accent}` or `{colors.ink}`, `text-decoration` per DESIGN.md; truncating with ellipsis). **Token-only**, no raw hex/px outside `src/theme/**` (`no-raw-values.test.ts` enforces it). If a new dim is needed, add a component token in `components.css`, don't inline it.

- [ ] **Task 10, Client default-hide DOI (AC-7)**
  - [ ] `client/src/library/useTableView.ts`: seed the initial hidden set with DOI (useTableView.ts:15): `useState<Set<ColumnKey>>(() => new Set<ColumnKey>(["doi"]))`. Use the lazy initializer so a fresh `Set` is not rebuilt each render. Venue/Year stay visible (not in the set). `DisplayMenu` (already `COLUMNS.filter(hideable)`) will show DOI as an unchecked, toggle-able entry with no further change. `toggleColumn` already guards Title (non-hideable), so DOI is freely toggle-able.

- [ ] **Task 11, Client optimistic row (AC-3, AC-4)**
  - [ ] `client/src/library/row.ts`: `docToRow` (row.ts:73) += `doi: doc.doi ?? null, venue: doc.venue ?? null, year: doc.year ?? null` (mirror the `starred: false` line, row.ts:84). `Doc` now carries the three fields (it extends `DocMeta`), so the freshly-imported optimistic row shows whatever the import returned (typically `null` at `status: "extracting"`, filled on the AC-7 post-batch refetch once `run_extraction` settles).

- [ ] **Task 12, Tests (all ACs)**
  - [ ] **Backend** (`PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`):
    - `server/tests/test_domain.py`: extend the enrich fixtures. Add `container-title` + `issued` to the `test_enrich_doi_first_success` `message` (e.g. `"container-title": ["Journal of Foo"], "issued": {"date-parts": [[2017, 6, 12]]}`) and assert `result.venue == "Journal of Foo"` and `result.year == 2017`. Add a title-fallback case asserting venue/year capture. Add focused `_meta_from_work` / `_year_from_work` cases: year falls back across `issued` → `published-print` → `published-online` → `published`; a malformed `date-parts` (`[[]]`, `[[None]]`, missing key) yields `year=None`; a work with no `container-title` yields `venue=None`. Assert the **DOI-from-title-fallback stays None** (Crossref `work["DOI"]` is NOT captured, the scope guard).
    - `server/tests/test_docs.py`: an end-to-end extraction settle persists venue/year/doi. Drive `run_extraction` with an injected/fake enricher (see `test_docs.py`'s existing extraction tests + `enrich`'s `enricher` injection param) returning an `ExtractedMeta` with venue/year, then `GET /api/library` (or `GET /api/docs/{id}`) reflects `venue`/`year`/`doi`; a parse-failed settle leaves all three `null`.
    - `server/tests/test_models.py`: `DocMeta` and `CollectionRow` accept and round-trip `doi`/`venue`/`year`; a dict **missing** all three still validates and defaults to `None` (the additive-optional guarantee, AC-1/AC-4). Mirror the `last_opened`-missing case.
    - `server/tests/test_storage.py`: a newly `upsert`ed / reconciled entry carries `doi`/`venue`/`year` from `_cache_from_meta` (add a `DocMeta` with the fields set, assert the projected `library.json` entry carries them).
  - [ ] **Client** (`npm test` + `npm run typecheck`):
    - `client/src/library/tableView.test.ts`: `sortRows` on `venue` (case-insensitive string, empty last both directions), `year` (numeric, NOT lexical, e.g. `[2009, 2017, 1998]` orders numerically; null years sort last), `doi` (string). Input not mutated. Mirror the existing per-column cases.
    - `client/src/library/CollectionTable/CollectionTable.test.tsx` (or a `PaperRow` case there): a row with `venue`/`year`/`doi` renders each cell; the DOI cell renders an `<a href="https://doi.org/…">` (assert the href + that a click does not fire the row's open/arm, the link `stopPropagation`s); a row with `doi: null` renders a blank DOI cell; hiding a new column omits its `<th>` + `<td>`.
    - `client/src/library/useTableView.test.ts` (create if absent, else extend): the initial `hiddenColumns` contains `"doi"` and not `"venue"`/`"year"` (AC-7); `toggleColumn("doi")` reveals it. (⚠️ blast radius flagged `useTableView` has no covering tests, this is the moment to add one.)
    - `client/src/library/LibraryPage.test.tsx`: on a fresh render the DOI column header/cells are absent while Venue/Year render; toggling DOI on via the Display menu shows it. Keep `getLibrary` mocked; touch no `render/` mock barrel (Library, not Reader).
    - `no-raw-values.test.ts` stays green (new `.collection-table__doi-link` / width tokens are token-only).
  - [ ] Grep every new UI string for `—` before committing (AC-8).

- [ ] **Task 13, Version, live smoke, review, done (all ACs)**
  - [ ] Bump `[project].version` in `server/pyproject.toml` `0.5.7` → `0.5.8` and sync `server/uv.lock`'s `paper-mate-server` version to match; `cd server && uv lock --check` clean. Single version source (→ `/api/health` → top-bar badge); do not hard-code the version elsewhere.
  - [ ] Frontend `npm run typecheck` + `npm test` green; backend `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green.
  - [ ] **Live smoke on your OWN fresh servers** (never a user-launched one, CLAUDE.md): fresh `uvicorn` + `vite dev` on alternate ports against a scratch `PAPER_MATE_DATA` dir. Import a **real paper with a resolvable DOI** from `fixtures/sample-pdfs/` (e.g. an arXiv PDF whose DOI/title Crossref knows) via `POST /api/docs`, let the background extraction settle, then verify: Venue + Year cells populate for the Crossref-matched paper and stay blank for a no-match one; Year sorts numerically (not lexically) and Venue/DOI sort as strings with blanks last; the **DOI column is hidden by default** and appears when toggled via Display; the DOI cell is a link to `https://doi.org/{doi}` and **clicking it opens the resolver without arming/opening the row** (AC-6, the one non-mechanical check); values **survive a server restart** (`GET /api/library` still shows them). Normal DPR is fine (no coordinate/anchor geometry). Tear both servers down after.
  - [ ] **Cross-model Codex `bmad-code-review` (AE-6)** on the diff. Resolve High/Med before done. Backend pytest is run-it-yourself on the host (CLAUDE.md Sandbox note).
  - [ ] Branch `story-7-9-venue-year-doi-columns` off `main` before implementing. Flip `sprint-status.yaml` `7-9-venue-year-doi-columns` → `done` at PR merge (AE3-1); fill the Dev Agent Record first (AE3-2). **Do NOT close Epic 7**, 7.10 (refactor), 7.11, 7.12 remain backlog.

## Dev Notes

### The two precedents (read this first, it is the whole story)

| Half | Precedent | What it means here |
|---|---|---|
| The persisted fields (doi/venue/year) | **`last_opened` (7.7) / `filename` (6.3-fix)**, meta-derived cache | Live in `DocMeta`; projected by `_cache_from_meta` ONLY. That single edit seeds new imports AND backfills existing rows (upsert + reconcile both spread `**_cache_from_meta`). Do NOT hand-seed append dicts. |
| The column plumbing (venue/year/doi columns) | **`location` column (post-7.4)** | `ColumnKey` + `COLUMNS` + `sortKey` + `PaperRow` cell + `col-*` CSS/token + `useColumnWidths` `DEFAULT_WIDTHS`. `DisplayMenu` auto-derives. |

**Do NOT copy the `starred` (7.8) shape.** `starred` is org state authoritative in `library.json`, seeded by hand in `upsert_paper_entry` + `reconcile_library` append dicts and kept OUT of `_cache_from_meta`. Venue/Year/DOI are the opposite: meta-derived, so they go THROUGH `_cache_from_meta` and nowhere else. Confusing the two is the single most likely wrong turn.

### Why `_cache_from_meta` is the only storage-write edit (verified against current code)

`upsert_paper_entry` (library_index.py:108) append at :128-137 spreads `**_cache_from_meta(meta)`. `reconcile_library` (library_index.py:361) refreshes every existing entry with `entry.update(_cache_from_meta(meta))` (:390) AND spreads it in its own append (:406). So adding `doi`/`venue`/`year` to `_cache_from_meta` (library_index.py:90) is picked up by all three sites automatically. `update_meta_and_reindex` (library_index.py:414), the core `apply_extraction` uses, does `meta.model_copy(update=updates)` then `upsert_paper_entry`, so once `apply_extraction` puts the keys in its `updates` dict they land on `meta.json` and re-project through the same `_cache_from_meta`. No other storage function changes.

### The DOI decision: extraction-sourced, not Crossref-sourced (scope guard)

`extract()` (extract.py:125) already finds a DOI via `_find_doi` regex over `/Info`/XMP/page-0 text and returns it on `ExtractedMeta.doi`. `enrich()`'s DOI-first path passes that same `doi` back through `_meta_from_work(work, doi)`. So:

- A paper with a PDF-embedded DOI → Crossref DOI-first match → venue/year captured AND doi persisted. Full row.
- A paper matched only by title (no embedded DOI) → venue/year captured, but `doi` stays `None` (the passed arg), so the DOI cell is blank **even though `work["DOI"]` exists**. This is intended (scope: "any Crossref capture beyond container-title/issued" is out). Do NOT reach for `work.get("DOI")`. Flag "source DOI from the matched Crossref work" as a possible follow-up in the PR description; do not build it.

### Crossref work shape (for the venue/year helpers + tests)

The Crossref `message` (or `items[0]`) dict already carries, alongside `title`/`author`:
- `container-title`: a **list** of strings (like `title`), take `[0]`, `clean()` it.
- `issued` / `published-print` / `published-online` / `published`: each `{"date-parts": [[year, month?, day?]]}`. Year = `date_parts[0][0]`. Guard: `date-parts` can be `[[]]` or `[[None]]` on incomplete records, only return an `int`. Prefer `issued` (the canonical publication date); fall back through the `published-*` keys.

The test fixtures (`test_domain.py:148-173`, `_FakeClient`/`_FakeResponse`) let you add these keys to the `message` payload with no HTTP. Assert `result.venue`/`result.year` on the returned `ExtractedMeta`.

### The DOI cell is the only non-mechanical UI piece (AC-6)

Everything else is a text cell gated on `visibleColumns.has(key)`, copy `location`/`added`. The DOI cell is a link that must not double as a row gesture. The Title cell's Open button (PaperRow.tsx:112-122) is the exact pattern to mirror: `onClick={(e) => e.stopPropagation()}` AND `onKeyDown={(e) => e.stopPropagation()}`. Without the keydown stop, Enter/Space on a focused link could still bubble to the row's arm handler. `target="_blank" rel="noreferrer"` opens the resolver in a new tab (keeps the Library open); `rel="noreferrer"` is the safe default for an external link. jsdom renders the `<a>` and its href fine, so the link + href + stopPropagation are Vitest-coverable; the "opens without arming" behavior is best confirmed live.

### `useColumnWidths` is a total Record, adding keys is compile-forced

`DEFAULT_WIDTHS: Record<ColumnKey, number>` and the `byKey`/`widths` records (useColumnWidths.ts:7-45) are total over `ColumnKey`. The moment `ColumnKey` gains `venue`/`year`/`doi`, TypeScript errors until all three appear in every record. That is the guardrail, follow the errors. Add one `useDragResize` per new key (static count, rules-of-hooks safe; the file's own comment, useColumnWidths.ts:19-23, explains why the loop is unrolled).

### No em-dash / voice (AC-8)

New strings, all plain and em-dash-free: "Venue", "Year", "DOI", the DOI link text (the DOI string itself), aria/`title` attributes. Obsidian-quiet. Grep the diff for `—` before committing.

### Files to touch

**Backend (UPDATE):**
- `server/app/models.py`, `ExtractedMeta` += venue/year; `DocMeta` += doi/venue/year; `CollectionRow` += doi/venue/year
- `server/app/domain/crossref.py`, `_venue_from_work` + `_year_from_work` helpers; `_meta_from_work` returns them
- `server/app/routes/extraction.py`, `run_extraction` threads doi/venue/year into `apply_extraction` (both branches)
- `server/app/storage/documents.py`, `apply_extraction` signature + updates dict
- `server/app/storage/library_index.py`, `_cache_from_meta` += doi/venue/year (the only storage-write edit)
- `server/openapi.json`, `client/src/api/schema.d.ts`, regenerated (do not hand-edit)
- `docs/API.md`, `CollectionRow` fields + example + projection note + changelog
- `server/pyproject.toml`, `server/uv.lock`, version `0.5.7` → `0.5.8`

**Client (UPDATE):**
- `client/src/library/tableView.ts`, `ColumnKey` + `COLUMNS` + `sortKey`
- `client/src/library/useColumnWidths.ts`, `DEFAULT_WIDTHS` + hook calls + records
- `client/src/library/useTableView.ts`, seed DOI in the default hidden set
- `client/src/library/CollectionTable/PaperRow.tsx`, venue/year/doi cells (DOI as link)
- `client/src/library/CollectionTable/CollectionTable.css`, `col-venue/year/doi` widths + `.collection-table__venue`/`__doi`/`__doi-link`
- `client/src/theme/components.css`, three width tokens
- `client/src/library/row.ts`, `docToRow` seeds doi/venue/year

**Tests (UPDATE / add cases):** `test_domain.py`, `test_docs.py`, `test_models.py`, `test_storage.py`, `tableView.test.ts`, `CollectionTable.test.tsx`, `useTableView.test.ts` (new/extend), `LibraryPage.test.tsx`

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (run-it-yourself on host; the Codex sandbox reviewer reads, per CLAUDE.md). Mirror `test_domain.py`'s enrich fixtures for venue/year, `test_models.py`'s `last_opened`-optional case for the additive fields.
- Client: `cd client && npm test` (Vitest) + `npm run typecheck`. Mirror `tableView.test.ts`'s per-column sort cases; `no-raw-values.test.ts` stays green.
- Contract: after the `.py` model change, regenerate `openapi.json` + `schema.d.ts` and update `docs/API.md` in the SAME change (CLAUDE.md). Diff `schema.d.ts` to confirm only the three additive fields moved.
- **Live smoke is mandatory** (CLAUDE.md), own fresh servers, a real DOI-bearing PDF. Normal DPR (no coordinate geometry). The DOI-link-does-not-arm check (AC-6) and blank-vs-populated cells are the live-only pieces.

### Project Structure Notes

- Aligns with the established Library module layout (`client/src/library/` leaves + colocated `CollectionTable/`; backend `domain`/`storage`/`routes` split). One backend helper pair (`_venue_from_work`/`_year_from_work` in `crossref.py`); no new module either side, all edits land in existing files. Smallest correct structure: an additive-field + column slice, not a subsystem.
- No structural refactor is bundled (that is Story 7.10). The seams (`_cache_from_meta` projection, `ColumnKey`/`COLUMNS`/`sortKey` model, `useColumnWidths` total record, the `apply_extraction`/`update_meta_and_reindex` write path, `DisplayMenu`'s `COLUMNS.filter`) are already the right shape for additive columns. Reuse them; do not reshape.
- Story file lives in `.bmad/implementation-artifacts/epic-7/` (per-epic convention).

### References

- Story ACs + LFR-32: [Source: .bmad/planning-artifacts/epics.md#Story-7.9 (lines 1778-1808)], [Source: epics.md#LFR-32 (line 1219)]
- Scope change (added this story): [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-07-metadata-columns.md] (Section 2 technical impact, Section 3 open design decisions, Section 5 success criteria + explicit not-in-scope)
- **Meta-derived cache precedent (copy this shape)**: [Source: .bmad/implementation-artifacts/epic-7/7-7-recent-view.md] (`last_opened` via `_cache_from_meta`, reconcile backfill)
- **NOT the org-state precedent**: [Source: .bmad/implementation-artifacts/epic-7/7-8-starred-papers.md] (`starred` hand-seeded, kept out of `_cache_from_meta`, the shape to avoid here)
- Column-model precedent (`location` column + `tableView`/`useColumnWidths`): [Source: .bmad/implementation-artifacts/epic-7/7-4-display-sort-filter-controls.md] + [Source: client/src/library/tableView.ts], [Source: client/src/library/useColumnWidths.ts]
- Model surface: [Source: server/app/models.py:34-46 (ExtractedMeta), :49-70 (DocMeta), :174-200 (CollectionRow)]
- Crossref capture point: [Source: server/app/domain/crossref.py:53-71 (`_authors_from_crossref`, `_meta_from_work`), :85-127 (`enrich`)]
- Route projection: [Source: server/app/routes/extraction.py:12-45 (`run_extraction`)], [Source: server/app/storage/documents.py:116-132 (`apply_extraction`)]
- Cache projection + seeding sites: [Source: server/app/storage/library_index.py:90-101 (`_cache_from_meta`), :128-137 (upsert append), :390,:406 (reconcile refresh + append), :414-453 (`update_meta_and_reindex`)]
- Client cell + column plumbing: [Source: client/src/library/CollectionTable/PaperRow.tsx:112-166 (Open button + location cell to mirror)], [Source: client/src/library/CollectionTable/CollectionTable.tsx:18-22 (`columnClassSuffix`)], [Source: client/src/library/CollectionTable/CollectionTable.css:16-33 (col-width classes), :225-238 (location cell)], [Source: client/src/theme/components.css:215-222 (width tokens)]
- View-state + optimistic row: [Source: client/src/library/useTableView.ts:14-15 (hiddenColumns init)], [Source: client/src/library/row.ts:73-88 (`docToRow`, `starred` line to mirror)], [Source: client/src/library/TableControls/DisplayMenu.tsx:7 (auto-derives from `COLUMNS`)]
- API doc surface to update: [Source: docs/API.md:186-237 (`GET /api/library` + CollectionRow + projection note), :392-395 (changelog)]
- Crossref test fixtures: [Source: server/tests/test_domain.py:148-249 (`_FakeClient`/`_FakeResponse`, doi-first + title-fallback success cases to extend)]
- Architecture: AL-1 (meta + display cache), AL-2 (extract/enrich domain, Crossref behind a port), AL-6 (additive set-based contract), AL-8 (regenerated types), [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md]
- [Source: CLAUDE.md], full-stack contract-regen discipline; no em-dash in UI strings; adopt stable solutions / reuse the projection + column seams; smallest correct structure; launch your OWN dev servers for smoke; versioning (PATCH +1 → 0.5.8); branch-per-story; update `sprint-status.yaml` at merge; fill the Dev Agent Record before done.
- Memory: [[no-emdash-user-facing]], [[prefer-stable-solutions]], [[use-codegraph-navigation]], [[verify-on-hidpi-and-real-host]] (normal DPR fine here, no coordinate geometry; the live checks are DOI-link-does-not-arm + populated-vs-blank cells + numeric year sort).

## Dev Agent Record

### Agent Model Used

<!-- Sonnet 5 xHigh for dev-story per CLAUDE.md model-per-job -->

### Debug Log References

### Completion Notes List

### File List

## Change Log

- **2026-07-08:** Story 7.9 created (ready-for-dev). Full-stack additive Venue/Year/DOI columns: `DocMeta`/`ExtractedMeta`/`CollectionRow` fields + Crossref `container-title`/`issued` capture + `_cache_from_meta` projection (auto-seeds + backfills) + three client columns (DOI as a stopPropagation link, hidden by default). Crossref new-imports-only; DOI extraction-sourced. Version bump planned `0.5.7` → `0.5.8`.
