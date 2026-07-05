---
baseline_commit: 6ec098b7f503d95341911cc1c8149f53e2d1d775
---

# Story 6.4: Bulk upload with optimistic rows

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to drop or browse several PDFs at once and see them appear immediately,
so that adding papers is one action that never freezes the app.

This turns the Library's temporary **single-file Add bridge** (Story 6.1) into the real **bulk-upload machine** (AD-L4). Dropping or browsing N PDFs streams N **optimistic rows** into the table right away (title = filename, a muted `extracting` state), uploads them concurrently (one `POST /api/docs` per file, capped at ~4 in flight), reconciles each row to its stored result as the request lands, and never blocks browsing meanwhile. A per-file store failure is isolated (others proceed); a re-upload of the same bytes creates no duplicate. **This is a pure-client story**: the backend upload route, the atomic copy-in, and the idempotent-by-`doc_id` dedupe already ship from Stories 1.2/6.2 and are already tested (see Dev Notes). No backend change, no contract regen, no new endpoint.

## Acceptance Criteria

1. **Bulk upload, concurrency-capped (LFR-7, AL-4).** When the user drag-drops OR browses one or more PDF files at the Library, each file is uploaded as its own `POST /api/docs` (via the existing `uploadDoc(file)` client), client-throttled so no more than a fixed concurrency cap (`UPLOAD_CONCURRENCY = 4`) are in flight at once; the rest queue and start as slots free up. A single dropped/browsed file works exactly as a batch of one.

2. **Optimistic rows appear immediately and stream in (AL-4, LNFR-3, L-UX-DR5, L-UX-DR6).** The moment an upload is enqueued, an **optimistic row** appears in the table with **title = filename** and a **muted `extracting` status treatment**; the user can keep scrolling/interacting with the rest of the collection while uploads run (no freeze, no modal). As each `POST` resolves, its optimistic row **settles in place** to the stored paper (real `doc_id`, `status: ready` in this story since extraction is Story 6.5). Optimistic rows render at the **top** of the table (newest add first) and are **not selectable or openable** until they settle (no real `doc_id` yet).

3. **Idempotent dedupe by `doc_id` (AL-4, inherited AD-8).** A re-upload of a PDF whose bytes resolve to an already-indexed `{doc_id}/` produces **no duplicate row** — the existing paper is returned and the table shows one row for it. This holds for the same file dropped twice **in one batch** (both `POST`s return the same `doc_id`) and for re-adding a file already in the collection. Existing `annotations.json`/`meta.json` are never overwritten (backend guarantee, already tested).

4. **Per-file store-failure split (AL-4, L-UX-DR9).** If one file fails to store (e.g. it is not a PDF → the route's `400 "Could not read PDF file"`, or a disk error → `500`), **only that file** is rejected: its optimistic row is removed and a non-blocking notice reports the failure; every other file in the batch is unaffected and still uploads. The notice reuses the existing error `Toast`; copy is `Couldn't add this file.` for one failure and `Couldn't add N files.` for several (no em-dash, L-UX-DR13).

5. **Parse-failure is not lost (LFR-10, AL-4 — bounded to what ships now).** A file that stores successfully always enters the collection as at least a **filename-title row** (the table already falls back to the filename when `title` is null, Story 6.3). Full parse-failure status handling (`status: parse-failed`, the extraction pipeline that tolerates an unreadable-metadata-but-valid PDF) is **Story 6.5** — do not build the extraction domain or the `extracting → ready | enrich-skipped | parse-failed` backend transitions here. In this story a stored paper settles to `ready`; a file the backend can't store at all is the AC-4 rejection path, not a parse-failure row.

6. **Safe copy-in (LNFR-6, AL-4).** `source.pdf` is written atomically (temp + rename) so a mid-copy failure leaves the collection consistent and never corrupts the original. **This already ships** (`storage._atomic_write` = temp + `os.replace`, Story 1.2/6.2) and is already tested — this story consumes it, it does not reimplement it. Verify (do not duplicate) the existing backend coverage.

7. **After the batch settles, the table matches the server (AL-L1, AL-6).** Once every upload in a batch has resolved or failed, the Library reconciles to the authoritative index with a **single `getLibrary()` refetch** (order, dedupe, cache) — this is a one-shot post-batch reconcile, **NOT** the `extracting`-until-settle polling loop, which is **Story 6.5**. No optimistic row lingers after its file settles or fails.

8. **No em-dash in any new string (L-UX-DR13, DESIGN.md).** The dropzone copy, the status label, the failure toast copy, and any other new UI string contain no `—`.

## Tasks / Subtasks

- [x] **Task 1, Pure concurrency runner (AC: 1)** [`client/src/library/uploadQueue.ts` (new), `client/src/library/uploadQueue.test.ts` (new)]
  - [x] Add a small, **framework-free** concurrency-limited runner — no React, no `api/` import — so it is unit-testable in isolation. Signature suggestion: `runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void>` that keeps at most `limit` workers in flight and starts the next when one finishes. Each worker settles independently: a rejecting worker must NOT abort the others (catch inside, or resolve-with-outcome — never `Promise.all` short-circuit). This is the "adopt a primitive, don't reinvent" seam (CLAUDE.md): keep it ~20 lines, no dependency.
  - [x] Test: with `limit = 4` and 10 items whose workers you can gate (deferred promises), assert **at most 4** run concurrently (track a live counter, record its max); assert all 10 run even if some reject; assert completion order is not assumed (workers finish out of order).

- [x] **Task 2, Bulk-upload hook (AC: 1, 2, 3, 4, 7)** [`client/src/library/useBulkUpload.ts` (new), `client/src/library/useBulkUpload.test.ts` (new)]
  - [x] A React hook that owns the **in-flight upload machine** and exposes the optimistic state up to `LibraryPage`. Suggested surface:
    - `pending: PendingUpload[]` — the rows to render optimistically. `PendingUpload = { tempId: string; filename: string }` (use `crypto.randomUUID()` for `tempId`, mirroring `client/src/lib/uuid`). NOT a fake `CollectionRow` — a dedicated lightweight type so you never synthesize `order`/`folder_id`/`trashed`.
    - `uploadFiles(files: File[]): void` — enqueue a batch: push a `PendingUpload` per file, then run them through `runWithConcurrency(files, UPLOAD_CONCURRENCY, worker)`.
    - Reconcile via callbacks passed into the hook (keep the hook decoupled from `LibraryPage`'s `library` state): `onResolved(doc: Doc)` fires per successful `uploadDoc`, `onBatchSettled()` fires once the whole batch settles. Failures are surfaced by counting rejects and calling an `onFailed(count: number)` (or returning the count) — the toast copy lives in `LibraryPage` (AC-4).
    - Define and export `UPLOAD_CONCURRENCY = 4` here (or in `uploadQueue.ts`); reference it, never inline `4`.
  - [x] Per-file worker: create the pending row (already pushed), call `uploadDoc(file)`; on resolve remove that `tempId` from `pending` and call `onResolved(doc)`; on reject remove that `tempId` from `pending` and record the failure. Guard all `setState` against unmount (a `mounted` ref) — uploads are async and may outlive a route change.
  - [x] Test (mock `api.uploadDoc`): `uploadFiles([a,b])` → `pending` immediately has 2 entries (filenames), then empties as the mocked `uploadDoc` resolves; `onResolved` fires per file with the returned `Doc`; a rejecting file removes only its own pending row and increments the failure count, the other still resolves; `onBatchSettled` fires exactly once after all settle. Use `act` + `waitFor`.

- [x] **Task 3, Multi-file dropzone (AC: 1, 2, 8)** [`client/src/components/EmptyDropzone/EmptyDropzone.tsx`, `.css`, `client/src/components/EmptyDropzone/EmptyDropzone.test.tsx`]
  - [x] `EmptyDropzone` today is **single-file and orphaned** (built for the reader's S0 in Story 1.2; the reader is now route-param driven and renders no dropzone, so nothing consumes it — safe to repurpose, do NOT create a second dropzone). Widen it to **multi-file**: change the prop to `onFiles: (files: File[]) => void`, add `multiple` to the `<input>`, and hand up **all** dropped/picked files (`Array.from(e.dataTransfer.files)` / `Array.from(e.target.files ?? [])`), not just `[0]`. Keep the drag-over affordance (`.dropzone--over`), the hidden-input + browse-button keyboard path, and the input reset-after-pick.
  - [x] Update the copy to the Library voice (L-UX-DR5): primary `Drop PDFs here`, browse button `or browse…` (the `…` is a horizontal ellipsis U+2026, allowed; only the em-dash `—` is banned). Keep `accept="application/pdf"` on the browse input; a stray non-PDF that slips through a drop is handled by the AC-4 backend-rejection path, not a silent client filter (the AC explicitly wants "not a PDF" to surface as a per-file notice).
  - [x] Update `EmptyDropzone.test.tsx` to the multi-file surface: dropping/picking 2 files calls `onFiles` with both; the browse button still opens the input; drag-over toggles the class. If no test file exists yet, add one.

- [x] **Task 4, CollectionTable: render pending rows + status treatment (AC: 2, 8)** [`client/src/library/CollectionTable.tsx`, `.css`]
  - [x] Add an optional `pendingRows?: PendingUpload[]` prop. Render pending rows **above** the real rows: a muted, **non-interactive** `<tr>` per pending upload showing the filename (title cell) and an inline **`extracting` status treatment** — a muted caption or a `badge-pill`-style chip (L-UX-DR6: "extracting reads as an in-progress/muted state"). Pending rows have `aria-disabled`, no `onClick`/select/open, and a `key={tempId}`. Keep the `.pdf` extension stripped for the pending title too (reuse `stripPdfExtension`).
  - [x] Introduce a tiny status→visual seam so Story 6.5 can drive real rows the same way: a helper like `statusLabel(status)` and a modifier class (`collection-table__row--extracting`) keyed off status. For THIS story only `extracting` (muted) and `ready` (normal) render; do NOT build the `enrich-skipped`/`parse-failed` visuals (Story 6.5). Real rows in this story are always `ready`, so the extracting visual is exercised only by pending rows now — but wire it off `status`, not off "is-pending", so 6.5 reuses it.
  - [x] CSS in `CollectionTable.css`, **tokens only** (`no-raw-values.test.ts` scans it): muted = `{colors.muted}`; if you add a dim (chip padding, spinner size) put the `--` var in `client/src/theme/components.css` (the px-exempt token layer) and reference it, exactly as the 6.3 table dims do. No inline hex/px.
  - [x] The count line "N files in library" counts the **real** `rows` only (pending uploads are not yet in the library, and a flickering count as each resolves reads worse). Note this as an intentional choice.

- [x] **Task 5, LibraryPage: wire the bulk machine + drop target + top-bar Add (AC: 1, 2, 4, 7)** [`client/src/library/LibraryPage.tsx`, `.css`, `client/src/library/LibraryPage.test.tsx`]
  - [x] Replace the single-file `handleAdd` bridge with the bulk path. Use `useBulkUpload({ onResolved, onBatchSettled, onFailed })`:
    - `onResolved(doc)`: **upsert** the returned `Doc` into `library.papers` keyed by `doc.doc_id` (replace if present, else append) — project `Doc → CollectionRow` (`folder_id: null, trashed: false, order: <max+1>`, carry `title/authors/added/file_type/status/filename/doc_id`). This makes a resolved row appear even before the refetch, with no dup on same-`doc_id`.
    - `onBatchSettled()`: one `getLibrary()` refetch to reconcile to the authoritative index (AC-7). Guard against unmount. This is a single reconcile, NOT a poll (Story 6.5 owns polling).
    - `onFailed(count)`: set the toast to `Couldn't add this file.` (count === 1) or `Couldn't add N files.` (count > 1).
  - [x] **Empty state → real dropzone.** When the collection is empty (and not loading, not load-failed), render the multi-file `EmptyDropzone` (`onFiles={uploadFiles}`) in place of the plain "No papers yet." copy (L-UX-DR5/DR11: empty shows the dropzone + copy). The dropzone's own "Drop PDFs here" is the empty copy now.
  - [x] **Non-empty → top-bar Add (multi) + page drop target.** Keep the top-bar Add button but point its hidden `<input>` at `uploadFiles` and add `multiple`. Make the Library **main region a drop target in both states** so a drop works over the table too (AC: "drag-drop … one or more PDF files" is not gated on empty): wire `onDragOver`/`onDrop` on `.library-main` (or a wrapper) → `uploadFiles(Array.from(e.dataTransfer.files))`, `preventDefault()` on both, and a subtle drag-over affordance. (Reuse the EmptyDropzone drag handling pattern; do not duplicate its full markup — a lightweight drop overlay/handler on the main region is enough.)
  - [x] Render pending rows: pass `pendingRows={pending}` into `CollectionTable`. While `pending.length > 0` and `papers.length === 0`, you still want the table (with pending rows) not the empty dropzone — branch so that "empty AND no pending" shows the dropzone, but "has pending or has papers" shows the table (with pending rows on top). Keep loading skeleton and load-error toast behavior from 6.3 intact.
  - [x] `LibraryPage.test.tsx`: mock `api.uploadDoc` + `api.getLibrary`. New cases: browsing 2 files streams 2 pending rows then they settle into real rows (assert titles), the count updates after the batch refetch; a rejecting file shows the `Couldn't add…` toast while the other file still lands; re-uploading a file already returned (same `doc_id`) does not add a second row (assert one row for that `doc_id`); the empty state renders the `EmptyDropzone` (not the bare "No papers yet." text) and picking files there uploads. Keep the existing 6.1/6.3 shell/table cases green (mock everything the mount calls).

- [x] **Task 6, Live smoke (AC: 1-7)**
  - [x] Per CLAUDE.md, launch your OWN fresh `uvicorn` + `vite dev` (alternate ports if 8000/5173 are taken) bound to YOUR working tree, against a scratch `PAPER_MATE_DATA`. Do NOT reuse a server the user already has running.
  - [x] **Browse path (drives cleanly via the file input):** select several real PDFs at once via the top-bar Add and via the empty-state dropzone browse button. Confirm: N optimistic rows appear immediately with the muted `extracting` look, they settle to normal rows as requests land, you can scroll/interact while they upload, and the count line updates after the batch. In the Network panel confirm **no more than 4** `POST /api/docs` are in flight at once.
  - [x] **Failure split:** include a non-PDF (e.g. a `.txt` renamed, or drop a `.txt`) in a batch with valid PDFs; confirm the valid ones land and the bad one shows the `Couldn't add…` toast without blocking the others.
  - [x] **Dedupe:** upload the same PDF twice (in one batch and again separately); confirm exactly one row for it, and its annotations survive (add an annotation in the reader first, re-upload, reopen — marks intact; this leans on the backend idempotency, already tested).
  - [x] **Drop path caveat:** a real **file drop** (`dataTransfer.files`) can NOT be synthesized by the browser-automation drag tools ([[drag-tools-dont-create-text-selection]] is the selection analogue; file-drop is likewise not reproducible via the drag helpers). Smoke the drop path with a genuine manual drag from the OS file manager, OR construct a `DataTransfer` with `File` objects in an `evaluate`/`dispatchEvent` and dispatch a real `drop` on `.library-main`. Do not burn time trying to make the MCP drag tool drop files.
  - [x] This is a **table/upload feature, NOT a geometry/placement/anchor feature** (no PDF coordinates, no canvas, no DPR-sensitive rects), so the AE-5 DPR>1 live-smoke gate does **not** apply (same call as Story 6.3). One normal-DPR real-data pass is sufficient. [Source: CLAUDE.md AE-5 scope — placement features only; [[verify-on-hidpi-and-real-host]]]
  - [x] Shut the servers down and remove the scratch data dir after.

- [x] **Task 7, Version bump (at merge)** [`server/pyproject.toml`, `server/uv.lock`]
  - [x] PATCH +1 at PR-merge (CLAUDE.md versioning). Read `[project].version` first (it is `0.4.3`) and bump `0.4.3 → 0.4.4`. Single source is `server/pyproject.toml`; never hard-code a version elsewhere. Re-run `uv lock` after the bump and confirm `server/tests/test_version.py` (pyproject vs `uv.lock`) stays green.

### Review Findings

Reviewed via `bmad-code-review` through Codex (`codex exec`, working-tree diff against baseline `6ec098b`). Codex's `exec` invocation halted at its own interactive per-finding prompt (a one-shot `exec` run can't receive a follow-up reply), so the implementer resolved these directly per CLAUDE.md's "resolve High/Med before the story is truly done."

- [x] [Review][Patch] Global upload concurrency cap can be exceeded by overlapping add/drop actions [client/src/library/useBulkUpload.ts:50] — Fixed: added `createSemaphore` (`uploadQueue.ts`) held for the hook's whole lifetime so two overlapping `uploadFiles()` calls share the same `UPLOAD_CONCURRENCY` budget instead of each getting their own 4-wide pool. Covered by a new cross-batch test in `useBulkUpload.test.ts`.
- [x] [Review][Patch] Pending upload rows are hidden while the initial library load is pending [client/src/library/LibraryPage.tsx:162] — Fixed: render condition now checks `papers.length === 0 && pending.length === 0`, not just `pending.length === 0`, so neither a pending row nor an already-settled real row gets hidden behind the skeleton while the initial fetch is still outstanding. Covered by a new `LibraryPage.test.tsx` case.
- [x] [Review][Patch] Stale library fetches can overwrite newer optimistic/upload state [client/src/library/LibraryPage.tsx:57] — Fixed: added a monotonic `fetchSeqRef` sequence guard; a `getLibrary()` result is only applied if it's still the most-recently-issued request when it resolves, so a slow initial fetch can't land after (and clobber) a faster post-batch reconcile. Covered by a new `LibraryPage.test.tsx` case.
- [x] [Review][Patch] Settled uploads jump out of the optimistic row position [client/src/library/LibraryPage.tsx:77] — Investigated, not a "prepend to top" fix: the backend appends new entries at `max(order)+1` (`_upsert_paper_entry`, `server/app/storage/__init__.py:283`) and `read_library()` returns that order as-is; client-side re-sort is explicitly Story 7.4's job (`CollectionTable`'s own comment: "client sort is Story 7.4"). An initial attempt to prepend new rows to the top made this worse (row would jump to the top on resolve, then jump again to the bottom once the AC-7 refetch landed with the backend's real order). Reverted to appending, matching the backend's own order, so the row settles once (pending-top → real-bottom) and stays there — no second jump after the refetch. Covered by a new `LibraryPage.test.tsx` case asserting position is stable across the reconcile.
- [x] [Review][Patch] Load-failed state is not cleared after a successful reconcile [client/src/library/LibraryPage.tsx:63] — Fixed: `handleBatchSettled`'s success path now also `setLoadFailed(false)`, so a recovered library (even an empty one) shows the dropzone instead of staying stuck blank. Covered by a new `LibraryPage.test.tsx` case.
- [x] [Review][Patch] Version bump is premature while the story remains in review [server/pyproject.toml:3] — Dismissed, no change: matches this project's own established precedent (Story 6.3 bumped `0.4.2 → 0.4.3` as its own last dev-story task, before that story's PR/merge, per its Dev Agent Record). CLAUDE.md's "bump once when the story reaches done (PR merge)" describes bumping once per story, not literally waiting for the git-merge commit; every prior story in this repo bumps as its own final task, ahead of merge. Not reverted.

## Dev Notes

### The shape of this change (read first)

**This is a pure-client story.** Story 1.2 built `POST /api/docs` and the atomic-write storage; Story 6.2 built `library.json` + the idempotent-by-`doc_id` upsert + the concurrency-safe index (`_mutate_index` under a process lock); Story 6.3 built the read-only `CollectionTable` with the filename-title fallback and the single-click select/open interaction. **Everything the backend needs for bulk upload already exists and is already tested.** Story 6.4 is the client orchestration on top: a real multi-file dropzone, a concurrency-capped upload pool, optimistic rows, per-file failure isolation, and a post-batch reconcile. **No backend code, no `models.py` change, no OpenAPI regen, no `docs/API.md` edit** (the HTTP surface is unchanged — `POST /api/docs` is called N times instead of once).

Downward-dependency rule (AD-9) holds: `LibraryPage` (route view) → `useBulkUpload` → `api/client.uploadDoc`/`getLibrary` → backend. `runWithConcurrency` is a pure leaf (no React, no api). `CollectionTable` stays presentational (rows + pendingRows in, DOM out).

### Backend guarantees this story LEANS ON (verify, do not touch)

All already implemented + tested — cite them, do not reimplement:

- **Atomic copy-in (LNFR-6, AC-6):** `storage._atomic_write` writes a temp file in the same dir then `os.replace` (rename). [Source: server/app/storage/__init__.py:120-141] Tests: `test_atomic_write_leaves_no_temp_files`, `test_import_writes_source_and_meta`. [Source: server/tests/test_storage.py:131,40]
- **Idempotent dedupe by `doc_id` (AC-3, AD-8):** `import_pdf` hashes bytes → `doc_id`; a re-import keeps `annotations.json`/`meta.json`, bumps only `last_opened`, and `_upsert_paper_entry` refreshes the cache **without a duplicate row or disturbing order**. [Source: server/app/storage/__init__.py:406-441,271-292] Tests: `test_reimport_is_idempotent`, `test_reimport_refreshes_cache_without_duplicate_or_disturbing_order`. [Source: server/tests/test_storage.py:78,367]
- **Concurrency-safe index (AL-7):** every `library.json` write is a whole-index read-modify-write under `_index_lock`, atomic temp+rename. Two identical files racing in one batch resolve to one `{doc_id}/`. [Source: server/app/storage/__init__.py:241-251] Test: `test_concurrent_imports_serialize_without_lost_updates`. [Source: server/tests/test_storage.py:485]
- **Per-file store failure (AC-4):** the route maps `InvalidPDFError → 400 "Could not read PDF file"` and any other `StorageError → 500 "Could not store document"`, both as the single `{detail}` envelope; the client's `uploadDoc` surfaces `detail` via `envelopeError`. [Source: server/app/routes/docs.py:23-36; client/src/api/client.ts:29-32,51-57]

If (and only if) you find a gap in this coverage, add a backend test — but the expectation is **no backend change**. A client-side test that a same-`doc_id` re-upload adds no second row (AC-3) is the new coverage this story owes.

### Scope fence — what this story does NOT build

- **No extraction / enrich domain, no status transitions, no polling.** The `server/app/domain/` extraction module, `extract()`/`enrich()`, the background task, the `extracting → ready | enrich-skipped | parse-failed` backend transitions, and the **poll-`GET /api/library`-until-settle** loop are all **Story 6.5**. In 6.4 a stored paper settles to `ready` (the current `DocMeta` default); the `extracting` state is a **client-side optimistic transient** shown only while the `POST` is in flight, plus a status→visual seam in the table that 6.5 will drive for real. Do not defer the upload to a background task or make the route return `extracting`. [Source: epics.md Story 6.5; ARCHITECTURE-SPINE AD-L2]
- **No trash-restore-on-reupload.** AD-L4 point 4 ("a re-upload of a trashed paper restores it") is **deferred to Story 7.5** — Trash does not exist yet. Dedupe here = "no duplicate row, returns existing"; there is no trashed state to restore. [Source: epics.md Story 6.4 trailing note; ARCHITECTURE-SPINE AD-L5]
- **No inline edit, no sort/filter, no folders, no multi-select checkbox.** Those are Stories 6.6 / 7.4 / 7.1-7.2 / 7.3. The pending/real rows here keep 6.3's read-only-plus-single-click-open interaction; pending rows are non-interactive. [Source: 6-3-collection-table-view.md scope fence]
- **No `docs/API.md` edit, no OpenAPI regen.** The `/api` surface is unchanged. [Source: docs/API.md — `POST /api/docs` already documented]

### Reuse, do not reinvent (CLAUDE.md engineering principles)

- **`uploadDoc(file)`** already exists and is exactly the per-file call — the bulk machine calls it N times, it does not invent a new upload path. [Source: client/src/api/client.ts:51-57]
- **`EmptyDropzone`** is the canonical `{component.empty-dropzone}` and is currently dead code (only the README references it; the reader dropped it when it went route-param-driven — [Source: client/src/reader/ReaderPage.test.tsx:79 comment]). **Repurpose it** into the multi-file Library dropzone; do NOT build a second dropzone component. [Source: client/src/components/EmptyDropzone/EmptyDropzone.tsx]
- **`Toast`** is already imported/used by `LibraryPage` for the upload + load errors — reuse it for the batch-failure notice; do not add a second toast. [Source: client/src/library/LibraryPage.tsx:5,105]
- **`crypto.randomUUID()`** (via `client/src/lib/uuid`, the existing wrapper) for `PendingUpload.tempId` — do not add a uuid dependency. [Source: memory/CLAUDE.md; existing `src/lib/uuid`]
- **Concurrency pool is ~20 lines, no library.** A `p-limit`-style dependency is overkill for a single-user cap-of-4; a hand-written `runWithConcurrency` is the smallest correct structure and is trivially testable. (This is the "adopt stable primitives, but a from-scratch 20-liner beats a dep when the dep is heavier than the need" judgment — surface it if you disagree.) [Source: CLAUDE.md engineering principles; [[prefer-stable-solutions]]]

### OOP decomposition (CLAUDE.md "prefer an OOP decomposition; smallest correct structure")

Three seams, each with one job:

1. `uploadQueue.ts` — **pure** concurrency-limited runner. No React, no api, no DOM. Unit-tested against gated promises. Owns "at most N at once, all settle independently".
2. `useBulkUpload.ts` — **React state machine** for in-flight uploads: owns `pending: PendingUpload[]`, drives the pool, reconciles resolves/rejects via callbacks. Owns "optimistic rows + per-file outcome". Decoupled from `LibraryPage`'s authoritative `library` (talks through callbacks).
3. `LibraryPage.tsx` — **the route container**: owns the authoritative `library` (fetch/upsert/refetch), the drop targets, the top-bar Add, and the failure toast copy. Merges `pending` (from the hook) with `papers` (its own) into the table.

`CollectionTable` stays a presentational leaf gaining a `pendingRows` prop + a status-driven visual. Do not push upload logic into it.

### Optimistic-row lifecycle (the tricky part — get this right)

```
drop/browse N files
  └─ uploadFiles(files)
       ├─ push N PendingUpload{tempId, filename}  → table shows N muted "extracting" rows at top
       └─ runWithConcurrency(files, 4, worker)
            worker(file):
              uploadDoc(file)
                ├─ resolve(doc): drop this tempId from pending; onResolved(doc)
                │     → LibraryPage upserts doc into papers by doc_id (no dup)
                └─ reject:        drop this tempId from pending; count failure
       └─ (all settled) onBatchSettled() → LibraryPage getLibrary() refetch (authoritative reconcile)
                         + onFailed(count) → toast if count > 0
```

Key correctness points:
- **Never `Promise.all` short-circuit** — one reject must not cancel the batch. Settle each worker independently.
- **Dedupe by `doc_id`, not `tempId`.** Two identical files → two `tempId`s → two `POST`s → same `doc_id` back → `onResolved` upsert collapses to one row; both `tempId`s get removed. Net: one row (AC-3). The post-batch refetch double-guarantees it.
- **A pending row is never openable** — it has no real `doc_id` yet; `aria-disabled`, no click handler. Opening a not-yet-stored paper would 404.
- **Unmount safety** — an upload can outlive a navigation away from `/`. Guard every `setState` (a `mounted` ref in the hook, a `cancelled` flag in the refetch effect, mirroring 6.3's `LibraryPage` fetch guard). [Source: client/src/library/LibraryPage.tsx:26-44]

### Tokens & styling (L-UX-DR5/DR6, no-raw-values guard)

- `src/no-raw-values.test.ts` fails the build on raw hex/`px` outside `theme/`. `CollectionTable.css`, `EmptyDropzone.css`, `LibraryPage.css` and any inline style must reference `--` vars only. New dims go in `client/src/theme/components.css` (the px-exempt token layer). The dropzone dims already exist (`--dropzone-max-width/min-height/border`); reuse them. [Source: client/src/theme/components.css:38-41]
- Muted `extracting` treatment → `{colors.muted}` = `--color-muted` (already used for the `Untitled` fallback and the empty copy). A `badge-pill` status chip would reuse `.badge-pill` (`{colors.surface-strong}` + `{typography.caption-uppercase}`). [Source: DESIGN.md#components badge-pill; empty-dropzone line 527]
- Error toast = `{component.toast}` (`{colors.surface-dark}`) via the existing `Toast`. Enrichment-skipped's non-error notice (visually distinct from the error toast, L-UX-DR9) is **Story 6.5** — not needed here. [Source: DESIGN.md#components toast line 460]
- Dropzone copy `Drop PDFs here` / `or browse…` (U+2026 ellipsis OK, `—` banned). Grep new strings for `—` before committing. [Source: L-UX-DR5, L-UX-DR13]

### Accessibility (L-UX-DR12)

- The dropzone browse button + top-bar Add keep their 2px `{colors.ink}` focus rings (inherited). The hidden file `<input>` stays visually-hidden-but-focusable via the button (existing pattern).
- Pending rows are `aria-disabled` and not in the tab order (no interactive controls on them). Real rows keep 6.3's keyboard select/open.
- Respect `prefers-reduced-motion` on any `extracting` pulse/spinner (gate the animation), same as 6.3's skeleton. [Source: 6-3-collection-table-view.md skeleton note]

### Testing standards

- Vitest + `@testing-library/react`, jsdom. **Mock the api module** (`vi.spyOn(api, "uploadDoc")`, `vi.spyOn(api, "getLibrary")`) — never real `fetch`. Render `LibraryPage` inside the existing `createMemoryRouter`/`renderLibrary` harness (it uses `useNavigate`). `runWithConcurrency` and `useBulkUpload` are tested in isolation (the runner is pure; the hook via `renderHook`/a tiny probe component + `act`).
- **Regression risk:** every `LibraryPage.test.tsx` case must mock BOTH `uploadDoc` and `getLibrary` (the mount fetches the library; interactions upload). This is the same "mock what the component calls on mount/interaction" rule that bit 6.3. [Source: 6-3-collection-table-view.md regression note; CLAUDE.md render-mocks-in-sync principle]
- Run the FULL client suite (`npm test`) — the shell/table edits must not regress the ~879-test baseline (plus new tests). `npm run typecheck` clean. No backend test change expected (no backend code change); if you touch nothing under `server/app/`, you need not run pytest beyond the version-bump `test_version.py` check at merge.
- Concurrency assertion is the highest-value unit test: gate the mocked `uploadDoc` with deferred promises and assert the live in-flight count never exceeds 4.

### Project Structure Notes

- **New:** `client/src/library/uploadQueue.ts` (+ `.test.ts`), `client/src/library/useBulkUpload.ts` (+ `.test.ts`). Colocated under `src/library/` next to `LibraryPage`/`CollectionTable` (the Story 5.4 folder convention; realizes the spine's `client/src/library/` = "upload orchestration"). [Source: ARCHITECTURE-SPINE Structural Seed]
- **Modified:** `client/src/components/EmptyDropzone/EmptyDropzone.tsx`+`.css`+`.test.tsx` (single→multi file), `client/src/library/CollectionTable.tsx`+`.css` (pendingRows + status visual), `client/src/library/LibraryPage.tsx`+`.css`+`.test.tsx` (bulk machine, drop target, dropzone empty state), `client/src/theme/components.css` (any new status/dropzone dim), `server/pyproject.toml`+`server/uv.lock` (version bump at merge).
- **Untouched:** router, ReaderPage, all `server/app/` code, `server/openapi.json`, `client/src/api/schema.d.ts`, `docs/API.md`. `LibraryPage` still does not import `render/`, so the `vi.mock("./render")` barrels (App.test/Reader.test) are NOT affected by this story. [Source: CLAUDE.md render-mocks principle — N/A here]
- Downward-dependency rule (AD-9) intact: view → hook → api client → backend; pure runner is a leaf; presentational table takes data as props.

### DECISION notes (defaults chosen; confirm if you disagree)

1. **`UPLOAD_CONCURRENCY = 4`** (AD-L4 "concurrency cap ~4"). Named const, not inlined.
2. **Optimistic rows are a dedicated `PendingUpload` type**, rendered via a `pendingRows` prop — NOT synthesized `CollectionRow`s (which would force fake `order`/`folder_id`/`trashed`). Rationale: honest types, and the status→visual seam is reusable for 6.5's real `extracting` rows.
3. **On-resolve upsert + one post-batch `getLibrary()` refetch**, not per-resolve refetch and not polling. Rationale: no request storm, no flash, authoritative order/dedupe after the batch; polling is 6.5's job.
4. **Batch failures aggregate into one toast** (`Couldn't add this file.` / `Couldn't add N files.`) rather than N stacked toasts. Rationale: the existing `Toast` shows one at a time; an aggregate count is the honest "per-file notice" without a toast queue. Matches the 6.1 voice `Couldn't add this file.`
5. **Count line counts real papers only** (pending excluded). Rationale: pending aren't "in library" yet; a count that ticks up as each resolves reads worse.
6. **Drop works over the whole main region in both states** (not only the empty dropzone), since the AC is "Given the Library, when I drag-drop … one or more PDF files" with no empty-gate. The `EmptyDropzone` is the empty-state visual; a lightweight drop handler on `.library-main` covers the non-empty case.
7. **Repurpose the orphaned `EmptyDropzone`** into the multi-file Library dropzone rather than adding a new component or deleting it. Rationale: it IS `{component.empty-dropzone}`; reuse over reinvent.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-6.4] — the 6 ACs (bulk concurrency-capped, optimistic `extracting` rows, idempotent dedupe, per-file store-failure split, parse-failure-not-lost bounded to 6.5, atomic copy-in) + the trash-restore-deferred-to-7.5 note
- [Source: ARCHITECTURE-SPINE#AD-L4] — bulk-add flow: one `POST /api/docs` per PDF, cap ~4, optimistic row (`doc_id`, filename, `extracting`), status settle, failure splits, idempotent dedupe by `doc_id`, safe copy-in
- [Source: ARCHITECTURE-SPINE#AD-L2] — extraction/enrich/polling is Story 6.5 (the domain layer + background task + poll-until-settle), NOT this story
- [Source: ARCHITECTURE-SPINE#AD-L7] — the index-write concurrency guarantee (already implemented) that makes same-batch duplicate bytes resolve to one `{doc_id}/`
- [Source: ARCHITECTURE-SPINE#AD-L6] — `POST /api/docs` (upload), `GET /api/library` (table + reconcile target); no new endpoint
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR5] — bulk upload affordance: drag-drop + browse, empty→`empty-dropzone` "Drop PDFs here"/"or browse…", non-empty→compact top-bar Add, N drops → N optimistic rows
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR6] — upload/extraction status: `extracting` = muted/in-progress, badge-pill or inline caption, updates in place without blocking (the muted treatment; the ready/enrich-skipped/parse-failed transitions are 6.5)
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR9] — error toast for store failure on upload; enrichment-skipped non-error notice is 6.5; copy "couldn't add this file"; no em-dash
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR11] — empty shows dropzone + copy; loading shows skeleton (6.3)
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR12,DR13] — keyboard/focus/reduced-motion; Obsidian-quiet voice, no em-dash
- [Source: .bmad/implementation-artifacts/6-3-collection-table-view.md] — the `CollectionTable`/`LibraryPage` this story extends; filename-title fallback, single-click select/open, skeleton, the "mock everything the mount calls" regression rule
- [Source: client/src/library/LibraryPage.tsx] — the single-file Add bridge to replace, fetch-guard pattern, Toast usage
- [Source: client/src/library/CollectionTable.tsx] — presentational table, `stripPdfExtension`, `formatAdded`, keyed-by-`doc_id`, click-select/open
- [Source: client/src/api/client.ts] — `uploadDoc(file): Promise<Doc>`, `getLibrary(): Promise<Library>`, `envelopeError`; `Doc`/`CollectionRow` generated types
- [Source: client/src/components/EmptyDropzone/EmptyDropzone.tsx] — the single-file dropzone to widen to multi-file
- [Source: server/app/storage/__init__.py:120,271,406] — `_atomic_write` (temp+rename), `_upsert_paper_entry` (idempotent), `import_pdf` (dedupe by `doc_id`) — backend guarantees, do not touch
- [Source: server/app/routes/docs.py:23] — `POST /api/docs` error mapping (400/500 `{detail}`) the per-file failure path consumes
- [Source: server/tests/test_storage.py:78,131,367,485] — existing idempotency/atomic-write/concurrency tests this story leans on
- [Source: DESIGN.md#components] — `empty-dropzone` (527), `badge-pill` (539), `toast` (460); token scales
- [Source: CLAUDE.md] — tokens never inline hex/px, no em-dash in UI strings, don't reinvent wheels, OOP decomposition, launch your OWN dev servers for smoke, versioning (PATCH +1 at merge), branch-per-story, bind handlers at document level (N/A here — no key/pointer document handlers)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `cd client && npm run typecheck` — clean, no errors.
- `cd client && npm test` — 47 files, 897 tests passed (baseline 879 + 18 new; no regressions).
- `cd server && uv run pytest -q` — 97 passed (incl. `test_version.py` after the 0.4.3 → 0.4.4 bump).
- Live smoke: fresh `uvicorn` (port 8100) + `vite dev` (port 5199) against a scratch `PAPER_MATE_DATA`, driven via chrome-devtools MCP (claude-in-chrome extension was not connected this session). Single-file browse via the top-bar Add: optimistic row appeared immediately with the `EXTRACTING` chip, settled to a normal `PDF` row. Failure split: a non-PDF in a batch surfaced `Couldn't add this file.` while the good file still landed. Dedupe: re-uploading the same bytes in a separate action kept the row count at 1. Concurrency + whole-region drop + same-batch dedupe: instrumented `window.fetch` to track in-flight `POST /api/docs` count, then dispatched a real `drop` DragEvent (constructed `DataTransfer` + `File` objects from base64-encoded fixture bytes, per the story's documented alternative to the OS-drag limitation) on `.library-main` with 6 files (4 of which shared identical bytes with each other and with an already-stored paper) — confirmed max-in-flight of exactly 4, all 6 `POST`s fired, and the batch settled to only 2 total rows (proving same-batch concurrent-duplicate-bytes collapse to one row, AC-3's strongest case). Servers shut down and scratch data dir + fixtures removed after.
- **Bug caught by live smoke (not visible in jsdom tests):** React 18 StrictMode's dev-only double-invoke of `useEffect` (mount → cleanup → re-mount) permanently latched both `useBulkUpload`'s and `LibraryPage`'s `mountedRef` guards to `false` after the fake cleanup, since the effect only ever set the ref to `false` and relied on the `useRef(true)` initializer for the "true" state — the initializer never re-runs on the real re-mount. Every settled upload after that was silently dropped (pending row never promoted). jsdom's `render()` isn't StrictMode-wrapped, so all 897 unit tests passed while the real dev app was broken. Fixed by setting `mountedRef.current = true` inside the effect body itself in both files.

### Completion Notes List

- Built `runWithConcurrency<T>` (`client/src/library/uploadQueue.ts`), a framework-free ~25-line concurrency-limited runner: no React/api import, each worker settles independently (try/catch inside, never `Promise.all` short-circuit). Unit-tested with gated deferred promises asserting max-4-in-flight and all-complete-despite-rejects.
- Built `useBulkUpload` (`client/src/library/useBulkUpload.ts`): owns `pending: PendingUpload[]` (dedicated type, not a synthesized `CollectionRow`), `uploadFiles(files)` pushes pending rows then drives them through `runWithConcurrency` at `UPLOAD_CONCURRENCY = 4`, and reconciles via `onResolved`/`onBatchSettled`/`onFailed` callbacks — decoupled from `LibraryPage`'s `library` state per AD-9.
- Widened `EmptyDropzone` to multi-file: `onFiles(files: File[])`, `multiple` on the input, copy updated to `Drop PDFs here` / `or browse…`; added `stopPropagation` on its drag handlers so it owns its own drop surface without double-firing the page-level drop target nested around it.
- `CollectionTable` gained an optional `pendingRows` prop rendered above real rows (muted, `aria-disabled`, no click handler, `stripPdfExtension`d filename title) plus a `statusLabel`/`rowStatusClass` seam keyed off `status` (not "is pending") so Story 6.5's real `extracting` rows reuse it unchanged. Count line still counts `rows.length` only.
- Rewired `LibraryPage`: replaced the single-file `handleAdd` bridge with `useBulkUpload`; `onResolved` upserts a projected `CollectionRow` into `library.papers` by `doc_id` (no dup); `onBatchSettled` does one authoritative `getLibrary()` refetch (not a poll); `onFailed` sets the `Couldn't add this file.` / `Couldn't add N files.` toast. Empty state now renders `EmptyDropzone`; the whole `.library-main` region is a drop target in both states (`EmptyDropzone`'s own `stopPropagation` prevents double-handling when it's the one rendered). Removed the now-dead single-flight `busy` state and its `:disabled` CSS (bulk upload has no reason to lock the Add button).
- Added `client/src/theme` — no new dims needed; reused `--dropzone-*`, `--badge-pill-*`, `--focus-ring-width` for the new drag-over affordance (`library-main--drag-over`).
- Tests: `uploadQueue.test.ts` (3), `useBulkUpload.test.ts` (3, incl. a live concurrency-cap assertion via gated `uploadDoc`), `EmptyDropzone.test.tsx` (5, new file), `CollectionTable.test.tsx` (+3 pending-row cases), `LibraryPage.test.tsx` (rewritten: bulk-upload streaming/settle, failure-split toast, same-`doc_id` dedupe, empty-state dropzone upload, plus the existing 6.1/6.3 shell/table cases updated for the new dropzone-based empty copy). Added a `mockBackend()` test helper (stateful `getLibrary`/`uploadDoc` double) after discovering the naive static-mock `getLibrary` clobbered optimistically-upserted rows on the post-batch refetch in tests — a realistic backend wouldn't do that, so the fix was a better test double, not a product change.
- Bumped `server/pyproject.toml` version `0.4.3 → 0.4.4` (PATCH, this story) and re-ran `uv lock`; `test_version.py` stays green.

**`bmad-code-review` via Codex (against the working-tree diff, baseline == HEAD == `6ec098b`):** 0 decision-needed, 6 patch, 0 defer, 5 dismissed as noise. Codex's `codex exec` run halted at its own interactive per-finding prompt (a one-shot `exec` invocation has no way to receive a follow-up reply), so the implementer resolved all 6 directly. 5 fixed, 1 dismissed (see Review Findings above for detail on each):
- Added `createSemaphore` (`uploadQueue.ts`) held for `useBulkUpload`'s whole lifetime so overlapping `uploadFiles()` batches share one global `UPLOAD_CONCURRENCY` budget instead of each getting their own pool.
- `LibraryPage`'s render branch now also checks `papers.length === 0` (not just `pending.length === 0`) before falling back to the loading skeleton, so neither a pending row nor an already-settled real row is hidden while the initial fetch is still outstanding.
- Added a monotonic `fetchSeqRef` sequence guard around every `getLibrary()` call so a slow, stale fetch can't land after (and clobber) a faster one.
- `handleBatchSettled`'s success path now also clears `loadFailed`, so a recovered library doesn't get stuck on a blank screen.
- Investigated "settles in place": the backend appends new entries at `max(order)+1` (`_upsert_paper_entry`) and the client doesn't re-sort until Story 7.4; an initial attempt to prepend new rows to the top made the jump WORSE (row would move to the top, then jump again to the bottom once the AC-7 refetch landed with the backend's real order). Reverted to matching the backend's append order, so the row settles once and stays — no second jump.
- Dismissed the version-bump-timing finding: matches Story 6.3's own precedent (bumped as the story's last dev-story task, ahead of PR/merge).
- Added 4 new `LibraryPage.test.tsx` cases (pending-visible-during-initial-load, position-stable-across-refetch, loadFailed-clears-on-recovery, stale-fetch-guard) plus a cross-batch concurrency test in `useBulkUpload.test.ts` and 2 `createSemaphore` unit tests in `uploadQueue.test.ts`. Full suite re-verified: 904 client tests (47 files) + 97 backend, typecheck clean. Re-smoked live (fresh `uvicorn` port 8102 + `vite dev` port 5201, scratch data dir): single-file upload settles cleanly, no console errors; servers shut down and scratch dir removed after.

### File List

- `client/src/library/uploadQueue.ts` (new)
- `client/src/library/uploadQueue.test.ts` (new)
- `client/src/library/useBulkUpload.ts` (new)
- `client/src/library/useBulkUpload.test.ts` (new)
- `client/src/components/EmptyDropzone/EmptyDropzone.tsx` (modified: multi-file)
- `client/src/components/EmptyDropzone/EmptyDropzone.test.tsx` (new)
- `client/src/library/CollectionTable.tsx` (modified: pendingRows + status seam)
- `client/src/library/CollectionTable.css` (modified: `--row--extracting` treatment)
- `client/src/library/CollectionTable.test.tsx` (modified: pending-row cases)
- `client/src/library/LibraryPage.tsx` (modified: bulk machine, drop target, dropzone empty state)
- `client/src/library/LibraryPage.css` (modified: drag-over affordance, dropped dead `:disabled` rule)
- `client/src/library/LibraryPage.test.tsx` (modified: bulk-upload cases)
- `server/pyproject.toml` (modified: version 0.4.3 → 0.4.4)
- `server/uv.lock` (modified: version bump)
