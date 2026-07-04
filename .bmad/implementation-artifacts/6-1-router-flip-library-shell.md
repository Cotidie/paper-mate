---
baseline_commit: 66e247a2a6848895eb43f56fc8a38f33faee6cfe
---

# Story 6.1: Router front-door flip and Library shell

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a returning reader,
I want the app to boot into a Library home instead of an empty reader,
so that my papers have a front door and the reader becomes one route among them.

This is the **Phase-2 risk gate** (Epic 6 intro): it stands up the client router front-door flip that every later Library story (table, upload, extraction, open-in-annotator) sits on. It is deliberately a **structural** story: it adds routing + an empty Library shell + a per-document metadata GET, and moves the existing reader under a route param **with zero behavioral change to reading or annotating**. No table, no folders, no upload orchestration, no extraction (those are 6.2–6.7).

## Acceptance Criteria

1. **Router mounts (AL-3 / AD-L3, LFR-1).** On boot the SPA mounts React Router via `createBrowserRouter` in **library/data mode** (NOT framework mode, file-based routing + SSR is a meta-framework, excluded by AD-2) with **exactly two routes**: `/` (Library home) and `/reader/:docId` (Reader). `/` is the boot landing.

2. **Reader loads by route param (AL-3, inherited AD-8).** The existing reader is placed under `/reader/:docId`. It reads the `:docId` param and loads that document via the existing doc-load path (`GET /api/docs/{id}/file`), plus a new `GET /api/docs/{id}` for the document's own metadata (filename, page_count). There is **no behavioral change** to reading or annotating: every Epic 1–5 reader capability (render, scroll, zoom, pan, ToC, all annotation tools, edit, undo/redo, autosave, restore-on-open, Bank, hide-all, Settings) works exactly as before.

3. **Library shell renders from tokens (L-UX-DR1, L-UX-DR11).** At `/` with no collection data yet, the Library route renders a shell built **only from DESIGN.md tokens (no inline hex/px)**: a **48px, hairline-bottom top bar** carrying **app identity + an Add affordance**; a **left folder-panel region**; and a **main region on `{colors.reader-backdrop}`** showing the empty-collection copy **`No papers yet.`**

4. **Back-to-Library from the reader (LFR-20, L-UX-DR10).** The Reader top bar carries a **back-to-Library control**; activating it navigates to `/`.

5. **Route is the source of navigation truth (AL-3).** Browser back/forward and a hard refresh on **either** route preserve the user's place (the URL drives what renders; refresh at `/reader/:docId` re-hydrates that document; refresh at `/` shows the Library).

6. **Accessibility floor (L-UX-DR12).** Every interactive control in the shell is keyboard-operable and shows the visible **2px `{colors.ink}` focus ring** when focused. No Library string contains an em-dash (L-UX-DR13).

## Tasks / Subtasks

- [x] **Task 1, Backend: `GET /api/docs/{doc_id}` (metadata) (AC: 2, 5)**
  - [x] Add a public `read_meta(doc_id: str) -> DocMeta` to `server/app/storage/__init__.py`, mirroring `read_annotations` exactly: resolve the doc dir, raise `DocumentNotFoundError` when the id is unresolvable or `_read_meta(doc_dir)` returns `None`, let `StorageError` subclasses (corrupt/unknown-version metadata) propagate. Reuse the existing `_read_meta` / `_doc_dir` internals, do NOT re-parse the PDF.
  - [x] Add `@router.get("/docs/{doc_id}", response_model=Doc)` → `get_doc(doc_id)` in `server/app/routes/docs.py`, mirroring `get_annotations`'s error mapping (`DocumentNotFoundError` → 404 `Document not found`; `StorageError` → 500 `Could not read document`; single `{ detail }` envelope). Body = `Doc(doc_id=doc_id, **meta.model_dump())`. Remove `GET /api/docs/{doc_id}` from the module docstring's "Reserved (not built here)" line (keep `GET /api/docs` reserved for 6.2).
  - [x] Add backend tests in `server/tests/test_docs.py`: 200 returns the `Doc` for an imported doc; 404 (with `{ detail }`) for an unknown id. Add a `read_meta` unit test to `server/tests/test_storage.py` (round-trips an imported doc's `DocMeta`; unknown id → `DocumentNotFoundError`).
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api` (commit `server/openapi.json` + `client/src/api/schema.d.ts`).
  - [x] Update `docs/API.md`: move `GET /api/docs/{doc_id}` from **Reserved** into **Resources**, and add a Story 6.1 changelog entry.

- [x] **Task 2, Client: adopt React Router + client `getDoc` (AC: 1, 2)**
  - [x] Add the dependency `react-router` pinned to an **exact patch** (`8.1.0`, Wonseok's call over the spine's v7.18.1 default; API-identical for our `createBrowserRouter`/`RouterProvider`/`useParams`/`useNavigate` usage). Import router APIs from `react-router` (v7+ merged `react-router-dom`; do NOT add `react-router-dom`).
  - [x] Add `getDoc(docId: string): Promise<Doc>` to `client/src/api/client.ts`, mirroring `getAnnotations` (`GET /api/docs/${encodeURIComponent(docId)}`, `envelopeError` on non-ok). `api/` stays the single owner of backend routes (AD-9).
  - [x] Create `client/src/routes/router.tsx`: `createBrowserRouter([{ path: "/", element: <LibraryPage/> }, { path: "/reader/:docId", element: <ReaderPage/> }])`, exported.
  - [x] `client/src/main.tsx`: render `<RouterProvider router={router} />` inside `<StrictMode>` (replace `<App/>`).

- [x] **Task 3, Client: move the reader under `/reader/:docId` (AC: 2, 4, 5)**
  - [x] Extract the reader shell into `client/src/reader/ReaderPage.tsx` (+ its CSS): everything `App.tsx` renders today in the `doc !== null` branch, top bar, `<Reader>`, `<ToolRail>`, `<SettingsModal>`, `<TocPanel>`, `<BankPanel>`, the document-level keymap effect, `useAutosave`, all tool/panel state, moves **unchanged**.
  - [x] Replace the upload-driven open with a **param-driven load**: read `const { docId } = useParams()`; in a load effect keyed on `[docId]`, `Promise.all([getDoc(docId), getAnnotations(docId)])`, then call `openDoc(docId, restored)` **before** `setDoc(meta)` (preserve the Story 3.5 hydrate-before-mount ordering, see Dev Notes). Guard with a `live`/`cancelled` flag.
  - [x] Delete the S0 branch, `EmptyDropzone` usage, `handleFile`, `uploadDoc` call, and `busy` state from the reader, upload leaves the reader (it lives in the Library from 6.4; the single-file bridge is in Task 4).
  - [x] On load failure (bad/unknown `:docId` → 404, or a `getAnnotations` failure), do NOT clobber: keep the store empty and `navigate("/", { replace: true })` (simplest correct behavior; a minimal in-reader "couldn't open" with a back link is an acceptable alternative). Reuse the existing anti-clobber invariant (a failed open must never PUT an empty set).
  - [x] Add a **back-to-Library** control to the Reader top bar (far left of the lead cluster): a native `button` using the existing `.pill.pill--icon` idiom, a Phosphor glyph (e.g. `ArrowLeft`), `aria-label`/`title` "Back to library" (no em-dash), `onClick={() => navigate("/")}` via `useNavigate()`.
  - [x] Delete `App.tsx` (and fold `App.css` into `reader/ReaderPage.css`, or keep the filename if the churn is large, dev's call, but the component must live under `reader/`).

- [x] **Task 4, Client: Library shell (AC: 3, 6)**
  - [x] Create `client/src/library/LibraryPage.tsx` (+ `LibraryPage.css`, tokens only): a 48px hairline-bottom top bar (`{component.top-bar}` idiom) with app identity ("Paper Mate", `{typography.title-sm}` `{colors.ink}`) on the left and an **Add affordance** (native `button`, `{component.button-secondary}` or the pill idiom) on the right; a **left folder-panel region** (hairline-bounded `{colors.surface-card}` column, ~280px, a static bounded placeholder in 6.1; folder CRUD is Epic 7); a **main region on `{colors.reader-backdrop}`** with the centered copy `No papers yet.`
  - [x] Wire the Add affordance as a **single-file upload bridge** (keeps the app usable end-to-end until 6.4 lands bulk upload, see the DECISION note): a hidden `<input type="file" accept="application/pdf">`; on pick, single-flight `uploadDoc(file)` then `navigate(`/reader/${doc.doc_id}`)`; on failure surface "Couldn't add this file." (no em-dash) and stay on `/`.
  - [x] Confirm the shell needs no new focus CSS: the global `:focus-visible` rule (`src/index.css`) already paints the 2px ink ring for native controls; use real `<button>`s.

- [x] **Task 5, Tests: migrate the reader suite + cover the shell (AC: 1–6)**
  - [x] Move `client/src/App.test.tsx` → `client/src/reader/ReaderPage.test.tsx`. Change the open mechanism from "fill the dropzone-input" to rendering `ReaderPage` inside a `createMemoryRouter([...routes], { initialEntries: [`/reader/${fakeDoc.doc_id}`] })` + `<RouterProvider/>`, and stub `api.getDoc` (resolve `fakeDoc`) + `api.getAnnotations`. Kept EVERY behavioral assertion (top bar, page indicator, zoom, all tool-key tests, ToC, Bank, hide-all, Settings modal + rebinding, autosave toast, restore-on-open anti-clobber, layered Esc), dropped only the dropzone-mechanic-specific S0 tests (upload input reset / busy-disable), which no longer apply now that upload lives in the Library; added new route-driven tests (back-to-Library navigates to `/`; a `getDoc` failure redirects to `/`; a `getAnnotations` failure redirects to `/`). Preserve the `beforeEach` store reset (`hidden/selectedId/docId`) and the `vi.mock("@/render")` barrel verbatim.
  - [x] Add `client/src/library/LibraryPage.test.tsx`: shell renders `No papers yet.`, app identity, and a keyboard-focusable Add button; the bridge is wired, so picking a file calls `uploadDoc` and navigates to `/reader/:docId` (asserted via a `createMemoryRouter` with a `/reader/:docId` stub route), plus a failure-path test (toast + stays on `/`).
  - [x] Skipped the optional `client/src/routes/router.test.tsx`: `createBrowserRouter` needs real browser history, which is awkward/flaky to drive directly under jsdom; the two-route wiring is already covered indirectly by `ReaderPage.test.tsx`/`LibraryPage.test.tsx`'s `createMemoryRouter` renders of each element.
  - [x] Kept the two `vi.mock("@/render")` barrels in sync (`ReaderPage.test.tsx` + `components/Reader/Reader.test.tsx`), no new `render/` export is added here, so this is a relocation, not a new export (CLAUDE.md engineering principle).
  - [x] `npm run typecheck` + `npm test` green (860 passed); backend `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green (76 passed, run on host).

- [x] **Task 6, Live smoke (AC: 2, 4, 5), launch your OWN dev servers (CLAUDE.md)**
  - [x] Fresh `uvicorn` (port 8010, isolated `PAPER_MATE_DATA` scratch dir) + `vite dev` (port 5183) bound to this working tree. Boot → lands on `/` Library shell with `No papers yet.` Add a PDF via the Add affordance → navigates to `/reader/:docId`, PDF renders, created a highlight annotation via a real text-selection drag (Playwright `page.mouse`). Back-to-Library → `/`. Hard-refresh at `/reader/:docId` (fresh `page.goto`) → the same doc re-hydrates with its annotations. Browser back/forward moves between `/` and the reader, mark persists across the round-trip. Verified at **DPR=2** (HiDPI, CDP `Emulation.setDeviceMetricsOverride`) that render + the highlight land correctly (AE-5). Shut the servers down after.
  - [x] **Bug found + fixed during smoke:** navigating away from a fully-loaded reader (unmounting `<Reader>`) crashed the ENTIRE app into React Router's default error boundary: `TypeError: pdf.destroy is not a function` from `render/index.ts`'s `destroyDocument`. Root cause: `PDFDocumentProxy` has no `.destroy()` in pdfjs-dist 6.0.227 (verified against the bundled source); the old single-page `App.tsx` never unmounted a loaded `Reader`, so this path was dead code until this story's routing made `/reader/:docId → /` a real unmount. Fixed by calling `pdf.loadingTask.destroy()` instead (a real, fully-typed API on `PDFDocumentProxy`, no unsafe cast needed), in `client/src/render/index.ts`. Re-ran the full client (860 passed) + backend (76 passed) suites and re-smoked back-to-Library after the fix: clean, no console errors.

### Review Findings

Cross-model review via `bmad-code-review` run standalone through Codex (`codex exec`, read-only sandbox, working-tree diff vs `baseline_commit` since this story's changes were uncommitted at review time).

- [x] [Review][Patch] Back-to-Library can drop an unsaved annotation edit [client/src/hooks/useAutosave.ts:104] (High): `useAutosave()` now lives inside `ReaderPage` and unmounts for real on back-to-Library navigation (a genuinely new path this story introduces, `Reader` never unmounted before). The unmount cleanup only cleared the pending 800ms debounce timer, so an edit made just before navigating away was silently dropped: reopening the same doc re-hydrates from disk without it. Fixed by flushing a pending debounce synchronously in the cleanup instead of just cancelling it (`useAutosave.ts`); `flush()` reads its target/snapshot live from the store and its promise chain runs independent of the component's mount state, so the save completes even after cleanup returns. Updated the existing unmount test (previously asserted the now-wrong "no PUT after unmount" contract, itself a Story 3.4/5.8-era Codex-Med fix for a purely-hypothetical StrictMode path) to assert the flush, and added a sibling test for the still-correct "nothing dirty, no PUT" case. Full client suite green after the fix (861 passed).
- [x] [Review][Defer] `server/openapi.json` tracking mismatch [docs/API.md]: dismissed as noise, the repo's `.gitignore` deliberately excludes the generated `server/openapi.json` (a build artifact) while committing the generated `client/src/api/schema.d.ts`; this is existing, intentional policy, not a defect introduced by this story.
- Low/hygiene note (not a code finding): the working tree also carries unrelated untracked artifacts (`.claude/skills/scaffold-react-native/`, a sample PDF fixture) from other in-progress work in this repo, not part of this story's changes.

## Dev Notes

### The shape of this change (read first)

Today there is **no router**. `client/src/main.tsx` renders `<App/>`; `App.tsx` is a monolith that owns BOTH the boot/open flow (an `EmptyDropzone` → `handleFile` → `uploadDoc`) and the entire reader shell (top bar, `Reader`, `ToolRail`, panels, keymap effect, autosave). When `doc === null` it shows the dropzone; when set, the reader. This story splits that monolith along a route boundary:

- `main.tsx` → `<RouterProvider>` (the app's new entry).
- `routes/router.tsx` → `createBrowserRouter` with `/` and `/reader/:docId`.
- `library/LibraryPage.tsx` → the new `/` shell (was the S0 empty state; now the front door).
- `reader/ReaderPage.tsx` → the old reader body, now loading its doc from the `:docId` param instead of an upload result.

This matches the architecture's client source-tree exactly (`routes/`, `library/`, `reader/`, [Source: architecture-spine Structural Seed]) and the initiative rule that route-level views depend downward on `store → api-client` (AD-9, unchanged).

### Why a new `GET /api/docs/{id}` is in scope (not deferred)

The reader consumes `doc.page_count` (reserve-geometry loop + `usePageViewport` + `usePageNav`) and `doc.filename` (top-bar title) BEFORE/while the PDF loads. Today the only source of a `Doc` is `uploadDoc` (`POST /api/docs`). Under `/reader/:docId` the reader has only a hash id, so on a cold URL or a hard refresh it MUST fetch the document's own metadata. `GET /api/docs/{id}` is the AD-L6 "own metadata" endpoint and is **already reserved** in `docs/API.md` (line ~107, "TBD"). It is a ~10-line addition mirroring `get_annotations`; it is strictly smaller and cleaner than restructuring the Reader to derive `page_count` from `pdf.numPages` and showing a SHA-256 hash as the title. `GET /api/docs` (list) stays reserved for Story 6.2. [Source: architecture-spine AD-L6; docs/API.md#Reserved]

### The hydrate-before-mount ordering is load-bearing (do not break restore-on-open)

The current `App.handleFile` ordering is a Story 3.5 anti-clobber invariant (App.tsx lines ~256–268): both awaits run while `store.docId` is still `null` (so `useAutosave`, bound to `store.docId`, is inert), then `openDoc(docId, restored)` sets `docId` + populates the store + clears zundo history **atomically and before** the reader flips on, so autosave's baseline captures the ALREADY-restored set (restore is never PUT back and is not undoable). Preserve this exactly in the param-driven load:

```
useEffect(() => {
  let live = true;
  (async () => {
    try {
      const [meta, restored] = await Promise.all([getDoc(docId), getAnnotations(docId)]);
      if (!live) return;
      openDoc(docId, restored);   // MUST precede setDoc (baseline = restored set)
      setDoc(meta);
    } catch { if (live) navigate("/", { replace: true }); }
  })();
  return () => { live = false; };
}, [docId]);
```

`openDoc` is the doc-scoped store primitive ([Source: client/src/store/index.ts], `openDoc(docId, annotations)`: replaces `docId` + `annotations` Map atomically, clears zundo history so the loaded set is the undo floor, resets `hidden/selectedId/multiSelectedIds/flashId`; `docId` is excluded from the zundo partialize so undo cannot revert it). This is Story 5.8's atomic doc-scope, the seam Story 6.7's doc-switch will lean on; keeping it intact here is what makes a later `/reader/A` → `/reader/B` switch safe. Do NOT move hydration into a `Reader` child effect (its baseline would capture the empty set, Story 3.5 AC-4). The existing "restore-on-open" and "GET failure keeps the reader closed" tests must survive the migration (re-pointed at the new open mechanism).

### Existing reader behavior that MUST be preserved verbatim (regression surface)

Move these from `App.tsx` unchanged; they are hard-won and each has tests:
- **Document-level keymap effect** (capture-phase `keydown`, phase-gated on `docOpen`, suppressed while Settings open; layered Esc that defers to the overlay when a mark is selected, the Story 5.6 Codex-HIGH fix). Bind at `document`, never the canvas (CLAUDE.md). `docOpen` becomes `doc !== null` in `ReaderPage`.
- **`useAutosave()`** called unconditionally (no-ops until `store.docId` is set); the save-failure toast; the load-error vs save-error toast precedence.
- **`Reader` prop derivations** (`panArmed`/`armedTool`/`boxActive`/`multiSelectActive` from the single `activeTool` FSM, AD-11), `readerRef` imperative handle, `handleBankJump`, ToC/Bank/Settings/hide-all top-bar controls, the version fetch (`fetchHealth` → Settings modal footer).
- The `Reader` component itself (`components/Reader/Reader.tsx`) is unchanged, it already self-loads the PDF from `doc.doc_id` via `loadDocument` → `docFileUrl` → `GET /api/docs/{id}/file`.

### Library shell specifics (tokens only, `src/no-raw-values.test.ts` enforces it)

- Top bar: 48px, hairline bottom, `{component.top-bar}` maps to the existing `.top-bar` rule (`--top-bar-height`, `border-bottom: var(--top-bar-border) solid var(--color-hairline)`, `background: var(--color-canvas)`). Reuse or add a `.library-top-bar` variant with the same tokens. [Source: DESIGN.md#top-bar; client/src/App.css:13]
- Folder-panel region: hairline-bounded `{colors.surface-card}` (#ffffff) column, ~280px (`{component.toc-panel}` width idiom). Static placeholder in 6.1, All/Uncategorized pseudo-entries and CRUD are L-UX-DR4 / Epic 7. [Source: epics.md#L-UX-DR1]
- Main region: `{colors.reader-backdrop}` floor, centered copy exactly `No papers yet.` (the dropzone that shares this region is L-UX-DR5/DR11 → Stories 6.3/6.4; do NOT add it here). [Source: epics.md#L-UX-DR11; Story 6.1 AC]
- Focus ring: already global (`:focus-visible { outline: var(--focus-ring-width) solid var(--color-ink) }`, `src/index.css:24`). Use native `<button>`s and it is satisfied for free (L-UX-DR12).
- Voice: Obsidian-quiet, no em-dash, no exclamation (L-UX-DR13). Grep new UI strings for an em-dash before committing.

### SPA history fallback, already handled (verify, don't build)

`createBrowserRouter` uses HTML5 history (real paths like `/reader/<hash>`). Prod refresh already works: `server/app/main.py` has a `spa_fallback` catch-all (`@app.get("/{full_path:path}")`) that serves `index.html` for any non-`/api`, non-asset GET, registered after the API router. Dev works too: Vite's default `appType: "spa"` gives history fallback, and the proxy only forwards `/api`. So **no server routing change** is needed for AC-5 beyond the new metadata GET, just confirm a hard refresh at `/reader/:id` serves the app in your live smoke. [Source: server/app/main.py:83–94]

### Library / Framework requirements

- **React Router, pin the exact patch.** The architecture spine specifies **v7.x** in library/data mode (`createBrowserRouter`), explicitly NOT framework mode (a meta-framework excluded by AD-2). Default to `react-router@7.18.1` (current `version-7` dist-tag). **Decision surfaced:** npm `latest` is now **8.1.0** (v8 shipped after the spine was finalized). The spine is binding read-only, so the safe, spec-compliant default is v7.18.1; our two-route `createBrowserRouter` + `RouterProvider` + `useParams`/`useNavigate` usage is API-identical across v7 and v8, so a bump to v8 is low-risk if Wonseok prefers "latest", confirm before pinning. [Source: architecture-spine#Stack; AD-L3]
- **Package name:** v7+ merged `react-router-dom` into `react-router`; install and import from `react-router` only. `createBrowserRouter`, `RouterProvider`, `useParams`, `useNavigate`, and (tests) `createMemoryRouter` all come from `react-router`.
- **Do not** reach for framework-mode features (loaders/actions file conventions, SSR, `react-router.config.ts`). The router owns navigation/history only; collection/domain state stays in the store + backend (AD-L3).

### Testing standards

- Vitest + Testing Library, jsdom. The reader suite is the big migration: the current `openReader()`/dropzone helper must become a `createMemoryRouter` render at `/reader/:docId` with `getDoc`+`getAnnotations` stubbed. `useParams`/`useNavigate` require a Router context in tests, wrap with `RouterProvider` (data router) or a `MemoryRouter`.
- Preserve the `vi.mock("@/render")` barrel exactly (pdf.js can't run under jsdom) and the `beforeEach` singleton resets (settings keymap, `hidden/selectedId/docId`). [Source: client/src/App.test.tsx]
- Backend: `test_docs.py` for the new endpoint (200 + 404), `test_storage.py` for `read_meta`. Note the CLAUDE.md sandbox caveat, the `TestClient`-backed tests can hang under the Codex review sandbox; the human runs the backend suite on the host.
- Multi-page/DPR>1 live smoke is mandatory for any geometry (AE-5). No geometry changes here, but the reader must still render + highlight correctly at DPR>1 after the move (regression guard).

### Project Structure Notes

- New: `client/src/routes/router.tsx`, `client/src/library/LibraryPage.tsx` (+css, +test), `client/src/reader/ReaderPage.tsx` (+css, +test). Removed: `client/src/App.tsx` (+ `App.test.tsx` relocated). `EmptyDropzone` stays in the tree (still used by 6.3/6.4) but is no longer the boot component. This lands the spine's `routes/` + `library/` + `reader/` dirs and continues the Story 5.4 colocation convention (component + css + test together). [Source: architecture-spine#Structural Seed]
- Backend: `routes/docs.py` + `storage/__init__.py` + `models.py` (no model change, `Doc`/`DocMeta` already exist) + `docs/API.md` + regenerated `openapi.json`/`schema.d.ts`.
- Downward-dependency rule (AD-9) intact: both route views → `store` → `api/` client; routes never touch the filesystem; the client reaches the backend only through the generated client.

### DECISION notes (defaults chosen; confirm if you disagree)

1. **Add affordance is wired as a single-file bridge (default).** Replacing the boot dropzone with an empty shell would leave a NEW user with no way to open any document until Story 6.4. To keep the app working end-to-end (the workflow's non-negotiable), the top-bar Add affordance uploads one PDF (`uploadDoc`) and navigates to `/reader/:doc_id`. It is explicitly a temporary bridge that 6.4 replaces with bulk optimistic upload + a dropzone. Alternative: leave Add as a visual-only affordance and make the reader reachable only by URL until 6.4.
2. **Load failure redirects to `/`** (`navigate("/", { replace: true })`) rather than a bespoke reader error screen, smallest correct behavior; a bad `:docId` returns to the front door.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-6.1], AC + Epic 6 intro (risk gate)
- [Source: .bmad/planning-artifacts/epics.md#L-UX-DR1/DR10/DR11/DR12/DR13], shell layout, nav, empty/loading, a11y floor, voice
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L3], routing / front-door flip (createBrowserRouter, library/data mode, exactly two routes)
- [Source: ...ARCHITECTURE-SPINE.md#AD-L6], API boundary: `GET /api/docs/{id}` = own metadata
- [Source: ...ARCHITECTURE-SPINE.md#Stack], React Router v7.x, library/data mode; [#Structural Seed], routes/ library/ reader/ dirs
- [Source: client/src/App.tsx], the monolith being split; handleFile hydrate ordering (Story 3.5), keymap effect (Story 5.6), autosave/toasts
- [Source: client/src/components/Reader/Reader.tsx], self-loads PDF from doc.doc_id; consumes doc.page_count/filename (unchanged)
- [Source: client/src/store/index.ts], `openDoc(docId, annotations)` doc-scoped hydrate primitive (Story 5.8)
- [Source: client/src/api/client.ts], mirror `getAnnotations` for `getDoc`; `api/` is the sole backend owner (AD-9)
- [Source: server/app/routes/docs.py], mirror `get_annotations` error mapping for `get_doc`
- [Source: server/app/storage/__init__.py], `_read_meta`/`read_annotations` pattern for `read_meta`
- [Source: server/app/main.py:83], SPA history fallback already present
- [Source: docs/API.md#Reserved], `GET /api/docs/{doc_id}` already reserved (flip to built)
- [Source: DESIGN.md#top-bar, #Colors], top-bar 48px/hairline, surface-card, reader-backdrop, ink tokens
- [Source: CLAUDE.md], tokens-only UI, no em-dash, document-level handlers, keep render/ mock barrels in sync, launch-your-own-dev-servers, DPR>1 smoke, versioning (PATCH +1 at merge)

## Dev Agent Record

### Agent Model Used

Sonnet 5 (xhigh reasoning), bmad-dev-story.

### Debug Log References

- `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 76 passed (post-implementation and post-fix, both green).
- `cd client && npm run typecheck` → clean.
- `cd client && npm test -- --run` → 860 passed (43 files). One unrelated pre-existing timing flake in `Reader.test.tsx` under full-suite load (space-hold-pan test) reproduced once, passed in isolation and on a full re-run; not caused by this story, not investigated further.
- Live smoke: own `uvicorn` (port 8010, isolated `PAPER_MATE_DATA` scratch dir) + `vite dev` (port 5183); Playwright MCP (`browser_run_code_unsafe`, real `page.mouse` drag) + Chrome DevTools MCP for the initial boot/upload pass; DPR=2 via CDP `Emulation.setDeviceMetricsOverride`.

### Completion Notes List

- Backend: added `storage.read_meta` + `GET /api/docs/{doc_id}` mirroring the `read_annotations`/`get_annotations` pattern exactly; regenerated the OpenAPI contract and `client/src/api/schema.d.ts`; moved the endpoint from Reserved to Resources in `docs/API.md` with a changelog entry.
- Client: added `getDoc`, adopted `react-router` (pinned exact patch), added `routes/router.tsx` (`createBrowserRouter`, two routes), extracted the reader shell into `reader/ReaderPage.tsx` (+ CSS, folded from `App.css`) with a param-driven load that preserves the Story 3.5 hydrate-before-mount ordering, added the back-to-Library control, and built `library/LibraryPage.tsx` (+ CSS) as the new `/` shell with a single-file upload bridge (temporary until Story 6.4). Deleted `App.tsx`/`App.css`/`App.test.tsx`.
- **Decision (user-confirmed):** pinned `react-router@8.1.0` (latest) rather than the architecture spine's default `7.18.1`, Wonseok's explicit call when asked, since the two-route `createBrowserRouter`/`RouterProvider`/`useParams`/`useNavigate` usage here is API-identical across v7/v8.
- **Decision (dev's call per the story's DECISION notes):** the Add-affordance failure copy is "Couldn't add this file." (new copy, distinct from the reader's own "Couldn't open this file.") since the bridge's only failure mode is the upload/import step, not a subsequent open.
- Tests: migrated `App.test.tsx` → `reader/ReaderPage.test.tsx` (all behavioral assertions preserved; open mechanism is now `createMemoryRouter` + stubbed `getDoc`/`getAnnotations`; dropped only the dropzone-mechanic-specific tests that no longer apply since upload moved to the Library; added back-to-Library and getDoc/getAnnotations-failure-redirects-to-`/` tests). Added `library/LibraryPage.test.tsx`. Skipped the optional `routes/router.test.tsx` (`createBrowserRouter` needs real browser history, awkward under jsdom; the two-route wiring is already exercised via each page's own `createMemoryRouter` tests). Fixed a stale `App.css` filename reference in `no-raw-values.test.ts`.
- **Bug found + fixed during live smoke (not part of the original task list, required to satisfy AC-4):** unmounting a fully-loaded `<Reader>` (i.e., navigating from `/reader/:docId` back to `/`) crashed the whole app into React Router's default error boundary: `TypeError: pdf.destroy is not a function`. Root cause: `PDFDocumentProxy` has no `.destroy()` in the pinned pdfjs-dist 6.0.227 (verified against the bundled source); the pre-6.1 single-page `App.tsx` never unmounted a loaded `Reader`, so `Reader.tsx`'s cleanup-calls-`destroyDocument` path was dead code until this story's routing made that a real, reachable unmount. Fixed `render/index.ts`'s `destroyDocument` to call `pdf.loadingTask.destroy()` instead, a real, fully-typed pdf.js API (`PDFDocumentProxy.loadingTask`), removing the previous unsafe-cast workaround entirely. Re-ran both suites green after the fix and re-smoked back-to-Library clean (no console errors).
- Live smoke (own servers, DPR=2): boot → `/` Library shell (`No papers yet.`) → Add a PDF → `/reader/:docId`, renders, created a highlight via a real text-selection drag → back-to-Library → `/` → hard-refresh at `/reader/:docId` (fresh navigation) re-hydrates the doc + its annotation → browser back/forward round-trips `/` ↔ the reader with the mark intact throughout, all at DPR=2.
- Cross-model review (`bmad-code-review` via `codex exec`, read-only, standalone) found one HIGH finding: `useAutosave`'s unmount cleanup dropped an edit made just before navigating away (see Review Findings above). Fixed in `client/src/hooks/useAutosave.ts` (flush a pending debounce on unmount instead of only cancelling it); updated the test that had asserted the old (now-incorrect) "no PUT after unmount" contract and added a sibling test for the still-correct "nothing dirty, no PUT" case. Client suite green after the fix (861 passed, up from 860).

### File List

**Backend**
- `server/app/storage/__init__.py` (added `read_meta`)
- `server/app/routes/docs.py` (added `GET /docs/{doc_id}` → `get_doc`; docstring update)
- `server/tests/test_docs.py` (added `get_doc` 200/404 tests)
- `server/tests/test_storage.py` (added `read_meta` round-trip/not-found tests)
- `docs/API.md` (moved `GET /api/docs/{doc_id}` to Resources; changelog entry)

**Client**
- `client/package.json`, `client/package-lock.json` (added `react-router@8.1.0`, exact)
- `client/src/api/client.ts` (added `getDoc`)
- `client/src/api/schema.d.ts` (regenerated from the updated OpenAPI contract)
- `client/src/routes/router.tsx` (new, `createBrowserRouter`, two routes)
- `client/src/main.tsx` (renders `<RouterProvider>` instead of `<App/>`)
- `client/src/reader/ReaderPage.tsx` (new, extracted reader shell, param-driven load, back-to-Library control)
- `client/src/reader/ReaderPage.css` (new, folded from `App.css`)
- `client/src/reader/ReaderPage.test.tsx` (new, migrated from `App.test.tsx`)
- `client/src/library/LibraryPage.tsx` (new, Library shell + upload bridge)
- `client/src/library/LibraryPage.css` (new)
- `client/src/library/LibraryPage.test.tsx` (new)
- `client/src/render/index.ts` (bug fix: `destroyDocument` uses `pdf.loadingTask.destroy()`)
- `client/src/hooks/useAutosave.ts` (Codex review fix: flush a pending debounce on unmount instead of dropping it)
- `client/src/hooks/useAutosave.test.ts` (updated the stale unmount test + added a sibling case)
- `client/src/no-raw-values.test.ts` (sanity-check filename reference updated to `ReaderPage.css`)
- Deleted: `client/src/App.tsx`, `client/src/App.css`, `client/src/App.test.tsx`
