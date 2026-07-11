---
baseline_commit: 37bd1efaa0d8fbb431cfabe8ae4670cc34f2d7e8
---

# Story 8.5: Venue (Short) and Venue (Full) columns

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the library table to show a compact **Venue (Short)** column (for example `CHI`) alongside a **Venue (Full)** column with the exact publication name,
so that I can scan my papers by venue at a glance without losing the full venue when I need it.

## Acceptance Criteria

1. **Given** the per-document model, **Then** `ExtractedMeta` and `DocMeta` gain a `venue_short: str | None = None` field, additive with no `schema_version` bump (an existing `meta.json` missing the key still validates via the default), sitting beside the existing `venue` (LFR-32, AL-1, AL-2).

2. **Given** the Crossref enrichment path (`_meta_from_work` in `domain/crossref.py`), **When** a work resolves, **Then** `venue_short` is captured from Crossref's `short-container-title[0]` when present, else from `event.acronym` with a trailing year token stripped (`"CHI '25"` becomes `"CHI"`; the Year column already carries the year), else `None`. The existing `venue` capture from `container-title[0]` is unchanged (LFR-32, AL-2).

3. **Given** the collection index display cache, **Then** `CollectionRow` gains `venue_short: str | None = None` (additive, optional so a pre-existing `library.json` row still validates; `reconcile_library` backfills it), projected in `_cache_from_meta`, and the extraction route projects `final.venue_short` onto `DocMeta` through `apply_extraction` (LFR-32, AL-1, AL-6, AL-8).

4. **Given** the contract, **Then** the additive `venue_short` on `Doc`/`CollectionRow` flows Pydantic to OpenAPI to the regenerated `client/src/api/schema.d.ts`, and `docs/API.md` is updated (the `CollectionRow`/`DocMeta` resource entries and the changelog). `venue_short` is **not** patchable: `DocPatch` is unchanged (LFR-32, AL-1).

5. **Given** the collection table, **Then** there are two venue columns: an existing column relabeled **Venue (Full)** (key `venue`, still inline-editable, sorting on the full value as today) and a new **Venue (Short)** column (key `venue_short`, read-only), positioned so Short precedes Full. Both are hideable via the Display menu and sortable; Title stays non-hideable (LFR-32, L-UX-DR-table).

6. **[SUPERSEDED 2026-07-12, see below]** ~~**Given** the Venue (Short) cell renders, **Then** it shows `venue_short` when present, otherwise it falls back to the full `venue` (never blank when a full venue exists), and it exposes the full venue name on hover/focus via `title` (LFR-32).~~ **Given** the Venue (Short) cell renders, **Then** it shows `venue_short` when present, otherwise it renders **blank** (no full-venue fallback), and when it has a full venue to show, it exposes that full venue name on hover/focus via `title` (the cell is keyboard-focusable, `tabIndex=0`, exactly when a `title` is set) (LFR-32).

7. **[SUPERSEDED 2026-07-12, see below]** ~~**Given** sorting on Venue (Short), **Then** the sort key equals the displayed value (`venue_short` when present, else `venue`, else empty), so sort order matches what the cell shows; empty values sort last in either direction, consistent with the other string columns (LFR-32).~~ **Given** sorting on Venue (Short), **Then** the sort key equals the displayed value (`venue_short` when present, else empty — no fallback to `venue`), so sort order matches what the cell shows; empty values sort last in either direction, consistent with the other string columns (LFR-32).

8. **Given** any new column header, label, cell, or empty-cell copy, **Then** no string contains an em-dash (L-UX-DR13). The two labels are exactly `Venue (Short)` and `Venue (Full)`.

9. **[SUPERSEDED 2026-07-12, see below]** ~~**Given** a paper imported before this story, or one whose Crossref work carried no short form and no event acronym, **Then** its Venue (Short) cell falls back to the full venue (or renders blank only when the full venue is itself blank), with no backfill or re-enrichment pass over the existing library (Crossref new-imports-only, matching Story 7.9) (LFR-32).~~ **Given** a paper imported before this story, or one whose short-venue cascade (Crossref, then Semantic Scholar by DOI) resolved nothing, **Then** its Venue (Short) cell renders blank, with no backfill or re-enrichment pass over the existing library for the Crossref-sourced fields (Crossref new-imports-only, matching Story 7.9); a paper that DOES have a `doi` can still pick up a `venue_short` via the Semantic Scholar fallback on its next `apply_extraction` settle (LFR-32).

**AC 6/7/9 superseded 2026-07-12 (user fix request, during dev-story):** the Short cell's original "fall back to the full venue, never blank" behavior was replaced with "render blank when no short form exists" after live-testing surfaced that a full-venue fallback made an unresolved short form indistinguishable from a resolved one at a glance. The struck-through text is kept for audit trail; the un-struck sentence in each item is the AC actually implemented and tested. See Dev Notes / Completion Notes for the full narrative.

## Tasks / Subtasks

- [x] **Backend model + capture** (AC: 1, 2)
  - [x] `server/app/models.py`: add `venue_short: str | None = None` to `ExtractedMeta` (after `venue`) and to `DocMeta` (in the additive Story 7.9 block after `venue`), each with a short comment. Do **not** add it to `DocPatch`.
  - [x] `server/app/domain/crossref.py`: add `_short_venue_from_work(work)` with the `short-container-title[0]` then year-stripped `event.acronym` cascade (see Dev Notes for the exact function and regex); call it in `_meta_from_work` as `venue_short=_short_venue_from_work(work)`.
- [x] **Backend projection** (AC: 3)
  - [x] `server/app/storage/documents.py`: add a `venue_short: str | None` parameter to `apply_extraction` and write it into the meta update dict alongside `venue`.
  - [x] `server/app/routes/extraction.py`: pass `venue_short=final.venue_short` in the success `apply_extraction` call and `venue_short=None` in the parse-failed branch.
  - [x] `server/app/models.py` `CollectionRow`: add `venue_short: str | None = None` (additive, optional, in the Story 7.9 additive block after `venue`).
  - [x] `server/app/storage/library_index.py` `_cache_from_meta`: add `"venue_short": meta.venue_short`.
- [x] **Contract regen + docs** (AC: 4)
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi`, then `cd client && npm run gen:api`. **Correction (code-review fix, Low finding):** `server/openapi.json` is `.gitignore`d (`.gitignore:15`) — it is a regenerate-on-demand build artifact, not a committed file, despite this task's original wording. Only `client/src/api/schema.d.ts` is committed.
  - [x] `docs/API.md`: add `venue_short` to the `CollectionRow`/`DocMeta` field lists and the example JSON blocks, and add a changelog entry (see the Story 7.9 entries as the template). Note `venue_short` is read-only (not in `DocPatch`).
- [x] **Client column model** (AC: 5, 8)
  - [x] `client/src/library/tableView.ts`: add `"venue_short"` to `ColumnKey`; in `COLUMNS` insert `{ key: "venue_short", label: "Venue (Short)", hideable: true, sortable: true, cellType: "text" }` immediately before the `venue` entry, and change the `venue` entry's `label` to `"Venue (Full)"`.
  - [x] `client/src/library/CollectionTable/ColumnHeader.tsx` `columnClassSuffix`: return `"venue-short"` for `venue_short` (mirrors the `file_type` to `file-type` special-case; the raw underscore key would otherwise leak into the class name).
- [x] **Client cell render** (AC: 6, 8)
  - [x] `client/src/library/CollectionTable/cells.tsx`: add `renderVenueShortCell` (a read-only `<td className="collection-table__venue-short" title={row.venue ?? undefined}>{row.venue_short ?? row.venue ?? ""}</td>`) and register it in `CELL_RENDERERS` under `venue_short`. Leave `renderVenueCell` (the Full column) exactly as is (still `EditableCell`, `field="venue"`).
  - [x] `client/src/library/CollectionTable/PendingRow.tsx`: add a `case "venue_short":` returning an empty `<td key="venue_short" className="collection-table__venue-short" />` (a fresh upload has no enriched metadata yet).
- [x] **Client sort + widths + styling** (AC: 5, 7)
  - [x] `client/src/library/columnSort.ts` `sortKey`: add `case "venue_short": return row.venue_short || row.venue || "";` (note `||`, not `??`, so an empty string also falls through to the full venue, matching the cell's display).
  - [x] `client/src/library/useColumnWidths.ts`: add `venue_short: 120` to `DEFAULT_WIDTHS`, add the matching `useDragResize` call, and wire it into the returned handlers/widths object (mirror the existing `venue` wiring, static hook count).
  - [x] `client/src/library/row.ts` `docToRow`: add `venue_short: doc.venue_short ?? null` to the projected optimistic row.
  - [x] `client/src/theme/components.css`: add `--collection-table-venue-short-width: 120px;` next to `--collection-table-venue-width`.
  - [x] `client/src/library/CollectionTable/CollectionTable.css`: add `.collection-table__col-venue-short { width: var(--collection-table-venue-short-width); }` mirroring `.collection-table__col-venue`, and a `.collection-table__venue-short` cell rule mirroring `.collection-table__venue` (truncation/ellipsis).
- [x] **Tests** (all AC)
  - [x] `server/tests/test_domain.py`: `_short_venue_from_work` returns `short-container-title[0]` when present; returns the year-stripped `event.acronym` when `short-container-title` is empty (assert `"CHI '25"` -> `"CHI"`, `"WWW 2024"` -> `"WWW"`); returns `None` when neither exists; and an acronym with no year token is passed through unchanged (`"NeurIPS"` -> `"NeurIPS"`).
  - [x] `server/tests/test_models.py`: `DocMeta`/`CollectionRow`/`ExtractedMeta` default `venue_short` to `None`; a `DocMeta`/`CollectionRow` dict missing the key validates (back-compat).
  - [x] `server/tests/test_storage.py`: `apply_extraction` persists `venue_short`; `_cache_from_meta` projects it; `reconcile_library` backfills a `library.json` row cached before the field existed.
  - [x] `client/src/library/columnSort.test.ts` (actually `tableView.test.ts`, see File List): sorting on `venue_short` uses the short value and sorts empty last (**updated 2026-07-12**: no fallback to `venue` per the superseded-AC change above).
  - [x] `client/src/library/CollectionTable/CollectionTable.test.tsx`: the Venue (Short) column renders the short value and carries the full venue in `title`; **updated 2026-07-12**: renders blank (not the full venue) when short is absent, and is keyboard-focusable (`tabIndex=0`) exactly when it has a full venue to reveal; the Full column still renders the full venue and stays editable.
  - [x] `client/src/library/tableViewPrefs.test.ts`: a new/default state includes `venue_short`; a persisted order without `venue_short` reconciles to include it (appended per the existing reconcile rule).
- [x] **Verify** (all AC)
  - [x] `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (human runs on host per the Sandbox note); `cd client && npm test && npm run typecheck`.
  - [x] Live smoke on your **own** fresh dev servers (see Dev Notes): import `fixtures/sample-pdfs/3706598.3713941.pdf`, confirm after enrichment the Venue (Short) cell reads `CHI` and Venue (Full) reads the full proceedings title, hover shows the full name, both columns sort and hide.

## Dev Notes

### Divergence to record (read first)

The epics.md Story 8.5 acceptance criteria describe **one** Venue column that shows the short form with the full name on hover. The user's create-story instruction supersedes that: build **two** columns, `Venue (Short)` and `Venue (Full)`. This story implements the two-column design. The full name stays accessible three ways: its own Full column, the Short cell's `title` hover, and (Full column) inline edit. Record this divergence in the Completion Notes.

Concrete grounding for the short-name source (this is the crux): a live Crossref lookup of the sample DOI `10.1145/3706598.3713941` returns

- `container-title`: `["Proceedings of the 2025 CHI Conference on Human Factors in Computing Systems"]` (the Full value, already captured by Story 7.9),
- `short-container-title`: `[]` (**empty** for this ACM proceedings),
- `event.acronym`: `"CHI '25"`, `event.name`: `"CHI 2025: CHI Conference on Human Factors in Computing Systems"`.

So the epics.md primary source (`short-container-title`) yields nothing for the user's own example. The `CHI` the user expects lives in `event.acronym`, year-suffix stripped. That is why AC-2's cascade is `short-container-title[0]` then year-stripped `event.acronym`. `event.acronym` is a Crossref-provided field (not a curated abbreviation dictionary), so it stays inside the epics "Crossref short form + a simple derivation" scope guard. Do **not** build a client-side venue abbreviator from the full title: it cannot reliably produce `CHI` from that proceedings string, and the Short-cell fallback to the full venue already satisfies "never blank when a full venue exists."

### The exact backend capture function

Add to `server/app/domain/crossref.py` (it already imports `clean` from `_text`; add `import re` at the top of the module):

```python
_VENUE_YEAR_SUFFIX = re.compile(r"\s*['‘’`]?\d{2,4}\s*$")


def _short_venue_from_work(work: dict) -> str | None:
    """Short venue for the Venue (Short) column (Story 8.5). Crossref's own
    ``short-container-title`` is the first choice, but it is empty for many
    ACM/IEEE conference proceedings (verified: DOI 10.1145/3706598.3713941
    returns an empty ``short-container-title`` but ``event.acronym`` == "CHI
    '25"). Fall back to ``event.acronym`` with its trailing year token stripped
    ("CHI '25" -> "CHI"; the Year column carries the year). ``None`` when
    neither exists, and the client cell then falls back to the full venue."""
    shorts = work.get("short-container-title") or []
    short = clean(shorts[0]) if shorts else None
    if short:
        return short
    event = work.get("event")
    acronym = clean(event.get("acronym")) if isinstance(event, dict) else None
    if acronym:
        stripped = _VENUE_YEAR_SUFFIX.sub("", acronym).strip()
        return stripped or acronym
    return None
```

Then in `_meta_from_work` (crossref.py:100), add `venue_short=_short_venue_from_work(work),` to the `ExtractedMeta(...)` construction. The year-strip only removes a trailing standalone 2 to 4 digit token (optionally with a leading straight or curly apostrophe); leading or embedded digits in an acronym are safe (`"3DV '24"` -> `"3DV"`, `"I3D 2024"` -> `"I3D"`).

### Files to touch (current state and what changes)

Backend:
- `server/app/models.py` (models.py:36 `ExtractedMeta`, :61 `DocMeta`, :240 `CollectionRow`): add `venue_short` to all three; leave `DocPatch` (:135) untouched (venue_short is derived, read-only).
- `server/app/domain/crossref.py` (:70 `_venue_from_work` unchanged, :89 `_meta_from_work`): add `_short_venue_from_work` and wire it in.
- `server/app/storage/documents.py` (:123 `apply_extraction` signature, :142 the update dict): thread `venue_short` through.
- `server/app/routes/extraction.py` (:41 success call, :56 failure call): pass `venue_short`.
- `server/app/storage/library_index.py` (:95 `_cache_from_meta`): project `venue_short`.
- `server/app/domain/enrich.py`: **[SUPERSEDED 2026-07-12]** ~~no change. The arXiv fallback only fires when `venue` is `None`, and it fills `venue` with an already-short value (`"arXiv"` or a `journal_ref`); leaving `venue_short` as `None` there is correct, since the Short cell falls back to that short-enough full value.~~ Now DOES change (second fix-request round): gains a third fallback layer calling the new `app/domain/semantic_scholar.py`'s `SemanticScholarEnricher` when a resolved paper still has no `venue_short` but does have a `doi`. This landed after AC-6/7/9 changed to "blank when absent" (a paper with no derivable short form no longer silently falls back to the full venue, so a real short-form source beyond Crossref's cascade became worth adding).

Frontend:
- `client/src/library/tableView.ts` (:8 `ColumnKey`, :41 `COLUMNS`): add the key, insert the column, relabel `venue` to `Venue (Full)`.
- `client/src/library/CollectionTable/cells.tsx` (:130 `renderVenueCell` stays, :240 `CELL_RENDERERS`): add `renderVenueShortCell` + register.
- `client/src/library/CollectionTable/PendingRow.tsx` (:34 switch): add the `venue_short` case.
- `client/src/library/CollectionTable/ColumnHeader.tsx` (:11 `columnClassSuffix`): add the `venue-short` suffix case.
- `client/src/library/columnSort.ts` (:38 `sortKey`): add the `venue_short` case.
- `client/src/library/useColumnWidths.ts` (:9 `DEFAULT_WIDTHS`, :74 the `useDragResize` calls, :102/:113 the returns): add `venue_short`.
- `client/src/library/row.ts` (:83 `docToRow`): add `venue_short`.
- `client/src/theme/components.css` (:239): add the width token.
- `client/src/library/CollectionTable/CollectionTable.css` (:36 `.collection-table__col-venue`, :459 `.collection-table__venue`): add the mirrored `venue-short` rules.

The Display menu (`client/src/library/TableControls/DisplayMenu.tsx`) needs **no** change: it renders `COLUMNS.filter((c) => c.hideable)`, so the new hideable column appears automatically.

### Persisted column-order caveat (do not bump the store version)

`tableViewPrefs.ts` derives `DEFAULT_ORDER`/`KNOWN_KEYS` from `COLUMNS`, and its `reconcile` appends a known key missing from a persisted order **at the end** (its documented rule). So a brand-new user sees `Venue (Short)` immediately left of `Venue (Full)` (COLUMNS order), but a user with an existing `paper-mate:table-view` localStorage entry gets `venue_short` appended after their last column, not adjacent to Venue. This is the intended reconcile behavior. Do **not** bump the `persist` `version` to force adjacency: that would wipe every existing user's customized order and widths. Accept the append-at-end for existing local layouts and note it in Completion Notes.

### Contract regen (never hand-author client API types)

After the Pydantic edits: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. **Correction (code-review fix):** only `client/src/api/schema.d.ts` is committed — `server/openapi.json` is `.gitignore`d, a local regenerate-on-demand build input, not a tracked file. `ExtractedMeta` is internal and stays out of the schema (no route references it); only `Doc`/`CollectionRow` surface `venue_short`.

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Per the Sandbox note in CLAUDE.md, a sandboxed reviewer reads rather than runs the FastAPI `TestClient` tests; the human runs the suite on the host.
- Frontend: `cd client && npm test` (Vitest) and `npm run typecheck`.
- The `venue_short` capture is a pure function over a dict, so unit-test it directly in `test_domain.py` with hand-built `work` dicts (no HTTP), mirroring how `_venue_from_work`/`_year_from_work` are tested.
- No new raw hex/px outside `src/theme/**`: the width literal is a token in `components.css`; the CSS rule references `var(--collection-table-venue-short-width)`. `src/no-raw-values.test.ts` enforces this.

### Live smoke (launch your OWN servers)

Do not reuse a server the user already has running (it predates your edits and a prod/Docker frontend has no HMR). Start a fresh backend (`cd server && uv run uvicorn app.main:app --reload --port 8010`) and a fresh Vite dev (`cd client && npm run dev`, alternate port if 5173 is taken), then import `fixtures/sample-pdfs/3706598.3713941.pdf`. After the background enrichment settles (poll a beat), confirm: Venue (Short) reads `CHI`, Venue (Full) reads the full proceedings title, hovering the Short cell shows the full name, sorting either venue column works, and hiding/showing each via the Display menu works. Shut the servers down after.

### Project Structure Notes

- No new modules or files: every change extends an existing file. The additive-field pattern (Story 7.9's `venue`/`year`/`doi`, Story 7.11's `authors_list`) is the exact template, including the "additive, no `schema_version` bump, reconcile backfills the cache" discipline.
- Venue (Short) is read-only by design: it is a derived projection, has no `DocPatch` field, and editing an abbreviation the user cannot see the source of would be surprising. The Full column keeps the existing Story 6.6/7.9 inline edit.
- Downward-dependency rule holds: models to storage to routes on the backend, and `tableView.ts` to its `columnSort`/`columnReorder` leaves to `useTableView` on the client (Story 7.12 seam).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.5: Venue short name displayed, full name accessible (added 2026-07-11)] (lines 2023-2049) and [#Story 7.9: Venue, Year & DOI columns] (lines 1778-1808) for the venue field origin and the LFR-32 contract.
- [Source: sprint-status.yaml] `8-5-venue-short-name: backlog`; epic-8 broadened by `sprint-change-proposal-2026-07-11-epic-8-9-stories.md`.
- [Source: server/app/domain/crossref.py#_meta_from_work] (:89), [#_venue_from_work] (:70) for the capture pattern.
- [Source: server/app/models.py#ExtractedMeta] (:36), [#DocMeta] (:61), [#CollectionRow] (:240), [#DocPatch] (:135).
- [Source: server/app/storage/library_index.py#_cache_from_meta] (:95), [server/app/storage/documents.py#apply_extraction] (:123), [server/app/routes/extraction.py] (:25-64).
- [Source: client/src/library/tableView.ts#COLUMNS] (:41), [#ColumnKey] (:8); [client/src/library/CollectionTable/cells.tsx#CELL_RENDERERS] (:240); [client/src/library/columnSort.ts#sortKey] (:26); [client/src/library/tableViewPrefs.ts#reconcile]; [client/src/library/useColumnWidths.ts#DEFAULT_WIDTHS] (:9); [client/src/library/CollectionTable/PendingRow.tsx]; [client/src/library/TableControls/DisplayMenu.tsx].
- [Source: docs/API.md] `CollectionRow`/`DocMeta` entries + changelog (Story 7.9 entries at lines 423-425 are the template).
- [Source: CLAUDE.md] contract-regen flow, Sandbox backend-test note, no-em-dash rule (L-UX-DR13), no-raw-values (theme-only), versioning (PATCH +1 on story done -> `0.5.19`).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), xHigh reasoning.

### Debug Log References

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` -> 300 passed, then 302 after the fix-request cascade addition.
- Frontend: `npm test -- --run` -> 68 files / 1429 tests passed (unchanged count across the fix-request round). `npm run typecheck` clean.
- Live smoke round 1: fresh `uvicorn` on :8099 + fresh `vite` on :5199 (own servers, not the user's running instance), data root `/tmp/pm-smoke-data`. Imported `fixtures/sample-pdfs/3706598.3713941.pdf`; after enrichment settled (`status: ready`), confirmed via API and Playwright: `venue_short: "CHI"`, `venue` = full CHI 2025 proceedings title. Verified in-browser: hover title on the Short cell shows the full venue, ASC sort sets `aria-sort="ascending"` on the `venue_short` header, and the Display menu's "Venue (Short)" checkbox hides/shows the column. Also confirmed both the fresh-user default order (Venue (Short) immediately before Venue (Full)) and the append-at-end reconcile behavior for a pre-existing customized layout found in the browser profile's `localStorage`.
- Fix-request round: user asked to also test `fixtures/sample-pdfs/Multi-task self-supervised visual learning.pdf` (expected short form "ICCV"). First pass on unmodified code returned `venue_short: null`: the matched Crossref work (DOI 10.1109/iccv.2017.226, via bibliographic title query, no DOI in the PDF) has an `event` dict with no `acronym` key at all, only `name`/`location`/`start`/`end`, and an empty `short-container-title`. Its `container-title` does carry `"... Computer Vision (ICCV)"`, so added a third cascade step in `_short_venue_from_work`: a trailing `"(ACRONYM)"` parenthetical on `container-title[0]`, all-caps/letter-first/2-12 chars to reject false positives like a bare year or "(Volume 1)". Re-verified live on a fresh backend (:8098): `venue_short: "ICCV"`. Servers/scratch data torn down after both rounds.
- Second fix-request round: user asked to try Google Scholar and Semantic Scholar APIs against the same ICCV DOI. Google Scholar has no official API (a scrape got through once but is ToS-risky/unstable, no structured venue field, not usable). Semantic Scholar's Graph API (`GET /graph/v1/paper/DOI:{doi}?fields=publicationVenue`) returned `publicationVenue.alternate_names: ["ICCV", ...]` directly, no key required. User asked to wire it in as a fallback source: added `app/domain/semantic_scholar.py` (`SemanticScholarEnricher`, mirrors `CrossrefEnricher`/`ArxivEnricher`'s never-raise/never-block shape) and a third layer in `enrich.py`, firing only when Crossref/arXiv already resolved the paper (a real `ExtractedMeta`) but `venue_short` is still `None` and a `doi` is known. Verified live against the real API: `SemanticScholarEnricher().fetch("10.1109/iccv.2017.226") == "ICCV"`; `fetch("10.1145/3706598.3713941")` (the CHI paper, already resolved via `event.acronym`) correctly returns `None` from Semantic Scholar since that layer never even fires for it (guard: `venue_short is None`). `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` -> 311 passed (added `SemanticScholarEnricher` unit tests + `enrich()` composition tests). One pre-existing test (`test_enrich_falls_back_to_title_when_doi_misses`) needed a no-op `venue_short_fetcher` injected: `crossref.httpx` and `semantic_scholar.httpx` are the same shared module object, so `fake_httpx`'s monkeypatch on `crossref.httpx.Client` also covers the DEFAULT `SemanticScholarEnricher`'s client, adding an unexpected third call to that test's strict `len(_FakeClient.calls) == 2` assertion.
- Codex `bmad-code-review` round: 0 High, 3 Medium, 2 Low. Fixed all three Mediums (`semantic_scholar.py`'s `alternate_names[0]` bug, verified live against a real ACL paper: the bare acronym sat at index 2, not 0, behind `"Annu Meet Assoc Comput Linguistics"` and a full meeting name - fixed by scanning for an acronym-shaped entry via `_ACRONYM_NAME`, re-verified live post-fix; the Short cell's missing keyboard focusability, fixed with `tabIndex={0}` gated on having a `title` to reveal; the AC 6/7/9 text drift from the shipped blank-when-absent behavior, fixed by striking through the superseded wording in the story file). Addressed both Lows as documentation corrections (the `openapi.json` commit claim was wrong - it is `.gitignore`d; the version-bump-timing note now cites the Story 8.4 precedent). `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` -> 313 passed. `npm test -- --run` -> 1431 passed. `npm run typecheck` clean.
- Third fix-request round: user asked for one more exception - a paper that exists on arXiv only (no formal `journal_ref`) should show `"arXiv"` in BOTH Venue (Short) and Venue (Full), not blank in Short. Implemented in `enrich.py`'s arXiv fallback block: when the fallback's `venue` equals the literal `ARXIV_VENUE` ("arXiv"), `venue_short` is set to match directly (short-circuiting the later Semantic Scholar-by-DOI lookup, since it would only ever query arXiv's own self-assigned DOI anyway). A real `journal_ref` (formally published elsewhere) is NOT forced to "arXiv" - it still goes through the normal cascade, covered by a dedicated regression test. Live-verified against a genuinely arXiv-only fixture already in the repo (`fixtures/sample-pdfs/1907.10211v1.pdf`, no Crossref match, arXiv id `1907.10211`, no `journal_ref`): `venue: "arXiv"`, `venue_short: "arXiv"`, `doi: "10.48550/arXiv.1907.10211"` - confirmed on a fresh backend, torn down after. Also spot-checked two of the other arXiv-id-named fixtures happened to be formally published (CVPR 2019, KDD 2019) and resolved via the normal Crossref/container-title cascade, unaffected. `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` -> 315 passed (added 2 tests: the arXiv-only exception, and the journal_ref non-exception). Frontend untouched (backend-only change); `npm test -- --run` -> 1431 passed unchanged, confirming no regression.

### Completion Notes List

- **Two-column divergence (recorded per Dev Notes):** epics.md's Story 8.5 AC describes a single Venue column with hover-revealed full name; this story implements the user's superseding two-column design instead (`Venue (Short)` + `Venue (Full)`). The full name stays reachable three ways: its own Full column, the Short cell's `title` hover, and Full-column inline edit.
- **Short-venue source:** Crossref's `short-container-title` is empty for the sample DOI (`10.1145/3706598.3713941`, an ACM CHI proceedings); the short form comes from `event.acronym` ("CHI '25") with the trailing year token stripped, confirmed live (`venue_short: "CHI"`).
- **Second divergence (user fix request, 2026-07-12):** original AC-6/AC-9 specified the Short cell falls back to the full venue when `venue_short` is absent ("never blank when a full venue exists"). User feedback after live-testing a second paper (IEEE/ICCV, no `event.acronym`) asked for blank instead. Implemented: `renderVenueShortCell` and `columnSort.ts`'s `sortKey` no longer fall back to `row.venue`; a row with no derivable short form renders an empty cell and sorts last, matching every other empty-string column. `docs/API.md` updated to match. This supersedes the "never blank" AC text.
- **Third cascade step (user fix request, 2026-07-12):** added a trailing `"(ACRONYM)"` parenthetical match on `container-title[0]` as `_short_venue_from_work`'s third rung, after `short-container-title` and `event.acronym`. Needed because many IEEE proceedings Crossref records (verified: DOI 10.1109/iccv.2017.226) carry an `event` with no `acronym` key at all; their `container-title` does end in the acronym, e.g. `"... Computer Vision (ICCV)"`. The match requires an uppercase-letter-first, uppercase-alnum-only, 2-12 char parenthetical anchored at the string's end, so it degrades to `None` (not a wrong guess) on a bare year, "(Volume 1)", or an apostrophe'd year suffix like "(SAC '19)". Stays within the epics "Crossref short form + a simple derivation" scope guard: derives from a Crossref-supplied field via regex, not a curated abbreviation dictionary.
- **Persisted-order caveat:** did not bump `tableViewPrefs`'s `persist` `version`. A brand-new user sees `Venue (Short)` adjacent to `Venue (Full)` (COLUMNS order); an existing customized `paper-mate:table-view` layout gets `venue_short` appended at the end on next load (reconcile's documented rule), observed directly in the smoke run against a browser profile carrying a pre-existing layout.
- **Version bump:** `server/pyproject.toml` `0.5.18` -> `0.5.19` (PATCH +1, story done). Not bumped again for either fix-request round (same story, not yet closed). Code-review low finding flagged this as landing before status reaches `done` (CLAUDE.md's versioning section says "Bump once when the story reaches done (PR merge)"); precedent in this repo is mixed on WHERE the bump commit lands — Story 8.2's (`ccf84e8`) and 8.3's (`7046832`) flip-to-done commits bump version themselves, but Story 8.4's dev commit (`c081bd7`) bumped it directly and its flip-to-done commit (`37bd1ef`) did not re-bump. This story follows the 8.4 precedent (bump during dev-story); the PR-merge flip commit will not bump again.
- **Test-fixture note:** several existing CollectionTable/LibraryPage/useTableView tests hardcoded the old single-Venue-column order/label ("Venue") or a `CollectionRow` fixture with `venue` set but no `venue_short`. Updated those fixtures/expectations in place; no production behavior changed. (The original reason, a `getByText` collision from the full-venue fallback, no longer applies now that the Short cell renders blank instead of falling back, but the fixtures were left as realistic multi-field rows.)
- **Fourth source (user fix request, 2026-07-12): Semantic Scholar fallback.** `enrich()` gains a third network layer, `app/domain/semantic_scholar.py`'s `SemanticScholarEnricher`, behind the same `Enricher`-style port/never-raise/never-block/5s-timeout shape as `CrossrefEnricher`/`ArxivEnricher`. Fires only on top of an already-resolved paper (Crossref or arXiv succeeded) that still has no `venue_short` but does have a `doi`; scans Semantic Scholar's `publicationVenue.alternate_names` for an acronym-shaped entry (code-review fix: NOT just `[0]` - `alternate_names` isn't ordered acronym-first). Public API, no key needed at this call volume. Only upgrades `venue_short`, never touches `venue`/`year`/`doi`/`authors`. Investigated Google Scholar too: no official API, a scrape worked once but is unusable as a real integration (ToS, no structured data, bot-blocked) - not pursued.
- **arXiv-only exception (user fix request, 2026-07-12):** a paper with no formal `journal_ref` (only exists on arXiv) gets `venue_short` set to the literal `"arXiv"` directly in `enrich.py`'s arXiv fallback block, matching `venue`, rather than blank or a Semantic-Scholar-by-arXiv-DOI lookup. A real `journal_ref` is unaffected. Live-verified against `fixtures/sample-pdfs/1907.10211v1.pdf`.
- **Code-review fixes (Codex `bmad-code-review`):** `semantic_scholar.py`'s acronym-scan fix (see above); `cells.tsx`'s `renderVenueShortCell` gained `tabIndex={0}` (gated on having a `title`) so AC-6's "hover/focus" access actually reaches keyboard users, not just mouse hover; AC 6/7/9 text in this file struck through and replaced with the shipped blank-when-absent wording; the `server/openapi.json` "commit" task/file-list wording corrected (it is `.gitignore`d, not tracked); the version-bump-timing note expanded with the Story 8.4 precedent.

### File List

**Backend:**
- `server/app/models.py`
- `server/app/domain/crossref.py`
- `server/app/domain/enrich.py`
- `server/app/domain/semantic_scholar.py` (new)
- `server/app/storage/documents.py`
- `server/app/routes/extraction.py`
- `server/app/storage/library_index.py`
- `server/openapi.json` (regenerated locally each contract-affecting change; `.gitignore`d, not committed — code-review fix corrected this file's earlier wording)
- `server/pyproject.toml` (version bump)
- `server/uv.lock` (self-reference version bump, via `uv run`)
- `server/tests/test_domain.py`
- `server/tests/test_models.py`
- `server/tests/test_storage.py`

**Frontend:**
- `client/src/api/schema.d.ts` (regenerated)
- `client/src/library/tableView.ts`
- `client/src/library/CollectionTable/ColumnHeader.tsx`
- `client/src/library/CollectionTable/cells.tsx`
- `client/src/library/CollectionTable/PendingRow.tsx`
- `client/src/library/columnSort.ts`
- `client/src/library/useColumnWidths.ts`
- `client/src/library/row.ts`
- `client/src/theme/components.css`
- `client/src/library/CollectionTable/CollectionTable.css`
- `client/src/library/tableView.test.ts`
- `client/src/library/CollectionTable/CollectionTable.test.tsx`
- `client/src/library/tableViewPrefs.test.ts`
- `client/src/library/useColumnWidths.test.ts`
- `client/src/library/useTableView.test.ts`
- `client/src/library/LibraryPage.test.tsx`

**Docs:**
- `docs/API.md`

**Story/sprint tracking:**
- `.bmad/implementation-artifacts/8-5-venue-short-name.md`
- `.bmad/implementation-artifacts/sprint-status.yaml`
