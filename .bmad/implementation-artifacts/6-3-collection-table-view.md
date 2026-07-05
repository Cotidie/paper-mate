---
baseline_commit: 0288e545b57ffa5cf02a76439d50d0a942d0b71e
---

# Story 6.3: Collection table view

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want my collection shown as a table of papers,
so that I can see everything I have at a glance.

This is the **first UI consumer** of the `GET /api/library` endpoint that Story 6.2 stood up. It turns the Library route (`/`) from a static shell into a real collection view: fetch the library on mount, render the papers as a table (columns Title / Authors / Added / File type) with a "N files in library" count line, show a loading skeleton while the fetch is in flight, and keep the existing empty-collection copy when there are no papers. It renders **read-only**: no double-click-to-open (Story 6.7), no multi-select checkbox (Story 7.3), no sort/filter/display controls (Story 7.4), no inline edit (Story 6.6), no dropzone / optimistic rows / polling (Stories 6.4/6.5). It only proves: a non-empty collection lists as a table from one read; an empty collection shows the empty state; a load shows skeleton rows without a stall.

## Acceptance Criteria

1. **Table renders the collection from `GET /api/library` (LFR-2, L-UX-DR2, AL-L1/AL-6).** When the Library route (`/`) renders with a non-empty collection, the main region shows a table with columns **Title, Authors, Added, File type**, populated from `GET /api/library` (the display cache, one read), plus a count line **"N files in library"** where N = `papers.length` (client-side; there is no count field on the response). Papers render in the response's `order` (the server's insertion order; client sort is Story 7.4, not built here).

2. **Row presentation follows the tokens (L-UX-DR2).** Title and Authors **truncate with ellipsis** (single line, no wrap). Added shows a **human-readable date** (e.g. `Jul 5, 2026`), derived from the ISO `added` string. File type renders as a **`{component.badge-pill}`** with the label `PDF` or `Note` (from `file_type`). Header/label cells use `{typography.title-sm}`; body rows use `{typography.body-sm}` `{colors.body}`; the count line uses `{typography.caption}`. No inline hex/px (tokens only; `src/no-raw-values.test.ts` governs).

3. **Row hover (L-UX-DR2).** Hovering a table row shifts its background to `{colors.surface-strong}`.

4. **Empty & loading states (L-UX-DR11, LNFR-4).** An empty collection (`papers: []`) shows the existing **"No papers yet." copy** (from Story 6.1) instead of the table. While the `GET /api/library` fetch is in flight, **skeleton rows reserve the table layout** (no layout jump, no spinner-only blank). A shimmer/pulse on the skeleton must be disabled under `prefers-reduced-motion: reduce` (L-UX-DR12).

5. **Fetch failure is surfaced, not swallowed (L-UX-DR9/DR13).** If `GET /api/library` fails, the page shows a non-crashing error notice (reuse the existing `Toast`), copy `Couldn't load your library.` (fact then nothing to recover; no em-dash), and does not render a broken table. The existing single-file Add bridge (Story 6.1) stays functional throughout.

6. **Scale: hundreds of rows scroll without a stall (LNFR-4).** A collection of hundreds of rows scrolls smoothly with no visible multi-second stall. Plain DOM rows are sufficient at this scale; do **not** add row virtualization/windowing (single user, N in the hundreds; revisit only if N reaches thousands).

7. **No em-dash in any table label or copy (L-UX-DR13, DESIGN.md).** Column headers, the count line, the badge labels, the error copy, and any other new UI string contain no `—`.

## Tasks / Subtasks

- [x] **Task 1, API: add `getLibrary()` fetch function (AC: 1, 5)** [`client/src/api/client.ts`]
  - [x] Add `export async function getLibrary(): Promise<Library>` mirroring the existing `getAnnotations`/`getDoc` idiom: `fetch("/api/library")`, `if (!res.ok) throw await envelopeError(res)`, `return (await res.json()) as Library`. The `Library`/`CollectionRow`/`Folder` type aliases already exist here (added by Story 6.2) — use them, do not re-add. This is the first consumer that Story 6.2 deferred; remove/replace the "No fetch function yet" comment on the `CollectionRow`/`Folder`/`Library` alias block so it reads as shipped.
  - [x] Do NOT hand-author any response type. `Library.papers` is `CollectionRow[]`; each row is `{ doc_id, title, authors, added, file_type, status, folder_id, trashed, order }` (generated). `title`/`authors` are nullable.

- [x] **Task 2, Component: `CollectionTable` (presentational) + skeleton + count (AC: 1, 2, 3, 6, 7)** [`client/src/library/CollectionTable.tsx` (new), `client/src/library/CollectionTable.css` (new)]
  - [x] New presentational component: takes `rows: CollectionRow[]` and renders the count line ("N files in library", `{typography.caption}`) + a `<table>` (semantic `<thead>`/`<tbody>`, `<th scope="col">` headers) with the four columns. Pure render, no data fetching (LibraryPage owns the fetch, AD-9 downward dependency: view → store/api, never the reverse). Keyed by `row.doc_id`.
  - [x] Title/Authors cells: `text-overflow: ellipsis; overflow: hidden; white-space: nowrap` with a fixed/max column width so long strings truncate on one line. A `null` title falls back to a muted placeholder (e.g. the filename is not on the row — use `Untitled` in `{colors.muted}`); a `null` authors renders empty (no placeholder needed). Add `title={row.title ?? undefined}` so the full string shows on hover (native tooltip; no em-dash risk since it is data, not our copy).
  - [x] Added cell: format the ISO `added` via a small local helper `formatAdded(iso: string): string` → `new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })`; guard an unparseable date (`Number.isNaN(d.getTime())`) by returning the raw string rather than `Invalid Date`. Colocate the helper in the component file (or `src/library/` if you prefer a testable unit) — do not add a date library (no dependency for one `toLocaleDateString` call).
  - [x] File type cell: a `{component.badge-pill}` span with label `file_type === "note" ? "Note" : "PDF"`. Badge visual = `{colors.surface-strong}` fill, `{typography.caption-uppercase}`, pill radius (see Task 4 for the token add).
  - [x] Row hover → `{colors.surface-strong}` (`tbody tr:hover`).
  - [x] Skeleton: render N placeholder rows (a fixed count, e.g. 6) that reserve the same row height/columns while loading. Give them a subtle pulse via a keyframe animation, and disable it under `@media (prefers-reduced-motion: reduce)`. Expose the skeleton either as a `loading` prop on `CollectionTable` or a tiny sibling `TableSkeleton` — dev's call; keep it minimal and in the same file/dir.
  - [x] CSS in `CollectionTable.css`, tokens only (no raw hex/px — `no-raw-values.test.ts` scans this file). If you need a new dimension (row height, column widths), add it as a `--` var in `client/src/theme/components.css` (the token layer where px is allowed) and reference it here, matching how `LibraryPage.css` references `--toc-panel-width` etc.

- [x] **Task 3, LibraryPage: wire fetch + loading/error/empty/data switch (AC: 1, 4, 5)** [`client/src/library/LibraryPage.tsx`, `client/src/library/LibraryPage.css`]
  - [x] On mount, fetch the library: `useEffect(() => { getLibrary().then(setLibrary).catch(() => setLoadError(...)).finally(() => setLoading(false)) }, [])`. Hold `library: Library | null`, `loading: boolean` (start `true`), and a `loadError: string | null`. Guard against setState-after-unmount (a `cancelled` flag in the effect) since the fetch is async.
  - [x] Render switch inside `.library-main`:
    - `loading` → `<CollectionTable loading />` (skeleton).
    - loaded + `library.papers.length > 0` → `<CollectionTable rows={library.papers} />`.
    - loaded + empty → the existing **"No papers yet."** copy (keep Story 6.1's `.library-empty-copy`).
    - `loadError` → the error `Toast` (alongside the existing upload-error toast; both can use the same `error` slot or two slots — keep it simple, one toast at a time is fine).
  - [x] **Layout fix:** `.library-main` today is `display:flex; align-items:center; justify-content:center` (centers the empty copy). A table must top-align and scroll. Make the table case a top-aligned, vertically-scrollable region (`overflow-y:auto`, column layout) while the empty/loading-empty case keeps centered copy. Simplest: keep `.library-main` as the scroll container (change to `flex-direction: column; align-items: stretch; overflow-y: auto`) and center the empty copy with its own rule, OR branch the container class on state. Do not let the page body scroll horizontally; the table scrolls within `.library-main`.
  - [x] Keep the existing top-bar + Add bridge + folder-panel placeholder untouched (Story 6.1 behaviour preserved). Do not touch the router or the reader.

- [x] **Task 4, Tokens: add `caption-uppercase` typography + `badge-pill` dims (AC: 2)** [`client/src/theme/components.css`]
  - [x] `components.css` currently has `--type-caption-*` but **not** `caption-uppercase` (11px/600, DESIGN.md typography table) — the badge needs it. Add `--type-caption-uppercase-size: 11px; --type-caption-uppercase-weight: 600; --type-caption-uppercase-leading: 1.4;` (+ letter-spacing if DESIGN.md specifies; it does not, so omit). [Source: DESIGN.md#typography `caption-uppercase`]
  - [x] Add badge-pill dims (padding, gap) as `--badge-pill-*` vars if needed, mirroring how other components carry their px here. The badge fill (`{colors.surface-strong}`) already exists as `--color-surface-strong`. [Source: DESIGN.md#components `badge-pill`]
  - [x] This is the token layer (theme/ is EXEMPT from `no-raw-values.test.ts`), so px is allowed here and ONLY here.

- [x] **Task 5, Tests (AC: 1-7)** [`client/src/library/LibraryPage.test.tsx`, `client/src/library/CollectionTable.test.tsx` (new)]
  - [x] **REGRESSION FIRST — the existing 6.1 tests will break.** `LibraryPage.test.tsx` currently mounts `LibraryPage` with **no `getLibrary` mock**; after Task 3 the component fetches on mount, so the un-mocked `fetch("/api/library")` rejects in jsdom and the shell tests that assert "No papers yet." on first render will race the loading→error path. Fix: in `beforeEach` (or per test) `vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [], folders: [] })`, and change the empty-state assertions to `await waitFor(() => expect(screen.getByText("No papers yet.")).toBeTruthy())` (the copy now appears after the fetch settles, not synchronously). The two Add-bridge tests must also mock `getLibrary` (resolve empty) to avoid an unhandled rejection.
  - [x] `CollectionTable.test.tsx` (new): render with a `rows` fixture of a couple `CollectionRow`s → asserts the four column headers, the count line "2 files in library", a human date cell (assert the formatted string, not the ISO), the PDF/Note badge label, ellipsis class/style present, and `Untitled` fallback for a `null` title. Render with `loading` → asserts skeleton rows present and NO real data. Keep fixtures inline (mirror `LibraryPage.test.tsx`'s `fakeDoc` idiom); `CollectionRow` shape is `{ doc_id, title, authors, added, file_type, status, folder_id, trashed, order }`.
  - [x] `LibraryPage.test.tsx` new cases: `getLibrary` resolves with papers → the table renders (a row's title visible, count line shown), empty copy NOT shown; `getLibrary` rejects → `Couldn't load your library.` toast shown and no table; loading → skeleton shown before the promise resolves (assert skeleton, then `waitFor` the resolved state). Use the existing `createMemoryRouter`/`renderLibrary` harness.
  - [x] `cd client && npm run typecheck` clean; `cd client && npm test` green (run the whole suite — the shell-test edits must not regress the 861 baseline). Grep the new strings for `—` before committing.

- [x] **Task 6, Live smoke (AC: 1-6)**
  - [x] Per CLAUDE.md, launch your OWN dev servers (fresh `uvicorn` + `vite dev` on alternate ports if 8000/5173 are taken), bound to your working tree, against a scratch `PAPER_MATE_DATA`. Import 2-3 real PDFs via the Add bridge (or `POST /api/docs`), return to `/`, and confirm: the table lists them (Title / Authors / Added / File type), the count line reads "N files in library", Added shows a human date, File type shows a PDF badge, row hover shifts to `surface-strong`, and a keyboard-focused control shows the 2px ink focus ring. Confirm the empty state ("No papers yet.") on a fresh data root, and that the skeleton flashes on a throttled load. Shut the servers down after.
  - [x] This is a table-render story, NOT a geometry/placement/anchor feature, so the AE-5 DPR>1 live-smoke gate does not apply (no PDF coordinates, no canvas). A single normal-DPR real-data pass is sufficient. [Source: CLAUDE.md AE-5 scope — placement features only]

- [x] **Task 7, Version bump (at merge)** [`server/pyproject.toml`]
  - [x] PATCH +1 at PR-merge (CLAUDE.md versioning). Read `[project].version` first (it is `0.4.2` as of this writing) and bump `0.4.2 → 0.4.3`. Single source is `server/pyproject.toml`; never hard-code a version elsewhere. Re-run `uv lock` after the bump and confirm `server/tests/test_version.py` (pyproject vs `uv.lock`) stays green.

### Review Findings

- [ ] [Review][Patch] Loading skeleton does not reserve the loaded table count line [`client/src/library/CollectionTable.tsx`:39]
- [ ] [Review][Patch] `GET /api/library` docs omit the new `CollectionRow.filename` response field [`docs/API.md`:130]

## Dev Notes

### The shape of this change (read first)

Story 6.2 built the backend: `GET /api/library` returns `Library = { papers: CollectionRow[], folders: Folder[] }` from `library.json`'s display cache in one read, and the `Library`/`CollectionRow`/`Folder` TS types + type aliases already exist in `client/src/api/client.ts`. Story 6.1 built the Library **shell**: `LibraryPage` renders a top-bar (brand + single-file Add bridge), a static folder-panel placeholder, and a centered "No papers yet." copy. **This story is purely client**: add the `getLibrary()` fetch, fetch it on mount in `LibraryPage`, and render the papers as a table (with loading skeleton + empty + error states). No backend change, no contract regen, no new endpoint.

Downward-dependency rule (AD-9) holds: `LibraryPage` (route view) → `api/client.getLibrary` → backend. `CollectionTable` is a pure presentational leaf (rows in, DOM out); it never fetches.

### Scope fence — what this story does NOT build

The Library table's full design (L-UX-DR2) bundles interactions that belong to **later** stories. Build ONLY the read-only table now:

- **No double-click-to-open.** Row → `/reader/:docId` navigation is **Story 6.7** (open-in-annotator). Rows are not clickable-to-open here. [epics.md Story 6.7]
- **No leading multi-select checkbox.** The per-row checkbox (L-UX-DR2) belongs to **Story 7.3** (multi-select batch move). Do not add a checkbox column. [epics.md Story 7.3]
- **No sort / filter / display controls.** Column sort, filter, and show/hide (L-UX-DR3) are **Story 7.4**. Render rows in the response `order`; no sort UI. [epics.md Story 7.4]
- **No inline edit.** Click-to-edit Title/Authors (L-UX-DR7) is **Story 6.6**. Cells are read-only text. [epics.md Story 6.6]
- **No dropzone / optimistic rows / polling / status rendering.** The real drag-drop dropzone (L-UX-DR5), optimistic `extracting` rows, and `GET /api/library` polling (L-UX-DR6) are **Stories 6.4/6.5**. Keep Story 6.1's single-file Add bridge and its "No papers yet." empty copy; do NOT build `{component.empty-dropzone}` here. **Status is not a visible column** (the four columns are Title/Authors/Added/File type); a 6.3-era paper is always `status: ready` anyway. [epics.md Stories 6.4/6.5]
- **No folder panel behaviour.** The folder-panel placeholder stays static (Epic 7 owns folder CRUD/selection). [epics.md Epic 7]

The AC's "the dropzone + 'No papers yet.' copy shows" (epics line 1384) is satisfied incrementally: 6.3 keeps the empty copy + the 6.1 Add bridge; the dropzone proper lands in 6.4. Do not pull 6.4's dropzone forward.

### Regression heads-up — the 6.1 shell tests break unless you mock `getLibrary`

This is the highest-risk regression. `LibraryPage.test.tsx` (Story 6.1) mounts `LibraryPage` with no `getLibrary` mock and asserts `screen.getByText("No papers yet.")` **synchronously**. After Task 3, mount triggers `getLibrary()`; un-mocked, `fetch` rejects in jsdom and the empty copy appears (if at all) only after the loading→error transition. Every shell test must (a) `vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [], folders: [] })` and (b) wrap the empty-copy assertion in `await waitFor(...)`. The two Add-bridge tests need the same mock to avoid an unhandled promise rejection polluting the run. This is the analog of the "keep the render/ mocks in sync" rule (CLAUDE.md) — a store/fetch a component now calls on mount must be mocked in every test that mounts it. [Source: client/src/library/LibraryPage.test.tsx:44]

### Reuse, do not reinvent (CLAUDE.md engineering principles)

- **`getLibrary()` mirrors `getAnnotations`/`getDoc`** in `client/src/api/client.ts` (fetch → `envelopeError` on `!ok` → cast). Copy that idiom exactly; do not invent a new fetch wrapper. [Source: client/src/api/client.ts:65-97]
- **`Toast`** (`@/components/Toast/Toast`) is already imported and used by `LibraryPage` for the upload error — reuse it for the load-error notice; do not build a second toast. [Source: client/src/library/LibraryPage.tsx:5,72]
- **Human date = `Intl`/`toLocaleDateString`**, not a date library. One call, no dependency. There is no existing date helper in `client/src/lib/` (checked: `bank`, `tools`, `uuid`, `domFocus` only), so a tiny local `formatAdded` is the smallest correct structure.
- **No virtualization.** The reader uses windowing (Story 1.7) because it renders heavy PDF canvases; a text table of hundreds of rows does not need it. Plain `<tbody>` rows scroll fine (NFR-4 = "no multi-second stall", not "60fps at 100k rows"). Adopting a windowing lib here would be reinventing a problem you do not have. [Source: CLAUDE.md engineering principles; architecture-spine NFR-4]

### Tokens & styling (L-UX-DR2, no-raw-values guard)

- `src/no-raw-values.test.ts` scans every `.tsx`/`.css` under `src/` (except `theme/`, `schema.d.ts`, tests) for raw hex (`#[0-9a-fA-F]{3,8}`) and `\d+px` outside comments, and **fails the build** on a hit. So `CollectionTable.css` and any inline style must reference `--` vars only. Any new px (row height, column widths, badge padding) goes into `client/src/theme/components.css` (the token layer, exempt) as a `--` var, then is referenced from the component CSS — exactly how `LibraryPage.css` uses `--toc-panel-width`, `--top-bar-height`, etc. [Source: client/src/no-raw-values.test.ts; client/src/library/LibraryPage.css]
- Token map for this table (DESIGN.md):
  - Header/label cells → `{typography.title-sm}` = `--type-title-sm-{size,weight,leading}`.
  - Body rows → `{typography.body-sm}` = `--type-body-sm-*`, color `{colors.body}` = `--color-body`.
  - Count line → `{typography.caption}` = `--type-caption-*`.
  - Row hover → `{colors.surface-strong}` = `--color-surface-strong`.
  - Badge → `{component.badge-pill}`: `--color-surface-strong` fill, `{typography.caption-uppercase}` (**add** `--type-caption-uppercase-*` in Task 4), pill radius `--radius-pill`. [Source: DESIGN.md#components badge-pill line 539, #typography line 404]
  - Main floor stays `{colors.reader-backdrop}` = `--color-reader-backdrop` (already on `.library-main`).

### Skeleton / reduced motion (L-UX-DR11, L-UX-DR12)

Skeleton rows must reserve the real table's layout (same column count, same row height) so there is no jump when data lands. A pulse/shimmer keyframe is fine but MUST be gated: `@media (prefers-reduced-motion: reduce) { .skeleton-row { animation: none; } }`. No new library — a CSS keyframe is enough. Keep the skeleton count fixed (e.g. 6 rows); it is a placeholder, not tied to the real count (which is unknown until the fetch lands).

### Accessibility floor (L-UX-DR12, inherited UX-DR17)

Use a semantic `<table>` (`<thead>` with `<th scope="col">`, `<tbody>`). The count line is plain text. No interactive controls are added in this story (rows are not yet buttons/links — that is 6.7), so there is no new focus-ring surface here beyond what 6.1 already ships; the existing top-bar controls keep their 2px `{colors.ink}` focus ring. Do not add `role`/`tabindex` to rows now (they become keyboard-openable in 6.7).

### Layout note (`.library-main` centers today)

`.library-main` is a centered flex box for the empty copy. The table needs a top-aligned, `overflow-y:auto` container. Branch on state: keep centered copy for empty/loading-empty, and a scrolling column layout for the table. Keep horizontal overflow off the page body — the table (and its own `overflow-x:auto` wrapper if columns get wide) scrolls internally, never the page. [Source: client/src/library/LibraryPage.css:85-91]

### Project Structure Notes

- **New:** `client/src/library/CollectionTable.tsx`, `client/src/library/CollectionTable.css`, `client/src/library/CollectionTable.test.tsx`. Colocated under `src/library/` next to `LibraryPage.*` — matches the Story 5.4 folder convention (component + css + test together). This realizes the spine's `client/src/library/` = "table, folders panel, upload orchestration, trash". [Source: architecture-spine Structural Seed; sprint-status 5-4-client-src-modularize]
- **Extended:** `client/src/library/LibraryPage.tsx` (fetch + state switch), `client/src/library/LibraryPage.css` (main-region layout for the table case), `client/src/library/LibraryPage.test.tsx` (mock `getLibrary` + new cases), `client/src/api/client.ts` (+`getLibrary`), `client/src/theme/components.css` (+`caption-uppercase` typography, badge dims), `server/pyproject.toml` + `server/uv.lock` (version bump at merge).
- **Untouched:** router, ReaderPage, storage, models, all backend routes, the OpenAPI contract (no regen — no model/endpoint change). `LibraryPage` does not import `render/`, so the `vi.mock("./render")` barrels (App.test/Reader.test) are NOT affected by this story.
- Downward-dependency rule (AD-9) intact: view → api client → backend; presentational leaf takes data as props.

### Testing standards

- Vitest + `@testing-library/react`, jsdom. Mock the API module (`import * as api from "@/api/client"`, `vi.spyOn(api, "getLibrary")`), never real `fetch`. Render `LibraryPage` inside `createMemoryRouter` (the existing `renderLibrary` harness) because it calls `useNavigate`. `CollectionTable` is a pure component — render it directly with a `rows` prop, no router needed (unless you add row navigation, which you should NOT in this story).
- Assert the **formatted** date string in tests, not the ISO input, so a regression in `formatAdded` is caught. Pick a fixture `added` whose formatted output is timezone-stable enough for CI (or assert a substring like the year/month, to avoid TZ flake on the day boundary).
- Run the FULL client suite (`npm test`) — the 6.1 shell-test edits are the risk; the 861-test baseline must stay green (plus the new tests).
- No backend tests change (no backend code changes). No DPR>1 smoke (not a placement feature). One real-data live pass (Task 6) is the manual gate.

### DECISION notes (defaults chosen; confirm if you disagree)

1. **`CollectionTable` is a separate presentational component** (not inlined into `LibraryPage`). Rationale: OOP decomposition (CLAUDE.md), colocated test, keeps `LibraryPage` as the data-owning container. Alternative (inline table in LibraryPage) rejected — worse separation, harder to unit-test the render.
2. **Empty state = keep 6.1's "No papers yet." copy**, not a new dropzone. The dropzone is Story 6.4 (L-UX-DR5). See Scope fence.
3. **Skeleton via CSS keyframe**, reduced-motion-gated. No skeleton library. Fixed placeholder row count.
4. **No virtualization.** Plain rows; hundreds scale fine. See Reuse note.
5. **`null` title → `Untitled` (muted); `null` authors → empty.** The row has no filename field to fall back to (filename lives on `Doc`/`meta.json`, not `CollectionRow`), so `Untitled` is the honest placeholder until extraction (6.5) or inline edit (6.6) fills a title.
6. **Load error copy = `Couldn't load your library.`** (matches the 6.1 upload-error voice `Couldn't add this file.`; fact, plain, no em-dash, L-UX-DR13).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-6.3] — the 6 ACs (table + columns + count, row presentation, hover, empty/loading, scale, no em-dash)
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR2] — collection table columns, typography, hover, ellipsis, human date, badge-pill, count line (checkbox + double-click are LATER stories)
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR11] — empty + loading (skeleton) states
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR12] — accessibility floor, prefers-reduced-motion
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR13] — Obsidian-quiet voice, no em-dash
- [Source: architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L1] — display cache = one read; `CollectionRow` fields
- [Source: architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L6] — `GET /api/library` = the table (display cache), poll target
- [Source: architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L3] — sort/filter/trash are Library view-state (later stories), not routes; router unchanged here
- [Source: .bmad/implementation-artifacts/6-2-collection-index.md] — the `GET /api/library` contract, `Library`/`CollectionRow`/`Folder` types + aliases already in `client.ts`, `getLibrary()` explicitly deferred to this story
- [Source: client/src/library/LibraryPage.tsx] — the shell to extend (top-bar, Add bridge, folder placeholder, empty copy, Toast usage)
- [Source: client/src/library/LibraryPage.css] — `.library-main` centered layout to adapt for the table
- [Source: client/src/library/LibraryPage.test.tsx] — the shell tests that break; `createMemoryRouter`/`renderLibrary` harness, `fakeDoc` fixture idiom
- [Source: client/src/api/client.ts] — `getAnnotations`/`getDoc` fetch idiom to mirror; `Library`/`CollectionRow`/`Folder` aliases
- [Source: client/src/theme/components.css] — token layer (add `caption-uppercase`, badge dims here; px allowed)
- [Source: client/src/theme/tokens.css] — generated color/spacing/rounded vars (`--color-surface-strong`, `--color-body`, `--color-reader-backdrop`, `--radius-pill`)
- [Source: client/src/no-raw-values.test.ts] — the hex/px guard that governs the new CSS
- [Source: DESIGN.md#components] — `badge-pill` (line 539), `top-bar`; #typography (line 400-404) title-sm/body-sm/caption/caption-uppercase scales
- [Source: CLAUDE.md] — tokens never inline hex/px, no em-dash in UI strings, don't reinvent wheels, launch your OWN dev servers for smoke, versioning (PATCH +1 at merge), branch-per-story

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `cd client && npm run typecheck` — clean, no errors.
- `cd client && npm test` — 44 files, 874 tests passed (baseline 861 + 13 new; no regressions).
- `cd server && uv run pytest -q` — 96 passed (incl. `test_version.py` after the 0.4.2 → 0.4.3 bump).
- Live smoke: fresh `uvicorn` (port 8099) + `vite dev` (port 5199) against a scratch `PAPER_MATE_DATA`, imported 3 real PDFs (`09-regularization.pdf`, `no-outline.pdf`, `outlined-sample.pdf`) via `POST /api/docs`. Confirmed via Playwright: empty state before import, skeleton rows mid-fetch, loaded table with count line "3 files in library", `Untitled` fallback (no extraction pipeline yet so titles are null), human dates ("Jul 5, 2026"), PDF badges, row hover background exactly `rgb(240, 240, 243)` = `--color-surface-strong` (`#f0f0f3`), and the existing 2px ink focus ring on the Add button. Servers shut down and scratch data dir removed after.

### Completion Notes List

- Added `getLibrary()` to `client/src/api/client.ts` mirroring the `getAnnotations`/`getDoc` idiom; removed the stale "no fetch function yet" comment on the Story 6.2 type aliases.
- Built `CollectionTable` (presentational, `rows` or `loading` prop) + `CollectionTable.css`: semantic table, count line, ellipsis title/authors, `Untitled` fallback for null title, `formatAdded` helper (guards `Invalid Date`), `badge-pill` (PDF/Note), row hover, and a 6-row skeleton with a `prefers-reduced-motion`-gated pulse.
- Wired `LibraryPage` to fetch on mount (with an unmount-guard) and switch between skeleton / table / empty-copy / error-toast; added a `loadFailed` flag so a fetch error shows only the toast (not a misleading "No papers yet."). Adapted `.library-main` to a top-aligned scrollable region for the table case while keeping the empty/loading-empty case centered.
- Added `--type-caption-uppercase-*` (including the `0.88px` letter-spacing DESIGN.md specifies for this scale, which the story's own dev note incorrectly said to omit) and `--badge-pill-*` / `--collection-table-*` dimension vars to `client/src/theme/components.css` (token layer, px-exempt).
- Fixed the Story 6.1 regression: every `LibraryPage.test.tsx` case now mocks `getLibrary` and awaits the fetch settling before asserting on empty/loaded/error state. Added `CollectionTable.test.tsx` (headers, count line, human date, badges, ellipsis class, `Untitled` fallback, skeleton) and new `LibraryPage.test.tsx` cases (loaded table, load-error toast, skeleton-before-resolve, Add bridge still works after a load failure).
- Bumped `server/pyproject.toml` version `0.4.2 → 0.4.3` (PATCH, this story) and re-ran `uv lock`; `test_version.py` stays green.

**Post-review fix requests (same session, two rounds):**

*Round 1:*
- **Open a row (initially double-click):** added `onOpenRow(docId)` to `CollectionTable` (required when not `loading`). `LibraryPage` supplies `navigate(\`/reader/${docId}\`)`, keeping `CollectionTable` presentational (AD-9: it reports the gesture, not navigate itself).
- **Filename fallback for null title:** `CollectionRow` gained an additive, optional `filename: str | None = None` field (backend `models.py`), populated by `_cache_from_meta`. Regenerated `server/openapi.json` + `client/src/api/schema.d.ts`. `reconcile_library()` now also refreshes the display cache for already-indexed entries (previously only newly-discovered dirs got a fresh cache), so existing pre-fix `library.json` rows backfill `filename` on the next server start without a re-import.
- Added backend test `test_reconcile_backfills_filename_for_pre_existing_entry`; extended `test_import_indexes_paper_as_uncategorized` to assert `filename`.

*Round 2 (superseded round 1's open gesture and refined the fallback):*
- **Click-to-select, click-again-to-open:** replaced the double-click with a single-click interaction: a row click selects it (`aria-selected`, a `--color-ink` inset left accent via `box-shadow`, kept local `useState` in `CollectionTable` since nothing outside the table needs the selection); clicking the already-selected row calls `onOpenRow`; clicking a different row moves the selection instead of opening it.
- **Strip the `.pdf` extension from the filename fallback:** added `stripPdfExtension()` so the fallback title reads e.g. `no-outline` instead of `no-outline.pdf`. Title fallback chain is now `row.title ?? (row.filename ? stripPdfExtension(row.filename) : null) ?? "Untitled"` (muted `Untitled` only when neither is known).
- Updated `CollectionTable.test.tsx` (filename-without-extension fallback, select-without-opening, open-on-second-click, selection-moves-to-newly-clicked-row) and `LibraryPage.test.tsx` (click-select-then-click-open navigates to `/reader/:docId`); removed the now-superseded double-click tests.
- Full suites green after both rounds: 97 backend tests, 879 client tests (44 files), typecheck clean. Live-smoked against fresh scratch servers with real imported PDFs: title shows without `.pdf`, first click selects (no navigation), second click on the selected row opens the reader with the correct file.

**`bmad-code-review` via Codex (against `baseline_commit..HEAD` at round-1 completion, i.e. the story implementation + round-1 fix requests):** 0 decision-needed, 2 patch, 0 defer. Both patch findings addressed in this same session (before round 2's fixes above were committed, so the diff scope differs slightly from what Codex reviewed):
- **Skeleton didn't reserve the count-line's space (AC-4 layout-jump violation):** `TableSkeleton` rendered a bare `<table>` while the loaded state wraps `<p className="collection-table__count">` + `<table>` in `.collection-table-wrap` — the count line's height only appeared once data landed. Fixed: `TableSkeleton` now renders the same `.collection-table-wrap` with an `aria-hidden` placeholder `<p className="collection-table__count">` containing a `.collection-table__count-skeleton` pulse bar sized to `calc(var(--type-caption-size) * var(--type-caption-leading))` (the real line's box height, not just its font-size). Verified 0px diff by measuring both variants' `getBoundingClientRect().height` in a live browser.
- **`docs/API.md` didn't document the new `CollectionRow.filename` field:** added it to the `GET /api/library` example JSON, the field-provenance callout, and a new changelog entry (project rule: update `docs/API.md` in the same change as any `/api` contract edit).
- Codex's "Reviewed, No Finding" notes (informational, no action): `reconcile_library`'s cache refresh preserves `folder_id`/`trashed`/`order` and `_upsert_paper_entry` stays idempotent; `onOpenRow`'s required-when-not-loading prop typing is correct; the row-click gesture is fine for now but future row-level features (inline edit, text selection) should mind click-handler conflicts — noted here for whoever builds those (Story 6.6/7.3), no action needed today since round 2 already replaced double-click with single-click-to-select anyway.
- Full suites re-verified green after both doc/skeleton fixes: typecheck clean, 879/879 client tests (one unrelated `Reader.test.tsx` wheel-zoom flake reproduced only in the full-suite run, passed in isolation and on a full-suite rerun — not touched by this diff).

### File List

- `client/src/api/client.ts` (modified: added `getLibrary()`)
- `client/src/library/CollectionTable.tsx` (new; later modified for `onOpenRow` + filename fallback)
- `client/src/library/CollectionTable.css` (new; later modified: pointer cursor on row hover)
- `client/src/library/CollectionTable.test.tsx` (new; later modified: filename-fallback + double-click cases)
- `server/app/models.py` (modified: `CollectionRow.filename`)
- `server/app/storage/__init__.py` (modified: `_cache_from_meta` + `reconcile_library` backfill)
- `server/tests/test_storage.py` (modified: filename assertions + backfill test)
- `server/openapi.json` (regenerated)
- `client/src/api/schema.d.ts` (regenerated)
- `client/src/library/LibraryPage.tsx` (modified: fetch-on-mount, loading/error/empty/data switch)
- `client/src/library/LibraryPage.css` (modified: `.library-main--table` scrollable layout)
- `client/src/library/LibraryPage.test.tsx` (modified: mock `getLibrary` everywhere, new table/error/skeleton cases)
- `client/src/theme/components.css` (modified: `caption-uppercase` typography, `badge-pill`/`collection-table` dims)
- `server/pyproject.toml` (modified: version `0.4.2 → 0.4.3`)
- `server/uv.lock` (modified: re-locked after version bump)
- `docs/API.md` (modified: documented `CollectionRow.filename`, Codex review finding)
