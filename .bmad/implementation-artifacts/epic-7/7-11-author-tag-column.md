---
baseline_commit: 242fa493f401b56c6b0815ffce0d31f3b918fdf9
---

# Story 7.11: Tag-type columns, Author as editable, filterable tags

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the Author column to show each author as its own tag that I can add, remove, and filter by,
so that authorship reads and behaves like a real multi-value field instead of one flat string.

## Context

Today authorship is a **flat string** everywhere the user touches it, even though the backend's own domain layer already carries the honest multi-value shape:

- **Domain (honest `list[str]`):** `ExtractedMeta.authors: list[str]` (`server/app/models.py:45`). `extract()` / `enrich()` / `crossref` / `arxiv_enrich` all produce and pass a real list.
- **The flatten point (ONE line):** `server/app/routes/extraction.py:34` does `authors = ", ".join(final.authors) or None` and hands storage a single string. The list is lost right there. (Note the irony: `apply_extraction`'s own docstring already claims *"storage owns the domain `list[str]` -> `str` join"* (`documents.py:128`) but the join actually happens upstream in the route.)
- **Storage / contract (flat `str`):** `DocMeta.authors: str | None` (`models.py:77`), `CollectionRow.authors: str | None` (`models.py:201`), `_cache_from_meta` projects the string (`library_index.py:95`).
- **Client (flat `str`):** the Authors column is an `EditableCell` rendering `row.authors ?? ""` and inline-editing that one string (`PaperRow.tsx:130`); `EditableField` includes `"authors"` (`row.ts:5`); `useInlineEdit` sends `{ authors: string }` via `PATCH /api/docs/{id}` (`useInlineEdit.ts`).

This story surfaces authors as a **first-class list end-to-end** and turns the Author column into a **tag cell**: each author is a chip; the user can **add / remove** authors as chips; and **clicking a chip filters** the table to rows containing that author. It also introduces the column **cell-type seam** (a column declares `cellType`, the renderer dispatches on it) that Story 7.12 (the Epic 7 refactor, now the last story) later consolidates as the canonical column-descriptor/renderer seam.

**Colors are NOT in this slice** (decided with the user): chips render with a uniform, token-driven style that is *color-ready* (a per-value color assignment is a deferred follow-up).

This is a **full-stack, contract-changing** story (unlike Story 7.10, which was client-only): it changes the `meta.json` authors representation, the Pydantic → OpenAPI → generated TS contract, `docs/API.md`, the inline-edit path, and adds a client filter surface.

**Source:** `epics.md` Story 7.11 (full ACs, lines 1839-1869); `sprint-change-proposal-2026-07-08-table-columns.md`; LFR-4, LFR-6, L-UX-DR3, L-UX-DR12, L-UX-DR13; AL-1, AL-6, AL-8, AD-3, AR-3, AR-7/AD-7, NFR-5.

## Design decisions (open calls resolved at create-story)

The epic left four open calls (`epics.md:1869`). Resolved here so the dev agent does not re-litigate them. **Read these before starting; they are load-bearing.**

### 1. `meta.json` authors schema: additive `authors_list`, NO `schema_version` bump. The list is authoritative; the string is derived.

Add `DocMeta.authors_list: list[str] = []` (additive, default `[]` so an existing v1 `meta.json` still validates, exactly like the 7.9 `venue`/`year` and 6.2 `authors`/`file_type`/`status` additions, none of which bumped `schema_version`). Keep `DocMeta.authors: str | None`, but it becomes a **derived display cache** = `join_authors(authors_list)` (or `None` when empty), never independently authored.

- **`authors_list` is THE authority; `authors` (the join) is ALWAYS derived from it, forward-only.** Two validators, NOT one bidirectional one (see the write-path trap in Dev Notes for why bidirectional is a bug):
  - **`model_validator(mode="before")`** (legacy self-heal, decision 3): looking at the RAW input mapping, if the `authors_list` KEY is absent/None but `authors` (string) is present → inject `authors_list = split_authors(authors)`. Key-absence is only true for a pre-7.11 file; anything this story writes always carries the key, so it never fires spuriously.
  - **`model_validator(mode="after")`** (forward derive, always): `authors = join_authors(self.authors_list)`. This is the single writer of the string.
- **Rationale:** the whole `DocMeta`/`CollectionRow`/`library.json` history is *additive, no `schema_version` bump, old files validate via defaults* (`models.py:64-86`, `194-227`). A typed migration + `schema_version` bump + old-doc read path is heavier than this change warrants and breaks that streak for no gain. Keeping the derived `authors` string means SORT (`tableView.ts:sortKey` sorts on `row.authors`), and every existing reader/test that reads `authors`, keep working untouched.
- **Do NOT write a bidirectional `mode="after"` heal** (`if authors_list empty and authors present: authors_list = split(authors)`). It cannot tell an explicit "clear all authors" edit (`authors_list=[]`, stale `authors` still on the record) from a legacy read, so it would RESURRECT deleted authors from the stale join. The `mode="before"` key-absence check is what disambiguates them (see Dev Notes → "The model_copy write-path trap").

### 2. Edit path: widen `DocPatch` with `authors_list` (full-list replacement), reuse the existing PATCH path. NO new endpoint, NO add/remove op.

Replace `DocPatch.authors: str | None` with `DocPatch.authors_list: list[str] | None = None`; keep `title` / `venue` / `year` as-is. The tag editor computes the **new full author list** client-side (add appends, remove drops) and sends the whole list. The route reuses `update_doc_meta` (`documents.py:146`) → `library_index.update_meta_and_reindex` → `_cache_from_meta`; on write, `authors_list` is set and `authors` is re-derived by the model.

- **Rationale:** a full-list replacement is the *smallest correct structure* (CLAUDE.md): it reuses the entire Story 6.6 optimistic-write / revert / `editSeq` machine (`useInlineEdit.ts`), the one `PATCH /api/docs/{id}` route, and `update_doc_meta`'s TOCTOU-guarded reindex core. A dedicated add/remove endpoint would mean a new route + a new storage mutator + new optimistic reconcile for zero benefit over "send the intended list". "No author silently lost" (LFR-4, FR-10-style) is satisfied by construction, because the client sends exactly the set it wants.
- Removing `authors: str` from `DocPatch` is a contract change (the point of this story). With `extra="forbid"`, a stale client sending `{ authors: "..." }` now gets a loud 422 rather than a silent flat-string write that would desync from `authors_list`; nothing in-tree sends it after this story.

### 3. Back-compat parse (papers imported before this story): self-heal on read, split on `", "`.

An old `meta.json` has `authors` (a joined string) but no `authors_list` KEY at all. The `model_validator(mode="before")` (decision 1) fills the gap by looking at the RAW input mapping: **when the `authors_list` key is absent/None and `authors` is non-empty, inject `authors_list = split_authors(authors)`.** Split on the single existing join delimiter `", "` (`extraction.py:34`), trimming and dropping blanks. Key-absence (not emptiness) is the signal, so an explicit "clear all authors" write (which carries `authors_list=[]`) is NOT mistaken for a legacy read and does not resurrect authors.

- Home the delimiter + `join_authors(list) -> str | None` + `split_authors(str) -> list[str]` in **one pure leaf** (see Project Structure Notes: `server/app/authors.py`) imported by `models.py` (the validator), the extraction route, and the PATCH route, so the `", "` delimiter is defined **once**, not copied. This also lets the extraction route stop joining and hand storage the list (aligning code with `apply_extraction`'s own docstring, decision 5 below).
- **Round-trip caveat (documented, accepted):** `join`→`split` is exact only when no author name itself contains `", "` (rare: "Smith, Jr."). This is a best-effort back-compat bridge for *un-edited* legacy rows; the moment a user edits authors via chips, the real list is stored and future reads are exact. Note it in a code comment; do not build a smarter parser.

### 4. Filter-by-tag: build MINIMAL new view-state (click a chip). The generic 7.4 Filter control was REMOVED and is NOT rebuilt.

**Critical scope correction.** The epic AC (`epics.md:1864`) says "integrating with Story 7.4's Filter control." **That control no longer exists:** Story 7.4's `FilterMenu` / `ColumnFilter` / `applyColumnFilter` were **descoped and removed** on 2026-07-06 by user request ("not needed right now") after 7.4 shipped (see `7-4-display-sort-filter-controls.md` Descope note; `grep FilterMenu client/src` → nothing). Only **Display** (hide columns) + **Sort** remain.

So this story does **not** rebuild a generic column-filter UI. It adds the *tag* filter as its own minimal client view-state, mirroring how `sort` already works:

- A new `authorFilter: string | null` piece of state in `useTableView` (peer of `sort`), folded into `applyTableView` as `applyTagFilter(rows) → sortRows(...)` so it runs upstream in `LibraryPage`, keeping the SAME array 7.3's range-select indexes (the discipline 7.4/7.10 established).
- **Clicking an author chip** sets the filter; a small active-filter indicator near the count line (a pill showing the author + a clear "×") clears it. The count line reflects the filtered set for free (it already reads `visiblePapers.length`).
- **Set-membership** match on `authors_list` (a row passes if its `authors_list` contains the filter author), NOT a substring on the joined string (LFR-6).
- Building a general reusable `FilterMenu` is explicitly **out of scope** (it was deliberately removed; one tag-scoped filter is the smallest correct structure that satisfies the user's "filter by author" request).

### 5. Move the list→string join OUT of the route INTO storage (align with the docstring).

Currently the *route* joins (`extraction.py:34`) while `apply_extraction`'s docstring claims *storage* owns it. Fix in place (CLAUDE.md: refactor structure in the same change): `apply_extraction` takes `authors_list: list[str]`, and storage/model derive the join. The route passes `final.authors` (the list) straight through. One join site, matching the stated ownership.

## Cell-type seam scope (introduce, don't over-build; 7.12 consolidates)

Add `cellType: "text" | "number" | "badge" | "tag"` to `ColumnDef` (`tableView.ts:11`) and declare Author `tag`. The row render (`PaperRow.renderCell`, currently a `switch (col.key)`, `PaperRow.tsx:91`) dispatches the **`tag`** type through a dedicated `TagCell`. Columns with bespoke affordances (Title's Open button + Star, DOI's link, Location's folder icon, File type's badge) keep their per-key markup this story. **Introduce the seam (the `cellType` field exists and `tag` dispatches through it); do NOT force every column into a general registry now** (`epics.md:1850` calls for "not a per-column `if` chain" as the end state; Story 7.12 is the consolidation pass, `epics.md:1873`). Keep it the minimal seam 7.11 formalizes over 7.10's ordered `switch`.

## Acceptance Criteria

**AC-1, A column declares a `cellType` and the table dispatches on it; Author is `tag`.** Given the collection table, then `ColumnDef` carries a `cellType` (`text` / `number` / `badge` / `tag`), the Author column declares `tag`, and the row render dispatches the `tag` cell through a dedicated `TagCell` (not an ad-hoc per-column `if`). This is the cell-type seam Story 7.12 later consolidates. (`epics.md` AC-1; LFR-4, AD-5-style dispatch)

**AC-2, Authors are a first-class list end-to-end.** Given the authors value, then it is surfaced as a `list[str]` from domain through to the client: `DocMeta` holds `authors_list` (additive, default `[]`, no `schema_version` bump; `authors` becomes the derived join); `CollectionRow` exposes `authors_list` (additive contract: Pydantic → OpenAPI → regenerated `schema.d.ts`; `docs/API.md` updated); `_cache_from_meta` projects it; and `apply_extraction` receives the list (the route no longer pre-joins). (`epics.md` AC-2; AL-1, AL-6, AL-8, AR-3/AD-3, NFR-5)

**AC-3, Each author renders as a distinct, uniform, color-ready chip.** Given the Author cell rendered as tags, then each author is a distinct chip in a uniform token-driven style (no per-value colors this story, but the chip style is a component token, color-ready); the cell wraps to multiple chips and truncates/clips without reflowing the row frame like the other cells; no raw hex/px outside `src/theme/**`. (`epics.md` AC-3; L-UX-DR3)

**AC-4, Add / remove author tags, persisted, no author lost.** Given a selected paper's Author cell (armed, the lone-selection edit state, mirroring the existing inline-edit), when I add an author (a "select or create" affordance) or remove a chip, then the new full author list persists to `meta.json` via `PATCH /api/docs/{id}` (`DocPatch.authors_list`) through the existing optimistic-write/revert path; the `library.json` display cache refreshes; and no author is silently lost. (`epics.md` AC-4; LFR-4, AR-7/AD-7, FR-10-style never-lost)

**AC-5, Click a chip / set an author filter narrows the table by set-membership.** Given the Author tags, when I click an author chip (or otherwise set the author filter), then the table filters to rows whose `authors_list` CONTAINS that author (set-membership, not a substring on a joined string); an active-filter indicator shows the author with a clear affordance; the count line ("N files in ...") reflects the filtered set; clearing restores all rows. The filter is client view-state (not persisted, not a route), folded upstream in `LibraryPage` so 7.3's range-selection still indexes the visible array. (`epics.md` AC-5; LFR-6)

**AC-6, Back-compat: legacy joined-string authors still render as chips.** Given a paper imported before this story (its `meta.json` has `authors` as a joined string, no `authors_list`), then reading it derives `authors_list` by splitting the join on `", "` (best-effort; a subsequent chip edit stores the exact list), so its Author cell renders chips with no migration step and no data loss. (decision 3; AL-1, additive/back-compat)

**AC-7, UI strings em-dash-free; chips + editor keyboard-operable with visible focus.** Given any new UI string (chip labels, the add-author affordance, the filter/clear copy, aria-labels), then none contains an em-dash (`—`), and the chips + tag editor + chip-remove + filter-clear are keyboard-operable with visible focus. (`epics.md` AC-6; L-UX-DR12, L-UX-DR13)

**AC-8, Contract regenerated; both suites green; live-smoked.** Given the model changes, then `server/openapi.json` and `client/src/api/schema.d.ts` are regenerated from the Pydantic source (never hand-authored), `docs/API.md` is updated (CollectionRow + DocPatch + `PATCH /api/docs`), the client + backend suites and typecheck pass, `no-raw-values.test.ts` stays green, and the tag/edit/filter flows are live-smoked on your OWN fresh servers (chips render, add/remove persists across reload, chip-click filters + clears, back-compat legacy row shows chips). Version PATCH bump `0.5.9` → `0.5.10` at story done. (AR-3, CLAUDE.md)

## Scope boundary (read first, prevents scope creep)

**In scope:**

- **Backend contract change:** `DocMeta.authors_list` (additive) + `authors` derived via a `model_validator`; `CollectionRow.authors_list` (additive, defaulted); `DocPatch.authors` → `authors_list`; a pure `server/app/authors.py` (join/split/delimiter); `_cache_from_meta` projection; `apply_extraction`/`update_doc_meta` take the list; the extraction route stops pre-joining. Regenerate `openapi.json` + `schema.d.ts`; update `docs/API.md`.
- **Client tag cell + editor:** a `cellType` on `ColumnDef` with `tag` dispatch; a `TagCell` (chips + click-to-filter) and a Notion-style "select or create" tag editor for the armed cell; the authors edit routed through `useInlineEdit` (or a minimal sibling) as an `authors_list` PATCH with optimistic write + revert.
- **Client tag filter:** `authorFilter` view-state in `useTableView`, an `applyTagFilter` pure fold in `tableView.ts`, an active-filter indicator + clear near the count line in `LibraryPage`, threaded through `CollectionTable`.
- **CSS:** token-driven, color-ready chip + editor styles in `CollectionTable.css`; new `--author-tag-*` (or `--tag-chip-*`) component tokens in `components.css`. Token-only.
- Unit tests (client + backend) + typecheck + a live smoke on your OWN fresh servers. Version bump `0.5.9` → `0.5.10`.

**Out of scope (do NOT build):**

- **Per-value / user-assignable tag COLORS.** Chips are a uniform token style, left color-ready. (Deferred follow-up.)
- **`tag` type on any column other than Author.** Topics / Type / etc. from the screenshot come later once the seam is proven. Author is the ONLY `tag` column this story.
- **A general tag-management surface** (rename / merge / recolor a tag across the whole collection).
- **Rebuilding a generic `FilterMenu` / column-filter control.** It was deliberately removed in 7.4. Build ONLY the tag-scoped author filter (decision 4).
- **The full column-descriptor/renderer registry consolidation.** That is Story 7.12. Introduce the minimal `cellType` seam only (keep the bespoke columns' per-key markup).
- **Persisting the author filter** (or the sort). Filter is ephemeral view-state, per AD-L3. Only 7.10's order/visibility/widths persist.
- **A `schema_version` bump or a typed migration** for authors. Additive `authors_list` + self-heal-on-read only (decision 1/3).
- **Changing `authors` sort behavior.** Sort keeps using the derived join string (`sortKey` unchanged); do not add per-author sort.

## Tasks / Subtasks

- [x] **Task 1, Pure authors join/split leaf (AC-2, AC-6)**
  - [x] Create `server/app/authors.py`: a dependency-free pure module owning the ONE join delimiter `AUTHOR_JOIN = ", "`, `join_authors(authors: list[str]) -> str | None` (strip each, drop blanks, join; `None` when empty), and `split_authors(joined: str | None) -> list[str]` (split on the delimiter, strip, drop blanks). This is the single definition of the delimiter (was implicit at `extraction.py:34`). Colocate `server/tests/test_authors.py`.

- [x] **Task 2, Models: authors as a first-class list (AC-1 back-half, AC-2, AC-6)**
  - [x] `server/app/models.py`: add `DocMeta.authors_list: list[str] = []` (additive, no `schema_version` bump; mirror the 7.9 `venue`/`year` additive comment). Add TWO validators (import `model_validator`): a `@model_validator(mode="before")` legacy heal (raw mapping: `authors_list` key absent/None + `authors` present → inject `split_authors(authors)`), and a `@model_validator(mode="after")` forward derive (`authors = join_authors(self.authors_list)`, the single writer of the string). Do NOT write a bidirectional after-heal (it resurrects cleared authors, see Dev Notes). Document the round-trip caveat (decision 3).
  - [x] `CollectionRow`: add `authors_list: list[str] = []` (additive, defaulted so a pre-existing `library.json` entry validates; reconcile backfills, mirror the `doi`/`venue`/`year` additive comment at `models.py:221`). Keep `authors: str | None` (derived cache, sort key).
  - [x] `DocPatch`: replace `authors: str | None = None` with `authors_list: list[str] | None = None`. Keep `title`/`venue`/`year`. Update the docstring (authors is now a list replacement; `doi` still non-editable).

- [x] **Task 3, Storage projects + persists the list (AC-2, AC-4, AC-6)**
  - [x] `server/app/storage/library_index.py`: `_cache_from_meta` (`:90`) also projects `"authors_list": meta.authors_list` (peer of the existing `"authors"`). The reconcile/backfill path picks it up like `doi`/`venue`/`year`.
  - [x] `server/app/storage/documents.py`: `apply_extraction` takes `authors_list: list[str]` instead of `authors: str | None`; write it into the meta update (the model derives the join). Its docstring already claims storage owns the list→string join, so this makes code match docs. `update_doc_meta`'s `updates` may now carry `authors_list: list[str]`; ensure `library_index.update_meta_and_reindex` writes it and the model re-derives `authors`.
  - [x] **Fix the `model_copy` write-path trap (`library_index.py:447`):** `current.model_copy(update=updates)` does NOT re-run validators, so a `authors_list` update would leave the derived `authors` stale. Change it to re-validate: `updated = DocMeta.model_validate({**current.model_dump(), **updates})` (see Dev Notes → "The model_copy write-path trap"). This keeps the derive/heal invariant on every write AND makes an explicit clear (`authors_list=[]`) correctly yield `authors=None` without resurrecting. Confirm the existing meta round-trip tests stay green; add a test that a `{authors_list}` update re-derives `authors` and that a clear does not resurrect.

- [x] **Task 4, Routes: PATCH accepts the list; extraction stops pre-joining (AC-2, AC-4, AC-5)**
  - [x] `server/app/routes/extraction.py`: delete the `authors = ", ".join(...)` line (`:34`); pass `authors_list=final.authors` to `storage.apply_extraction`. (Storage/model own the join now.)
  - [x] `server/app/routes/docs.py`: `patch_doc` (`:85`) currently strips `title`/`authors`/`venue` strings (`:99`). `authors` is no longer a string field; normalize `authors_list` instead (strip each entry, drop blanks; an empty resulting list is a legitimate "cleared authors" edit → `authors = None`). Keep `title`/`venue` string-strip. `model_dump(exclude_unset=True)` still yields only sent fields.
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api` (commit `openapi.json` + `schema.d.ts`). Update `docs/API.md` (CollectionRow + DocPatch entries + the `PATCH /api/docs/{id}` body + changelog).

- [x] **Task 5, Client column model: cellType seam + tag filter fold (AC-1, AC-5)**
  - [x] `client/src/library/tableView.ts`: add `cellType: "text" | "number" | "badge" | "tag"` to `ColumnDef`; set Author's to `"tag"` (others `"text"`/`"badge"` as fits; File type is `"badge"`). Do NOT reorder `COLUMNS` (7.10 locks its default order). Add a pure `applyTagFilter(rows: CollectionRow[], author: string | null): CollectionRow[]` = set-membership on `authors_list` (no-op when `author` is null; never mutates). `sortKey`/`sortRows` unchanged (authors still sorts on the derived `authors` string).
  - [x] `client/src/library/useTableView.ts`: add `authorFilter: string | null` local state (peer of `sort`, ephemeral) + `setAuthorFilter`. Fold it into `applyTableView`: `sortRows(applyTagFilter(rows, authorFilter), sort, folderNameById)` (filter BEFORE sort). Memoize `applyTableView` on `[authorFilter, sort, folderNameById]`. Expose `authorFilter`/`setAuthorFilter`.

- [x] **Task 6, Client tag cell + editor (AC-1, AC-3, AC-4, AC-7)**
  - [x] New `client/src/library/CollectionTable/TagCell.tsx`: renders `row.authors_list` as chips (uniform token style). Each chip is a keyboard-operable `<button>` whose click (with `stopPropagation`, like the existing DOI link / Open button inside cells, `PaperRow.tsx:119`/`:225`) calls `onFilterByAuthor(author)`. When the row is armed (lone selection) show the tag EDITOR affordance instead of / alongside the chips (an "add author" input + a remove "×" on each chip). Mirror `EditableCell`'s arm→edit lifecycle: an UNARMED cell click bubbles to arm the row; an ARMED cell reveals the editor.
  - [x] New `client/src/library/CollectionTable/TagEditor.tsx` (or inline in `TagCell`): a Notion-style "select or create" affordance: type a name + Enter (or blur) adds it; each chip has a remove control; Esc cancels. It commits the NEW FULL list (`string[]`) up via a callback. Autofocus on open, visible focus rings, no em-dash in any label/aria (AC-7). Reuse `InlineEditor`'s double-fire-guard pattern (`EditableCell.tsx:32`, `committedRef`) so a blur after Enter/Esc does not re-commit.
  - [x] `client/src/library/CollectionTable/PaperRow.tsx`: the `authors` case dispatches to `TagCell` (via `cellType === "tag"`), passing `row.authors_list`, `armed`, `editingField`, `onFilterByAuthor`, and the authors-list commit callback. Keep every other cell byte-identical. `PendingRow.tsx`'s authors cell stays an empty `<td>` (no metadata yet).

- [x] **Task 7, Client edit + filter wiring (AC-4, AC-5)**
  - [x] Route the authors edit through the existing optimistic path. Extend `useInlineEdit` (or add a minimal sibling `useAuthorsEdit` beside it, whichever is the smaller diff) to accept an `authors_list: string[]` commit: optimistic `setLibrary` writing BOTH `authors_list` and the derived `authors` join on the row, `PATCH /api/docs/{id}` with `{ authors_list }`, revert on failure, `editSeq` guard. `EditableField`/`row.ts`: `authors` leaves the plain-string editable set (it is now a tag edit, not an `EditableCell` string edit); `title`/`venue`/`year` stay string edits.
  - [x] `client/src/library/LibraryPage.tsx`: pass `onFilterByAuthor={tableView.setAuthorFilter}` + the authors-list commit down through `CollectionTable`. Render an active-filter indicator near the count line (`:317`) when `tableView.authorFilter` is set: a small pill "Author: {name}" with a clear "×" calling `setAuthorFilter(null)`. The count line already reflects `visiblePapers.length`.
  - [x] `client/src/library/CollectionTable/CollectionTable.tsx`: thread the new props (`onFilterByAuthor`, the authors-list commit) through `CollectionTableProps` → `PaperRow` (mirror the existing optional `onCommit`/`onStartEdit` wiring). Keep them optional for isolated tests.

- [x] **Task 8, CSS: color-ready chip + editor tokens (AC-3, AC-7, AC-8)**
  - [x] `client/src/library/CollectionTable/CollectionTable.css`: chip style (uniform, wraps, clips without growing row height), editor input, remove-"×", and the active-filter pill. Reuse the `badge-pill` idiom (`CollectionTable.css:455`) where sensible.
  - [x] `client/src/theme/components.css`: new `--tag-chip-*` (or `--author-tag-*`) component tokens (padding/height/gap/radius/color), color-ready (a single uniform fill token this story). No raw hex/px outside `src/theme/**` (`no-raw-values.test.ts` enforces it).

- [x] **Task 9, Tests (all ACs)**
  - [x] Backend: `test_authors.py` (join/split round-trip, blanks/whitespace dropped, `None`/empty); `test_models.py` (the two validators: list→derived join via `mode="after"`; legacy string with NO `authors_list` key→derived list via `mode="before"`; a record WITH `authors_list=[]` + a stale `authors` string does NOT resurrect (the clear case); `CollectionRow.authors_list` default; `DocPatch.authors_list` accepted, old `authors` string 422s under `extra="forbid"`); storage (`_cache_from_meta` projects `authors_list`; `update_meta_and_reindex` re-derives `authors` on a `authors_list` update AND a clear yields `authors=None` without resurrecting; `apply_extraction`/`update_doc_meta` round-trip a list; reconcile backfills); route (`patch_doc` with `authors_list` normalizes + persists + returns the derived `authors`; extraction settles a multi-author list).
  - [x] Client: `tableView.test.ts` (`applyTagFilter` set-membership: matches contains-author, excludes non-match, null = no-op, no mutation; `cellType` present on Author); `useTableView.test.ts` (filter folds before sort; `setAuthorFilter` narrows `applyTableView`); `TagCell`/`PaperRow` tests (chips render from `authors_list`; a chip click fires `onFilterByAuthor` and does NOT arm/edit; an armed cell shows the editor; add appends + remove drops + commit sends the full list); `LibraryPage.test.tsx` (clicking a chip narrows the rendered rows + count, the clear affordance restores; keep `getLibrary`/`patchDoc` mocked, touch no `render/` barrel); back-compat (a row with only a joined `authors` string still shows chips once the model derives the list, exercised via a fixture).
  - [x] `no-raw-values.test.ts` stays green; grep every new UI string for `—` (em-dash) before committing (AC-7).

- [x] **Task 10, Version, live smoke, review, done (all ACs)**
  - [x] Bump `[project].version` in `server/pyproject.toml` `0.5.9` → `0.5.10` and sync `server/uv.lock`'s `paper-mate-server` version; `cd server && uv lock --check` clean.
  - [x] `cd client && npm run typecheck && npm test` green; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green on the host (this story DOES change backend logic + contract, so the backend suite matters, run it yourself per the CLAUDE.md Sandbox note).
  - [x] **Live smoke on your OWN fresh servers** (never a user-launched one): fresh `uvicorn` + `vite dev` on alternate ports against a scratch `PAPER_MATE_DATA`. Import at least two multi-author PDFs. Verify: (1) the Author cell shows one chip per author (AC-3); (2) arm a row, add an author + remove a chip, it persists across a page reload (AC-4); (3) click an author chip, the table narrows to rows containing that author, the count updates, the clear "×" restores all rows (AC-5); (4) a paper whose `meta.json` has only a legacy joined `authors` string still renders chips (AC-6, seed one by hand or from a pre-7.11 fixture); (5) sort + hide + reorder (7.10) still work with the tag cell. Tear both servers down after.
  - [x] **Cross-model Codex `bmad-code-review` (AE-6)** on the diff. Resolve High/Med before done. This story changes the contract + backend, so also confirm the OpenAPI/`schema.d.ts` regen is committed and `docs/API.md` matches.
  - [ ] Branch `story-7-11-author-tag-column` off `main` before implementing (already cut at create-story, [x]). At PR merge, flip `sprint-status.yaml` `7-11-author-tag-column` → `done` (AE3-1) with the Dev Agent Record filled first (AE3-2). **Do NOT close Epic 7**: 7.12 (the structural refactor, now the last story) remains backlog.

### Review Findings

All High/Med findings resolved; both suites re-verified green after fixes (server: 290 passed; client: 1380 passed, typecheck clean).

- [x] [Review][High] `PATCH authors_list: null` is accepted by the contract but mishandled [server/app/models.py:150] — Fixed: the `mode="before"` legacy-heal validator now keys off `"authors_list" not in data` (key ABSENCE) instead of `data.get(...) is None`, so an explicit `null` is no longer conflated with a legacy pre-7.11 read and can never resurrect a stale `authors` string; it now fails `authors_list`'s own `list[str]` field validation instead. That `ValidationError` is caught in `update_meta_and_reindex` and re-raised as `CorruptMetadataError` so it still answers the single `{ detail }` envelope (AR-11) rather than an unhandled 500. New tests: `test_doc_meta_explicit_none_authors_list_key_present_rejected_not_healed`, `test_patch_doc_explicit_null_authors_list_returns_500_envelope_not_resurrect`.
- [x] [Review][High] Author filtering leaves hidden rows selected, so toolbar actions can affect invisible papers [client/src/library/LibraryPage.tsx:154] — Fixed: added `handleAuthorFilterChange`, mirroring the existing folder-switch `handleSelect` precedent, clearing `selectedIds` on every author-filter change (chip click or clear). New test: `LibraryPage.test.tsx` "clicking an author chip clears the current selection".
- [x] [Review][Med] Tag-editor blur commits do not suppress the click that caused the blur [client/src/library/CollectionTable/CollectionTable.tsx:863] — Fixed: `commitAuthors` now unconditionally sets `suppressClickRef.current = true` (every `TagEditor` commit is inherently a blur-commit, unlike the string-field editors' conditional `viaBlur`). New test: `CollectionTable.test.tsx` "the click that blurs the tag editor closed does not also toggle row selection".
- [x] [Review][Med] TagEditor remove buttons are effectively mouse-only because input blur commits first [client/src/library/CollectionTable/TagEditor.tsx:65] — Fixed: the blur-commit handler moved from the `<input>` to the `.tag-editor` container, gated on `relatedTarget` (only commits once focus truly leaves the editor, not when it moves to a sibling remove button); kept the existing `onMouseDown preventDefault` on remove buttons for the mouse path. New test: `TagCell.test.tsx` "Tab-focus moving from the input to a remove button does NOT commit".
- [x] [Review][Med] Author edit cell is keyboard-focusable but has no visible focus cue [client/src/library/CollectionTable/CollectionTable.css:495] — Fixed: split the old combined Title/Authors `:focus`/`:focus-visible` outline-suppression rule; Authors keeps `:focus` suppressed (mouse-click case, preserves the documented Chromium stray-keydown workaround) but now gets a real `:focus-visible` ring (Title untouched, out of this story's scope).
- [x] [Review][Med] Author tag rendering is still dispatched by `col.key`, not `col.cellType` [client/src/library/CollectionTable/PaperRow.tsx:104] — Fixed: `renderCell` now checks `col.cellType === "tag"` as a guard before the per-key `switch`, matching AC-1's literal "the table dispatches on it" (cellType); the dead `case "authors":` switch arm was removed.
- [x] [Review][Med] `server/openapi.json` required by story/standing contract workflow but absent from the diff [server/openapi.json] — Dismissed (not a bug): `server/openapi.json` is gitignored (`.gitignore:15`) by longstanding repo convention; only the generated `client/src/api/schema.d.ts` is committed (CLAUDE.md "Contract types"). The file was regenerated locally and correctly fed `gen:api` (verified `authors_list` present in both); nothing was missing from the actual contract pipeline.
- [x] [Review][Med] Out-of-scope upload-to-folder behavior is mixed into the Story 7.11 diff [client/src/library/useCollection.ts:82] — Acknowledged: a separate, unrelated fix (drag-drop/file-picker upload while a folder is open landing in Uncategorized) was made mid-session at the user's explicit request. It touches `useCollection.ts`/`useBulkUpload.ts`/`LibraryPage.tsx` and will be committed as its own separate commit, not folded into this story's commit.
- [x] [Review][Low] Untracked smoke screenshot should not be part of the story worktree [smoke-1-chips-added.png] — Fixed: removed.

## Dev Notes

### The contract is the source of truth (do NOT hand-author client types)

`DocMeta`/`CollectionRow`/`DocPatch` (Pydantic) → `server/openapi.json` → `client/src/api/schema.d.ts` (generated) → `client/src/api/client.ts` re-exports. After ANY model edit: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. Commit both. Never edit `schema.d.ts` by hand (AR-3/AD-3, CLAUDE.md). `docs/API.md` is the human mirror; update it in the same change (CollectionRow gains `authors_list`; DocPatch swaps `authors`→`authors_list`; the `PATCH /api/docs/{id}` entry + changelog).

### The authors invariant (two validators, one direction each)

`authors_list` is the single authority; `authors` is its derived join. Reconcile with TWO validators (decision 1), never one bidirectional one:

- **`mode="before"` (legacy heal, read-time):** if the RAW input's `authors_list` KEY is absent/None and `authors` is present → inject `authors_list = split_authors(authors)`.
- **`mode="after"` (forward derive, always):** `authors = join_authors(self.authors_list)`. Single writer of the string.

This self-heals old `meta.json` on read with no migration and no `schema_version` bump (decision 1/3). The delimiter (`", "`) lives ONLY in `server/app/authors.py` (Task 1), imported by the model, the extraction route, and the PATCH route, never re-spelled.

### The model_copy write-path trap (READ THIS, it is the backend correctness crux)

Two DocMeta construction paths behave differently:

- **Read** (`meta_store.read`, `:33`) uses `DocMeta.model_validate(payload)` → BOTH validators run → legacy self-heal + forward derive both happen. AC-6 works on read for free.
- **Write** (`update_meta_and_reindex`, `library_index.py:447`) uses `current.model_copy(update=updates)`. **Pydantic v2 `model_copy` does NOT re-run validators.** So a `{authors_list: [...]}` update sets the list but leaves the DERIVED `authors` string STALE. This is a silent data-consistency bug: the cache and the table would show the old joined authors.

Fix by making the write path re-validate (recommended, single invariant):

```python
updated = DocMeta.model_validate({**current.model_dump(), **updates})
```

instead of `current.model_copy(update=updates)`. Because `current.model_dump()` always emits the `authors_list` key, the `mode="before"` heal does NOT fire on this path, so an explicit clear (`authors_list=[]`) correctly derives `authors=None` and does NOT resurrect from the stale string. Re-validation is idempotent for the other callers (`touch_last_opened`, title/venue/year), whose `current` already validated on read. Confirm the existing meta round-trip tests stay green (this is a stricter, more-correct write path).

*(Lower-blast-radius alternative if re-validating the shared core feels too broad: keep `model_copy` and have `update_doc_meta`/`apply_extraction` pre-derive `authors` into the `updates` dict via `join_authors` whenever they set `authors_list`. Pick one; the re-validate approach keeps the invariant in ONE place and cannot be forgotten by a future caller.)*

### The chip-click vs cell-arm interaction (the client trap)

The Author cell must do three things on click depending on state, without overloading one handler ambiguously. Follow the EXISTING precedent already in `PaperRow`: the Open button and the DOI link both live inside cells and `stopPropagation` for their own action while a plain cell click bubbles up to arm the row.

- **Chip click (any state):** `stopPropagation` → `onFilterByAuthor(author)`. A chip is a filter trigger, never an arm/edit.
- **Cell background click, UNARMED:** bubbles to the `<tr>` → arms the row (exactly like `EditableCell`'s unarmed path, `EditableCell.tsx:128`).
- **Cell background click, ARMED (lone selection):** opens the tag editor (add input + per-chip remove), mirroring `EditableCell`'s armed→edit path.

Test this explicitly (Task 9): a chip click must NOT arm or open the editor, and must NOT trigger a row selection. This is the single most likely place to ship an interaction bug (compare the 7.10 "cell-order trap" and the `icon-button-swallowed-by-exempt-check` memory: clicks inside cells need deliberate propagation control).

### Reuse the optimistic edit machine, do not reinvent it

`useInlineEdit` already gives you optimistic `setLibrary` + revert-on-failure + `editSeq` (last-writer-wins) for the title/venue/year edits (`useInlineEdit.ts`). The authors-list edit is the same shape with a `string[]` payload and a two-field optimistic write (`authors_list` + derived `authors`). Extend that hook (or a thin sibling) rather than writing a fresh fetch/revert loop (CLAUDE.md: adopt stable solutions; smallest correct structure). The commit is a FULL-LIST replacement, so "never lost" is free.

### The filter is view-state, folded upstream (like sort)

`applyTagFilter` runs in `useTableView.applyTableView`, which `LibraryPage` applies at `visiblePapers` (`LibraryPage.tsx:198`) BEFORE handing `rows` to `CollectionTable`. This keeps the SAME array 7.3's range-select `rows.findIndex` indexes (the invariant 7.4's Dev Notes and 7.10 both protect). Do NOT filter inside `CollectionTable`. Filter is ephemeral (AD-L3): no `localStorage`, no route, not in the 7.10 prefs store.

### What changes vs 7.10's ordered-render switch

7.10 turned `PaperRow`/`PendingRow` into an ordered `switch (col.key)` render and explicitly deferred the `cellType` registry to this story (`7-10` Dev Notes: "Your switch is the seam 7.11 formalizes"). This story adds `cellType` to `ColumnDef` and routes the `tag` type through `TagCell`. Keep it minimal: `tag` is the only new dispatch; the bespoke columns (title/doi/location/file_type) keep their per-key markup. Story 7.12 consolidates the whole thing into the canonical descriptor/renderer registry, do NOT pre-build that here.

### What does NOT change

- **Sort behavior.** `sortKey` for `authors` still reads the derived `authors` string (`tableView.ts:79`); no per-author sort. The derived string is exactly why we keep it (decision 1).
- **`schema_version`.** Stays `1`. Additive `authors_list` + self-heal-on-read only (decisions 1/3).
- **7.10's persisted layout** (order/visibility/widths). Untouched. The tag filter and author edits are not persisted.
- **The `library.json` sole-writer invariant** (AL-7): storage still owns every write; the client only PATCHes through the route.

### Testing standards

- Backend: pytest, run on the host per the CLAUDE.md Sandbox note (`PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`). This story changes backend logic + contract, so backend tests are first-class (unlike 7.10). Include a contract/round-trip test for the model validator both directions.
- Client: Vitest + Testing Library (`render`, `renderHook`/`act`), same as `useTableView.test.ts`/`CollectionTable.test.tsx`. The chip-click-vs-arm test (Dev Notes) and the set-membership `applyTagFilter` test are the highest-value new cases.
- **Live-smoke the tag/edit/filter + back-compat** on your OWN fresh servers; no DPR>1 gate (no coordinate/anchor geometry here).

### Project Structure Notes

- **`server/app/authors.py`** is a NEW pure leaf (join/split/delimiter). It must have NO dependency on `domain` or `storage` (storage imports it, and storage "imports nothing from `domain`", `documents.py:131`), so a neutral top-level `app/` leaf is the right home, imported by `models.py`, `routes/extraction.py`, `routes/docs.py`.
- **Client tag components** live under `client/src/library/CollectionTable/` beside `EditableCell.tsx`/`PaperRow.tsx` (scaffold-react colocation). The filter view-state stays in `tableView.ts`/`useTableView.ts` beside `sort` (AD-L3 client view-state layer).
- Naming: `TagCell.tsx` / `TagEditor.tsx`; token prefix `--tag-chip-*` (generic, since a future non-author `tag` column reuses it) or `--author-tag-*` (pick one, colocate). Follow neighbors.

### References

- Epic + ACs: `.bmad/planning-artifacts/epics.md#Story 7.11` (lines 1839-1869).
- Source change proposal: `.bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-08-table-columns.md`.
- Previous story (cell-type seam origin, ordered render): `.bmad/implementation-artifacts/epic-7/7-10-reorder-columns-persisted.md`.
- Filter-control removal (decision 4): `.bmad/implementation-artifacts/epic-7/7-4-display-sort-filter-controls.md` (Descope note, 2026-07-06).
- Authors flatten point: `server/app/routes/extraction.py:34`; storage claim: `server/app/storage/documents.py:126-132`.
- Models: `server/app/models.py` (`ExtractedMeta:34`, `DocMeta:59`, `DocPatch:95`, `CollectionRow:194`).
- Storage: `server/app/storage/library_index.py` (`_cache_from_meta:90`, `update_meta_and_reindex`), `documents.py` (`apply_extraction:116`, `update_doc_meta:146`).
- PATCH route: `server/app/routes/docs.py:85`.
- Client edit path: `client/src/library/useInlineEdit.ts`, `client/src/library/row.ts` (`EditableField:5`), `client/src/library/CollectionTable/EditableCell.tsx`.
- Client table + rows: `client/src/library/CollectionTable/CollectionTable.tsx`, `PaperRow.tsx` (`renderCell:91`), `PendingRow.tsx`, `CollectionTable.css` (`badge-pill:455`).
- Column model + fold: `client/src/library/tableView.ts` (`ColumnDef:11`, `COLUMNS:37`, `sortKey:72`), `useTableView.ts` (`applyTableView:38`), `LibraryPage.tsx` (`visiblePapers:198`, count line `:317`).
- Contract regen: CLAUDE.md "Contract types" + AR-3/AD-3; `docs/API.md`.
- Design tokens: `DESIGN.md`; `client/src/theme/components.css`; `no-raw-values.test.ts`.
- Standing conventions: `CLAUDE.md` (adopt stable solutions; no em-dash in UI; smallest correct structure; launch your OWN dev servers; versioning PATCH +1 → 0.5.10; branch-per-story; update `sprint-status.yaml` at merge; fill the Dev Agent Record before done). Memory: `no-emdash-user-facing`, `prefer-stable-solutions`, `icon-button-swallowed-by-exempt-check` (click-propagation in cells).

## Dev Agent Record

### Agent Model Used

Sonnet 5 (xHigh), with a forked subagent (same model) handling test-fixture patching (`authors_list` additions across pre-existing client test files) and independently converging on `TagCell.tsx`/`TagEditor.tsx`/`useAuthorsEdit.ts`/token additions in parallel; both streams reconciled into one coherent diff.

### Debug Log References

- Full backend suite: 288 passed (`cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`).
- Full client suite: 1377 passed, typecheck clean (`cd client && npm run typecheck && npm test -- --run`). One transient flaky failure under full-suite parallel load reproduced as a pass in isolation and on rerun (not a real defect).
- `no-raw-values.test.ts`: 111 passed (new chip/editor/pill CSS is token-only).
- Live smoke on fresh servers (port 8123 backend / 5183 frontend, scratch `PAPER_MATE_DATA`): imported 2 PDFs, added/removed author chips via the tag editor, confirmed persistence across reload, confirmed chip-click filter + clear, hand-edited one `meta.json` to a legacy (no `authors_list` key) shape and confirmed the boot-time `reconcile_library()` self-heal renders chips with no migration step (AC-6), confirmed Sort/Hide/column-resize (Story 7.10) still work with the tag cell present.

### Completion Notes List

- Full-stack, contract-changing story landed end-to-end: `authors_list: list[str]` is now the authoritative field from `ExtractedMeta` through `DocMeta`/`CollectionRow`/`DocPatch` to the client; `authors` (the joined display string) is always derived, never independently authored (two Pydantic validators: `mode="before"` legacy heal, `mode="after"` forward derive).
- Fixed the `model_copy` write-path trap in `update_meta_and_reindex`: it now re-validates (`DocMeta.model_validate({**current.model_dump(), **updates})`) instead of `model_copy`, so an `authors_list` update always re-derives `authors`, and an explicit clear (`authors_list=[]`) never resurrects a stale joined string.
- Client: `cellType` seam added to `ColumnDef` (Author is the only `tag` column this story); `TagCell`/`TagEditor` implement the chip-click-vs-arm-vs-edit three-way interaction from the Dev Notes; `useAuthorsEdit` is a full-list-replacement sibling to `useInlineEdit`; `authorFilter` is ephemeral view-state folded into `useTableView.applyTableView` before sort.
- Out-of-scope items were NOT built, per the story's own scope boundary: no per-value chip colors, no `tag` cellType on any column besides Author, no general tag-management surface, no `FilterMenu` rebuild, no `schema_version` bump.
- A separate, unrelated bug fix (drag-drop/file-picker upload while a folder is open landing in Uncategorized instead of that folder) was made mid-session at the user's request; it touches `useCollection.ts`/`useBulkUpload.ts`/`LibraryPage.tsx` and is NOT part of this story's scope or File List below (tracked/tested separately, will be committed separately).
- **2026-07-11 (post-review fix requests):** Two follow-up fixes landed on this branch before merge:
  1. **Row divider misalignment.** `.collection-table__title`/`.collection-table__location` set `display: flex` directly on the `<td>`, which opts a table cell out of the table's per-row height-stretch (only a real `display: table-cell` box participates); whenever another cell in the row (a wrapped Author chip list) grew the row taller, these two columns' `border-bottom` stayed short, staggering the divider line. Fixed by moving the flex layout onto an inner wrapper `<div>` and leaving the `<td>` itself a plain table-cell.
  2. **AC-5 reversed: the click-to-filter-by-author affordance was removed**, per explicit user fix request ("it makes it hard to edit Authors"). `onFilterByAuthor`/`authorFilter`/`applyTagFilter` and the toolbar filter pill are deleted client-side (`tableView.ts`, `useTableView.ts`, `LibraryPage.tsx`, `CollectionTable.tsx`, `PaperRow.tsx`, `TagCell.tsx` + their tests); chips are now plain, non-interactive `<span>`s. AC-5 as written in this story is superseded - Author chips no longer filter, a cell click always arms/edits like every other column. A follow-up fix then handled overflow: `AuthorChips` (`TagCell.tsx`) measures chip widths in a `useLayoutEffect` and shows only what fits on one line plus a trailing "et al." (replacing the earlier wrap-then-clip layout, which left a sliver of a clipped 2nd-row chip visible).
  3. Both fixes live-smoked on fresh scratch servers against the user's real `~/.paper-mate` library (multi-author real papers, not synthetic fixtures): confirmed zero row-bottom spread across every row, confirmed chip-click no longer filters (row count unchanged, chip click just arms the row), confirmed column drag-resize correctly reveals/hides chips + `et al.` live.
- **2026-07-11:** PR #61 merged to `main` (`1791c0e`, squash, includes both post-review fixes above). Status set to done.

### File List

- `server/app/authors.py` (new)
- `server/tests/test_authors.py` (new)
- `server/app/models.py`
- `server/app/storage/library_index.py`
- `server/app/storage/documents.py`
- `server/app/routes/extraction.py`
- `server/app/routes/docs.py`
- `server/openapi.json`
- `client/src/api/schema.d.ts`
- `docs/API.md`
- `server/tests/test_models.py`
- `server/tests/test_storage.py`
- `server/tests/test_docs.py`
- `server/tests/test_openapi.py`
- `client/src/library/tableView.ts`
- `client/src/library/useTableView.ts`
- `client/src/library/CollectionTable/TagCell.tsx` (new)
- `client/src/library/CollectionTable/TagEditor.tsx` (new)
- `client/src/library/CollectionTable/PaperRow.tsx`
- `client/src/library/CollectionTable/CollectionTable.tsx`
- `client/src/library/CollectionTable/EditableCell.tsx`
- `client/src/library/useAuthorsEdit.ts` (new)
- `client/src/library/row.ts`
- `client/src/library/LibraryPage.tsx`
- `client/src/library/LibraryPage.css`
- `client/src/library/CollectionTable/CollectionTable.css`
- `client/src/theme/components.css`
- `client/src/library/tableView.test.ts`
- `client/src/library/useTableView.test.ts`
- `client/src/library/CollectionTable/TagCell.test.tsx` (new)
- `client/src/library/useAuthorsEdit.test.ts` (new)
- `client/src/library/CollectionTable/CollectionTable.test.tsx`
- `client/src/library/LibraryPage.test.tsx`
- `client/src/components/Reader/Reader.test.tsx`
- `client/src/reader/ReaderPage.test.tsx`
- `client/src/reader/ReaderPage.pageNav.test.tsx`
- `client/src/library/folderFilter.test.ts`
- `client/src/library/useBulkUpload.test.ts`
- `client/src/library/useInlineEdit.test.ts`
- `client/src/library/useMovePapers.test.ts`
- `client/src/library/useStarPapers.test.ts`
- `client/src/library/useTrashPapers.test.ts`
- `server/pyproject.toml` (version bump 0.5.9 -> 0.5.10)
- `server/uv.lock` (version sync)
