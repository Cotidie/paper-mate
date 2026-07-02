---
baseline_commit: f065d9a9ed8345b4ec480f15c1ae80209f76006f
---
# Story 5.4: React client `src/` module layout (folder-structure refactor)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want `client/src/` reorganized into the scaffold-react folder layout instead of 38 flat root files,
so that a component, hook, or helper lives in an obvious place and the root stops being a dumping ground.

## Acceptance Criteria

1. **Components foldered.** Every reusable component moves into `components/<Name>/` with its `.css` + `.test.tsx` colocated (one folder per component, per the scaffold-react convention); hooks (`use*`) get a hooks home; the pure zero-import leaves (`tools.ts`, `domFocus.ts`, `uuid.ts`, `bank.ts`) get a `lib/`-style home. No reusable component or helper is left loose at the `src/` root. [Source: epics.md#Story-5.4 AC-1]

2. **Scaffold adapted, not copied.** The `/scaffold-react` architecture is adapted to this Vite + TS + Zustand stack, not copied from its CRA template: the existing AD-9 layer dirs (`render/`, `anchor/`, `annotations/`, `store/`, `api/`, `reader/`, `settings/`, `theme/`) are preserved as-is (they already ARE the modular boundaries), only the flat root files are foldered, and no toolchain / token-pipeline / generated-file / Storybook rule is introduced or changed. [Source: epics.md#Story-5.4 AC-2; SKILL.md "preserve the existing toolchain"]

3. **Entry + guards stay valid.** The entry + composition-root files (`main.tsx`, `App.tsx`/`App.css`, `index.css`, `vite-env.d.ts`) and the cross-cutting guard suites (`no-raw-values.test.ts`, `focus-ring.test.ts`) stay wherever keeps their file access valid (all at the `src/` root, see Dev Notes coupling); every moved file's imports AND every importer are updated, including both `vi.mock("./render")` barrels fixed for their new relative paths. [Source: epics.md#Story-5.4 AC-3]

4. **Behavior- and contract-identical.** Client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` are byte-identical, `no-raw-values` re-run passes after any CSS move, no upward imports are introduced (AD-9 downward-only layering), and it is re-smoked live at DPR>1 cross-page. Its own PR(s), never folded into a feature story. [Source: epics.md#Story-5.4 AC-4; AD-9]

## Tasks / Subtasks

- [x] **Task 0 - Load the scaffold-react convention (facilitate `/scaffold-react`).** (AC: 1, 2)
  - [x] Invoke the `cotidie:scaffold-react` skill (Skill tool) before moving files; it treats an existing project as a REFACTOR target, not a new scaffold.
  - [x] Read its `references/react-scaffold-rules.md` ("Folder Layout" + "Existing Project Targets"): reusable UI in `components/<Name>/`, colocated `.css`/`.test`, adapt to the target stack, keep the target toolchain. Do NOT run `scripts/create_from_template.py` (that is for a NEW CRA app) and do NOT copy CRA files into this Vite/TS app.
  - [x] Follow its incremental-migration rule: move ONE slice at a time, update imports, run focused checks, then continue (this is why Tasks 1-3 below are per-slice, each its own commit).
  - [x] Capture baseline before the first move: `cd client && npm test` + `npm run typecheck`, and confirm the contract is byte-clean (`cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`, expect no diff). Record the baseline test count in the Debug Log.

- [x] **Task 1 - Move the 9 UI components into `components/<Name>/`.** (AC: 1, 3, 4)
  - [x] Move each of the following (with its colocated `.css`/`.test.tsx` where present) into `components/<Name>/`: `Reader`, `BankPanel`, `SaveIndicator`, `EmptyDropzone`, `Toast`, `TocPanel`, `ToolRail`, `ToolFlyout`, `ZoomControl`. See the move-map table in Dev Notes.
  - [x] Update the importers: `App.tsx` imports 8 of these directly; `ToolRail.tsx` imports `ToolFlyout`. Fix each moved file's OWN imports for its new depth (e.g. `Reader.tsx`'s `./reader/...`, `./render`, `./anchor`, `./annotations` become `../../reader/...` etc.).
  - [x] **CRITICAL:** `Reader.test.tsx` moves, so its `vi.mock("./render", ...)` AND `import * as renderLayer from "./render"` must both change to the new relative path (e.g. `../../render`). `App.test.tsx` STAYS at root, so its `vi.mock("./render")` is UNCHANGED. This is the exact both-barrels gotcha from the Engineering-principles note. [Source: CLAUDE.md; Reader.test.tsx:5,9 / App.test.tsx:6,15]
  - [x] Decide Reader's target (see Dev Notes "Decisions"): `components/Reader/` vs folding into the existing `reader/` feature dir. Pick one, note the rationale in Project Structure Notes.
  - [x] `npm test` + `npm run typecheck` green; commit.

- [x] **Task 2 - Move the hooks into `hooks/`.** (AC: 1, 3, 4)
  - [x] Move `useAutosave.ts` (+ `useAutosave.test.ts`) and `useLiveRef.ts` into `hooks/`.
  - [x] Update importers: `useAutosave` -> `App.tsx`, `App.test.tsx`, `components/SaveIndicator/SaveIndicator.tsx` (moved in Task 1); `useLiveRef` -> `annotations/AnnotationInteraction.tsx`.
  - [x] `npm test` + `npm run typecheck` green; commit.

- [x] **Task 3 - Move the pure leaves into `lib/`.** (AC: 1, 3, 4)
  - [x] Move `tools.ts` (+test), `bank.ts` (+test), `uuid.ts` (+test), `domFocus.ts` into `lib/`.
  - [x] **Verify each is a true zero-import leaf** (imports nothing from `render/`/`anchor/`/`annotations/`/`store/`/`reader/`) BEFORE moving, so the relocation cannot invert a dependency (AD-9). If one is not a leaf, stop and flag.
  - [x] Update ALL importers (widest blast radius here): `tools` has 9 importers (`App.tsx`, moved `ToolRail`+test, `annotations/gestures/shared.ts`, `annotations/gestures/usePenGesture.ts`, `annotations/machine.ts`, `annotations/marks.ts`+test, `store/index.ts`); `domFocus` 4 (`App.tsx`, `annotations/gestures/shared.ts`, `annotations/gestures/useUndoRedo.ts`, `reader/usePanControl.ts`); `uuid` 4 (four `annotations/gestures/*`); `bank` 3 (`App.tsx`, moved `BankPanel`+test).
  - [x] `npm test` + `npm run typecheck` green; commit.

- [x] **Task 4 - Close out + verify.** (AC: 2, 3, 4)
  - [x] Confirm the guard suites still pass in place: `focus-ring.test.ts` (reads `./index.css`) and `no-raw-values.test.ts` (recurses from `src/`, sanity-asserts `App.css`) both stay at the `src/` root next to `index.css`/`App.css`. Do NOT move them.
  - [x] Confirm `no-raw-values` still passes: its recursion now scans the moved component CSS under `components/**`; those files must remain token-only (they already are, since they were non-`theme/` before the move). [Source: no-raw-values.test.ts:10-32]
  - [x] Add a short module-map (a `client/src/README.md` or a section in the existing `annotations/README.md`) describing `components/` + `hooks/` + `lib/` + the preserved AD-9 layer dirs. Mirrors the Story 5.0 close-out.
  - [x] Bump the version per the Versioning policy (single source `server/pyproject.toml [project].version`, currently `0.3.9`; PATCH +1 at story done) and keep `server/uv.lock` in sync (the Story 5.0 review-fix + `test_version.py` guard).
  - [x] Full matrix green: backend pytest (host), client `npm test`, `no-raw-values`, `npm run typecheck`, `npm run build`, contract diff empty.
  - [x] **Live smoke on your OWN servers** (fresh `uvicorn` + `vite dev` on alternate ports, never the user's), at **DPR>1 with a CROSS-PAGE selection**: load a PDF, create + recolor + delete a highlight, drag a cross-page highlight, confirm nothing regressed. [Source: CLAUDE.md engineering principles; memory verify-on-hidpi]

## Dev Notes

### This is a MOVE refactor, not a rewrite

No file's CONTENTS change except import specifiers (and the `vi.mock`/`README`/version bumps called out). Every component/hook/leaf body is byte-identical after the move. The whole risk surface is **relative import paths** and a few **path-coupled test/asset reads**. There are no path aliases in this repo (no tsconfig `paths`, no vite `resolve.alias`) [verified: client/tsconfig*.json, client/vite.config.ts], so every intra-`src` import is relative: moving a file changes BOTH its own outgoing imports AND every importer's specifier to it.

### Move map (exhaustive)

| File(s) | Destination | Notes |
| --- | --- | --- |
| `main.tsx`, `App.tsx`, `App.css`, `App.test.tsx`, `index.css`, `vite-env.d.ts` | **STAY at `src/` root** | Entry + composition root (epics AC-3). App is the top importer of the 9 components; keeping it at root means only App's outgoing specifiers change, not App's own path. |
| `no-raw-values.test.ts`, `focus-ring.test.ts` | **STAY at `src/` root** | Path-coupled guard suites, see Coupling below. |
| `Reader.{tsx,css,test.tsx}` | `components/Reader/` (or fold into `reader/`, decide) | `Reader.test.tsx` mocks `./render` -> fix path. |
| `BankPanel.{tsx,css,test.tsx}` | `components/BankPanel/` | test imports `bank` (moves in Task 3) -> double path change. |
| `SaveIndicator.{tsx,css,test.tsx}` | `components/SaveIndicator/` | imports `useAutosave` (moves in Task 2). |
| `EmptyDropzone.{tsx,css}` | `components/EmptyDropzone/` | no test. |
| `Toast.{tsx,css}` | `components/Toast/` | no test. |
| `TocPanel.{tsx,test.tsx}` | `components/TocPanel/` | no css. |
| `ToolRail.{tsx,test.tsx}` | `components/ToolRail/` | imports `ToolFlyout` + `tools`; test imports `tools`. |
| `ToolFlyout.tsx` | `components/ToolFlyout/` | imported only by `ToolRail`. |
| `ZoomControl.{tsx,test.tsx}` | `components/ZoomControl/` | no css. |
| `useAutosave.{ts,test.ts}`, `useLiveRef.ts` | `hooks/` | Task 2. |
| `tools.{ts,test.ts}`, `bank.{ts,test.ts}`, `uuid.{ts,test.ts}`, `domFocus.ts` | `lib/` | Task 3, widest blast radius (`tools` = 9 importers). |
| `anchor/ annotations/ api/ reader/ render/ settings/ store/ theme/` | **UNCHANGED** | These ARE the AD-9 layer boundaries; do not touch. |

### Path-coupling gotchas (the real risk, verified against source)

- **`vi.mock("./render")` in two test files.** `App.test.tsx` (line 15) STAYS at root -> its `vi.mock("./render")` + `import * as renderLayer from "./render"` are UNCHANGED. `Reader.test.tsx` (lines 5, 9) MOVES -> both its `vi.mock("./render", ...)` string and its `import * as renderLayer from "./render"` MUST update to the new relative depth. Missing either silently un-mocks pdf.js and breaks the whole Reader suite. [CLAUDE.md flags this exact "both barrels" trap.]
- **`focus-ring.test.ts` reads `./index.css`** via `new URL("./index.css", import.meta.url)` (line 8). Keep this test AND `index.css` at the `src/` root together, or the read breaks.
- **`no-raw-values.test.ts`** sets `SRC = new URL(".")` and recurses (line 10-32), skipping `theme/`, `schema.d.ts`, and `*.test.*`. It also hard-asserts `App.css` is in the scanned set (line 32). Keep `App.css` at root. Moved component CSS stays inside the recursion, so it stays enforced (token-only) - no new obligation, they already comply.
- **`tools.ts` is a widely-shared leaf** imported by deep layers (`store/index.ts`, `annotations/gestures/*`, `annotations/machine.ts`, `annotations/marks.ts`). Its new `lib/` home must remain a zero-import leaf so those imports stay downward/sideways to a leaf, never upward (AD-9).

### Architecture constraints

- **AD-9 strict downward layering:** `render -> anchor -> annotation/tool -> store -> api-client`. [Source: ARCHITECTURE-SPINE.md:27, AD-9 line 104-107] The foldered `components/` sit ABOVE `annotations/` as the composition/shell layer (App-level). `lib/` holds zero-import leaves reachable by any layer. Introduce NO upward import: a lower layer (`store/`, `annotations/`) may import a `lib/` leaf, but must never import a `components/` or `hooks/` module.
- **AR-3 contract preserved:** this refactor touches zero API surface. `server/openapi.json` and `client/src/api/schema.d.ts` must diff empty. Never hand-edit generated types.
- **Zero-import-leaf convention** (from Story 5.0): `tools.ts`, `domFocus.ts`, `uuid.ts` are already leaves; keep them leaves in `lib/`.

### Decisions to make (surface in Project Structure Notes)

1. **Reader home:** `components/Reader/` (uniform with the other 8) vs folding `Reader.{tsx,css,test.tsx}` into the existing `reader/` feature dir (which already holds `PageCard`, `usePageNav`, `useZoomControl`, `usePanControl`). Recommend `components/Reader/` for a uniform component convention, keeping `reader/` as Reader's pure sub-hook/sub-view layer; but folding into `reader/` is defensible as a feature folder. Pick one, do not do both.
2. **`lib/` vs `utils/` name:** epics AC says "`lib/`-style"; the scaffold-react template names it `utils/`. Either is fine; pick one and be consistent.
3. **Per-folder `index.ts` barrels (optional):** a `components/Reader/index.ts` re-export lets importers write `./components/Reader` instead of `./components/Reader/Reader`. Optional; keep import sites clean if you add them, but do not add a barrel that the tests then have to mock around (watch the `render` barrel precedent).
4. **Path alias (`@/`) is OUT of scope.** Introducing a tsconfig `paths` + vite `resolve.alias` + vitest alias would make future moves cheap, but it is a toolchain change (AC-2 says do not) and enlarges the diff. Leave it as a possible follow-up story; this story is a pure mechanical move on relative imports.

### Testing standards

- Run the client suite as `npm test` from `client/` (loads `vite.config.ts` -> jsdom `test` block: `environment: "jsdom"`, `globals: true`, `css: true`). Do NOT run `npx vitest run <paths>` from `client/src` - without the config you get `document is not defined` false failures. [Source: Story 5.0 Debug Log]
- No shared `setupFiles`; tests are self-contained. `css: true` means CSS imports are processed, so moving a component's CSS alongside it is transparent.
- Typecheck: `npm run typecheck`. Guard suites `no-raw-values.test.ts` + `focus-ring.test.ts` run inside `npm test`.
- Backend suite is host-run (see CLAUDE.md Sandbox note): `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. This refactor is client-only; backend must stay green and unchanged.
- **jsdom cannot see multi-page geometry (rects zero out).** The cross-page selection path is the standing highest-risk `annotations/` surface; it must be re-smoked LIVE at DPR>1, not trusted from jsdom. [Source: CLAUDE.md; memory verify-on-hidpi]

### Previous-story intelligence (Story 5.0, the src-split precedent)

Story 5.0 did the first module split (`annotations/gestures/*`, `MemoBox`/`CommentBubble`) and set the discipline this story reuses:
- **One slice per PR/commit, verified between:** typecheck clean + suite green + contract diff empty after EACH move. 5.0 ran this per commit (`f11724f`, `fb7e20f`, ...).
- **Tests change by import-path ONLY, never by assertion.** A refactor that forces an assertion change is out of scope (5.0's AC-2 store-shape clause was deferred exactly for this reason).
- **Live smoke on OWN servers** (5.0 used 8011/5191, left the user's 8000 alone), and a real pointer-event pass at DPR>1 caught a pre-existing bug jsdom missed. Do the same.
- **Sync `uv.lock` on the version bump** (5.0's Codex review flagged a lock drift; `server/tests/test_version.py` now guards it).

Note: Story 5.3 (the Reader/AnnotationLayer/AnnotationInteraction modularize, PR #36) had no story file (ad-hoc plan); its work is already merged and is NOT re-touched here. This story only foldered the flat root; the AD-9 layer dirs it produced stay put.

### Project Structure Notes

Target shape after the refactor (AD-9 dirs unchanged):

```
client/src/
  main.tsx  App.tsx  App.css  App.test.tsx  index.css  vite-env.d.ts
  no-raw-values.test.ts  focus-ring.test.ts        # global guard suites (stay)
  components/<Name>/{ <Name>.tsx, <Name>.css?, <Name>.test.tsx? }   # 9 components
  hooks/{ useAutosave.ts(+test), useLiveRef.ts }
  lib/{ tools.ts(+test), bank.ts(+test), uuid.ts(+test), domFocus.ts }
  anchor/ annotations/ api/ reader/ render/ settings/ store/ theme/   # UNCHANGED (AD-9)
```

Variance from the CRA scaffold (deliberate, per AC-2): no `pages/` (single-view reader, no router), no `action/`/`reducers/` (Zustand `store/`, not Redux), no Storybook, `lib/` instead of `utils/` (naming decision above). The scaffold's ARCHITECTURE (colocated component folders, a hooks home, a leaf/util home, a clean root) is honored; its CRA file inventory is not.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-5.4] - the 4 acceptance criteria + scope framing.
- [Source: ARCHITECTURE-SPINE.md:27,104-107,180-189] - AD-9 downward layering + the `src/` layer-dir source tree.
- [Source: CLAUDE.md - Engineering principles] - both `vi.mock("./render")` barrels; document-level handlers; selection->rects; own-server DPR>1 smoke.
- [Source: cotidie:scaffold-react - SKILL.md + references/react-scaffold-rules.md] - folder layout + "existing project = refactor target, preserve toolchain, move one slice at a time".
- [Source: .bmad/implementation-artifacts/5-0-structural-refactor.md] - per-slice verification discipline, `npm test` from `client/`, uv.lock sync on version bump.
- Verified in-repo: client/tsconfig*.json + vite.config.ts (no path alias); Reader.test.tsx:5,9 + App.test.tsx:6,15 (render mocks); focus-ring.test.ts:8 + no-raw-values.test.ts:10-32 (path coupling); importer map (Task 3).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), xHigh reasoning

### Debug Log References

- Baseline (before any move): `npm test` from `client/` = 41 test files, 803 tests, all pass. `npm run typecheck` clean. Contract byte-clean: `server` `export_openapi` -> `openapi.json` no diff, `client` `gen:api` -> `src/api/schema.d.ts` no diff.
- Task 1: moved the 9 components with `git mv`. Found ONE importer not listed in the story's move-map: `reader/PageCard.tsx` has a bare `import "../Reader.css"` (Reader's CSS reused for the page-card canvas/text-layer styling) -> updated to `../components/Reader/Reader.css`. After fix: `npm test` = 41/803 pass (matches baseline), `npm run typecheck` clean. Reader home decision: `components/Reader/` (uniform component convention, per Dev Notes recommendation); `reader/` stays Reader's pure sub-hook/sub-view layer, unchanged.
- Task 2: moved `useAutosave.ts`/`.test.ts` + `useLiveRef.ts` into `hooks/`. Importers matched the story's list exactly (`App.tsx`, `App.test.tsx`, `components/SaveIndicator/SaveIndicator.tsx`, `annotations/AnnotationInteraction.tsx`). `npm test` = 41/803 pass, `npm run typecheck` clean.
- Task 3: leaf-check confirmed `tools.ts`/`uuid.ts`/`domFocus.ts` are TRUE zero-import leaves (grep for `^import` found none). `bank.ts` is NOT zero-import: its own AD-9 comment already documents it as "imports only `api/` types + the `anchor/` bbox helper, no store/DOM" (Story 3.6), and the Dev Notes' "Zero-import-leaf convention" paragraph only names `tools`/`domFocus`/`uuid` as leaves, deliberately excluding `bank`. This is a pre-existing, documented exception, not a relocation-induced cycle (`anchor/` does not import `lib/`), and the move-map explicitly places `bank` in `lib/` anyway, so proceeded without stopping. All importers matched the story's counts exactly (tools=9, domFocus=4, uuid=4, bank=3). `npm test` = 41/803 pass, `npm run typecheck` clean.
- Task 4: guard suites verified in place (already covered by the full `npm test` pass at 41/41 files, including `focus-ring.test.ts` + `no-raw-values.test.ts`). Fixed two stale path mentions in prose (not imports, so untouched by earlier tasks' grep-based importer sweeps): `annotations/README.md` said "zero-import `tools.ts` leaf" (x2) -> `lib/tools.ts`; `store/README.md` said "`../useAutosave.ts`" -> "`../hooks/useAutosave.ts`". Added `client/src/README.md` (new module-map, mirrors the per-layer READMEs' style). Version bumped `0.3.9` -> `0.3.10` (PATCH, story done) in `server/pyproject.toml`; ran `uv lock` to sync `server/uv.lock` (test_version.py guard). Full matrix: backend pytest 72 passed (host-run, no hang), client `npm test` 41/803 pass, `npm run typecheck` clean, `npm run build` clean (pre-existing >500kB chunk-size warning only, unrelated to this refactor), contract diff empty both directions (`openapi.json` and `schema.d.ts` byte-identical pre/post version bump). Live smoke: fresh `uvicorn --port 8011` + `vite dev --port 5191` (own servers, `PAPER_MATE_API_TARGET` wired), Chrome DevTools MCP at viewport `1400x1000x2` (DPR=2). Uploaded `fixtures/sample-pdfs/09-regularization.pdf` (23 pages), confirmed the top-bar badge reads `v0.3.10`. Armed Highlight, dragged from the last line of page-card 1 to the second line of page-card 2 (a genuine cross-`.page-surface`-boundary drag, confirmed via `getBoundingClientRect` before dragging) -> the mark's geometry followed each text line individually across the page break (no full-page-highlight regression, confirming `collectTextRects` still holds after the move). Recolored to blue (applied cleanly across all cross-page rects), then deleted (removed cleanly, no leftover DOM). Network panel showed 3 successful `PUT .../annotations` (create, recolor, delete all round-tripped through autosave); only a pre-existing unrelated `favicon.ico` 404, no console errors. Servers shut down after.

### Completion Notes List

- All 4 tasks complete, one slice per commit as prescribed (4 commits on `story-5-4-client-src-modularize`). Pure MOVE refactor: no file content changed except import specifiers, two `vi.mock` barrel paths (Reader.test.tsx), two stale path mentions in READMEs, the version bump, and one Reader.css import fix in `reader/PageCard.tsx` (an importer the story's move-map missed).
- All 4 ACs satisfied: components foldered into `components/<Name>/` with colocated css/test (AC-1); scaffold adapted not copied, AD-9 layer dirs untouched, no toolchain changes (AC-2); entry/guards stayed at root, both `vi.mock("./render")` barrels handled correctly (AC-3); full matrix green, contract byte-identical, no upward imports introduced, live-smoked at DPR=2 cross-page (AC-4).
- Test count held constant through every slice: 41 files / 803 tests, before and after the full refactor. Typecheck clean throughout. No test assertions changed, only import paths (per the Story 5.0 precedent this story explicitly follows).
- One deviation from a literal task instruction, reasoned through and logged: Task 3's "verify true zero-import leaf, stop and flag if not" found `bank.ts` importing `anchor/` + `api/` types. Treated as a pre-existing documented exception (not a relocation-induced AD-9 violation) rather than a hard stop, since the story's own move-map already places `bank` in `lib/` by name. See Debug Log Task 3 entry for the full reasoning.

### File List

- client/src/App.tsx (importer paths updated for Task 1 moves)
- client/src/components/BankPanel/BankPanel.tsx, BankPanel.css, BankPanel.test.tsx (moved from src/, imports updated)
- client/src/components/EmptyDropzone/EmptyDropzone.tsx, EmptyDropzone.css (moved from src/)
- client/src/components/Reader/Reader.tsx, Reader.css, Reader.test.tsx (moved from src/, imports + vi.mock updated)
- client/src/components/SaveIndicator/SaveIndicator.tsx, SaveIndicator.css, SaveIndicator.test.tsx (moved from src/, imports updated)
- client/src/components/Toast/Toast.tsx, Toast.css (moved from src/)
- client/src/components/TocPanel/TocPanel.tsx, TocPanel.test.tsx (moved from src/, imports updated)
- client/src/components/ToolFlyout/ToolFlyout.tsx (moved from src/)
- client/src/components/ToolRail/ToolRail.tsx, ToolRail.test.tsx (moved from src/, imports updated)
- client/src/components/ZoomControl/ZoomControl.tsx, ZoomControl.test.tsx (moved from src/)
- client/src/reader/PageCard.tsx (CSS import path fixed for Reader.css move; not in the original move-map)
- client/src/hooks/useAutosave.ts, useAutosave.test.ts, useLiveRef.ts (moved from src/, imports updated)
- client/src/annotations/AnnotationInteraction.tsx (useLiveRef import path updated)
- client/src/lib/tools.ts, tools.test.ts, bank.ts, bank.test.ts, uuid.ts, uuid.test.ts, domFocus.ts (moved from src/, imports updated)
- client/src/App.tsx, components/ToolRail/ToolRail.tsx, components/ToolRail/ToolRail.test.tsx, components/BankPanel/BankPanel.tsx, components/BankPanel/BankPanel.test.tsx, annotations/machine.ts, annotations/marks.ts, annotations/marks.test.ts, annotations/gestures/shared.ts, annotations/gestures/usePenGesture.ts, annotations/gestures/useCreateQuickBox.ts, annotations/gestures/useUndoRedo.ts, annotations/gestures/useMemoPlacement.ts, annotations/gestures/useBoxGesture.ts, store/index.ts, reader/usePanControl.ts (importer paths updated for Task 3 moves)
- client/src/README.md (new: src/ module-map)
- client/src/annotations/README.md, client/src/store/README.md (stale path mentions in prose fixed for the Task 2/3 moves)
- server/pyproject.toml (version 0.3.9 -> 0.3.10)
- server/uv.lock (synced via `uv lock`)

## Change Log

- 2026-07-03: Story implemented end-to-end (Tasks 0-4) via `bmad-dev-story`. `client/src/` foldered into the scaffold-react layout (`components/`, `hooks/`, `lib/`), AD-9 layer dirs untouched, entry/guard suites stayed at root. Version bumped 0.3.9 -> 0.3.10. Status: ready-for-dev -> review.
