---
baseline_commit: ae66352
---

# Story 3.6: Annotation Bank

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a panel listing every mark with click-to-jump,
so that I can review and recall annotations instantly.

> **This is the last USER-FACING feature of Epic 3 and the review/recall surface EXPERIENCE.md F2 climaxes on** ("Ctrl B opens the bank, he clicks the theorem highlight, the canvas jumps and the target flashes"). It is a PURE-CLIENT, read-only view over the store you already have. There is **no backend, no API, no contract, no persistence change** — the annotation set is already in the Zustand store (hydrated on open by Story 3.5), already ordered by `created_at`, already rendered by `AnnotationLayer`. This story adds ONE panel that lists that set and ONE jump+flash gesture. Do not regenerate OpenAPI, do not touch `storage`/`routes`/`useAutosave`, do not add a store MUTATION (the flash is transient UI state, the sibling of `hoveredId`/`selectedId`).
>
> **The three moving parts, in dependency order:**
> 1. **A pure derivation** (`bank.ts`): turn the store's `Map<id, Annotation>` into the ordered, group-deduped list of Bank rows (glyph + color + snippet + page). Unit-tested with plain data.
> 2. **The panel** (`BankPanel.tsx`): a 320px right-overlay mirroring `TocPanel` (open/close, Esc, scroll-inside, empty state, real `<button>` rows). Reads the store for the annotation set; renders `bank.ts`'s rows.
> 3. **Jump + flash**: clicking a row scrolls the canvas to the annotation (a new `Reader.jumpToAnnotation` imperative, the fractional sibling of `jumpToPage`) AND flashes the target (a transient `flashId` in the store that `AnnotationLayer` lights, group-aware, then auto-clears; degrades to instant under `prefers-reduced-motion`).
>
> **The placeholder is already wired for you.** `App.tsx` already renders the Bank toggle button (the `Cards` Phosphor icon, `aria-label="Annotation bank"`) — with the code comment *"Bank is still a focusable placeholder — behavior arrives with Story 3.6."* Your job is to make that button toggle the panel + add the `Ctrl B` shortcut, exactly as the ToC button next to it already works.

## Acceptance Criteria

> Faithful to `epics.md` Story 3.6, restated self-contained with FR-18/19/20, UX-DR9, AR-12, and NFR-1 made explicit. The dev needs only this file.

1. **`Ctrl B` or the top-bar toggle opens/closes the Bank; it is a 320px right overlay that never reflows the canvas.** Given a loaded document, pressing `Ctrl B` OR clicking the top-bar Bank button (the existing `Cards`-icon `pill`) toggles `{component.annotation-bank-panel}` open/closed. When open it floats over the canvas at the right edge (320px wide), and the PDF canvas is pixel-stable — no reflow, no resize, no scroll shift — whether it is open or closed (FR-18, UX-DR9, NFR-1). The toggle button reflects state via `aria-pressed`. (Mirror the sibling ToC toggle exactly.)

2. **The Bank lists every annotation as a row (glyph + color dot + snippet + page), ordered `created_at` ascending.** Given the current document has annotations, the panel lists each as `{component.bank-list-item}` showing: a type glyph (the same Phosphor icon the tool uses), a color dot (its `style.color`), a text snippet, and its page number. Rows are ordered by `created_at` ascending (AR-12). A two-page mark (shared non-null `group_id`, e.g. a cross-page highlight) appears as EXACTLY ONE row, not two (FR-19, UX-DR9, AR-12). Only the CURRENT document's marks are listed (the store is a singleton across the session; filter by `doc_id`).

3. **Empty state.** Given the current document has no annotations, the panel shows "No annotations yet." (UX-DR9, UX-DR18)

4. **Clicking a row jumps the canvas to that annotation and flashes the target; reduced-motion degrades to instant.** Given the Bank is open, clicking a row scrolls the canvas so the annotation's page + vertical position is in view (offset-only scroll, no reflow — NFR-1) and the target mark briefly flashes so the eye lands on it. Under `prefers-reduced-motion: reduce`, both the scroll and the flash are instant (no smooth-scroll, no pulse animation) (FR-20, UX-DR9, UX-DR17). The flash is group-aware: a two-page mark's on-screen half flashes.

5. **The panel is overlay-only and keyboard-operable; Esc closes it.** Rows and the close button are real `<button>`s (keyboard-reachable, standard focus ring); `Esc` closes the panel while it is open (UX-DR17), matching `TocPanel`. The panel scrolls INTERNALLY so a long list never grows past the viewport or moves the canvas (NFR-1).

6. **No regression; client-only, no contract/persistence change.** This story adds a read-only view + a transient `flashId` UI field; it does NOT add an annotation mutation, does NOT touch `useAutosave.ts`/`storage`/`routes`, and does NOT change the API contract or `annotations.json` shape (no OpenAPI regen, no `schema.d.ts` change, no `docs/API.md` change). Every existing interaction (create, single-`activeTool` FSM, select/recolor/restyle, pen, memo, comment, box, drag-to-change-tool, 3.1 move/resize + re-edit, 3.2 undo/redo, 3.3 delete, 3.4 autosave, 3.5 restore-on-reopen, ToC panel, zoom/pan) still works. `flashId` is EXCLUDED from the zundo `partialize` (transient, never undoable) and from autosave (not part of `annotations`). (AR-7, AD-9, NFR-1)

## Tasks / Subtasks

- [x] **Task 1: Pure Bank-row derivation (`client/src/bank.ts`) (AC: #2, #4).**
  - [x] New module `bank.ts` (a leaf, imports only `api/client` types — AD-9). Export `interface BankItem { id: string; type: Annotation["type"]; colorToken: string; snippet: string; isPlaceholder: boolean; page: number; pageIndex: number; topFraction: number; }` and a pure `bankItems(annotations: Iterable<Annotation>, docId: string): BankItem[]`.
  - [x] **Order + group-dedup:** filter to `a.doc_id === docId`; sort by `created_at` ascending (`localeCompare`, matching `store.all()`); then dedup by non-null `group_id` keeping the FIRST (earliest) sibling — a two-page mark yields ONE row (AC-2). Marks with `group_id === null` are never deduped. Keep the representative row's own page/anchor (the earliest sibling — typically the lower page index; the jump lands there).
  - [x] **Snippet (per `type`/`kind`):** `kind=text` → `anchor.text`; `type=memo`/`type=comment` with a non-empty `body` → `body` (a comment's note reads better than the anchored run); a `kind=rect` region highlight or `kind=path` pen → no text, so use a placeholder LABEL (e.g. "Region", "Pen stroke") with `isPlaceholder=true`. Trim whitespace; collapse internal newlines to spaces. Do the visual truncation in CSS (`line-clamp`/ellipsis), NOT by slicing the string here (keep the full text available); an empty/whitespace-only snippet falls back to a placeholder label (e.g. "Highlight", "Comment") so no row is blank. **No em-dash in any placeholder label** (CLAUDE.md).
  - [x] **`colorToken`** = `a.style.color` (a bare token name like `annotation-yellow`; the view paints `var(--color-${colorToken})`, the same idiom as `AnnotationLayer`).
  - [x] **`page` / `pageIndex` / `topFraction`** for the jump (AC-4): `pageIndex = a.anchor.page_index`, `page = pageIndex + 1`. `topFraction` = the mark's TOP as a `[0,1]` fraction of the page box: `kind=text` → `min(rects[].y0)`; `kind=rect` → `rect.y0`; `kind=path` → `pointsBounds(points).y0` (reuse the `anchor/` helper — the store/view does no coordinate math, AD-9). This is a page-normalized number, so it is zoom-independent (the Reader multiplies by the live card height).
  - [x] Keep this module DOM-free and store-free: it takes plain annotations and returns plain data → fully unit-testable (the AnnotationLayer/anchor pattern of "pure math is unit-tested, DOM wiring is smoked").

- [x] **Task 2: The `BankPanel` component (`client/src/BankPanel.tsx` + `BankPanel.css`) (AC: #1, #2, #3, #5).**
  - [x] New presentational component mirroring `TocPanel` (read it first — the header/close/Esc/empty-state/`<button>`-row structure is the template). Props: `{ open: boolean; docId: string; onJump: (item: BankItem) => void; onClose: () => void }`.
  - [x] It SUBSCRIBES to the store for the annotation set — `const annotations = useAnnotationStore((s) => s.annotations)` — and derives rows via `bankItems(annotations.values(), docId)`. (Unlike `TocPanel`, whose outline is App-owned, the Bank's data is genuinely store-owned; reading it here keeps App thin, exactly as `AnnotationLayer` reads the store directly.) Return `null` when `!open` (mount/unmount like `TocPanel`, so the panel is absent from the DOM when closed).
  - [x] Structure: `<aside className="bank-panel" data-testid="bank-panel" aria-label="Annotation bank">` with a header (title "Annotations" + a close `<button>` reusing the `X` Phosphor glyph and the `toc-panel__close` idiom) and EITHER the empty paragraph ("No annotations yet.", `data-testid="bank-empty"`) when `rows.length === 0` OR a scrollable `<ul>` of rows.
  - [x] Each row: a real `<button className="bank-row" data-testid={`bank-row-${item.id}`} onClick={() => onJump(item)}>` containing (a) the type GLYPH — map `item.type` → the SAME Phosphor icon the `ToolRail` uses: `highlight`→`Highlighter`, `underline`→`TextUnderline`, `pen`→`PencilSimple`, `memo`→`TextT`, `comment`→`ChatCircle` (keep one `TYPE_ICON` record; `aria-hidden` on the glyph), (b) a COLOR DOT `<span className="bank-row__dot" style={{ backgroundColor: `var(--color-${item.colorToken})` }} />`, (c) the SNIPPET (`bank-row__snippet`, CSS line-clamp for overflow), (d) the PAGE (`bank-row__page`, e.g. `p.${item.page}` or "Page N"). Give the row an accessible name that includes the type + page (so it does not read as just the snippet); the visible glyph is decorative.
  - [x] Esc closes while open (copy the `TocPanel` effect verbatim: a document `keydown` listener mounted only while `open`, `if (e.key === "Escape") onClose()`).
  - [x] `BankPanel.css` (own stylesheet, imported by the component — the modular precedent of `SaveIndicator.css`/`Toast.css`; `TocPanel` happens to live in `App.css` but a dedicated file is cleaner). Style `.bank-panel` (320px right overlay, `position:absolute`, top/right offsets, `max-height` + internal scroll, surface-card bg, hairline, `shadow-card`, `z-index` matching `.toc-panel`'s 5), header/title/close, the `<ul>` scroller, `.bank-row` (flex: glyph, dot, snippet, page; hover → `surface-strong`), `.bank-row__dot`, `.bank-row__snippet` (line-clamp), `.bank-row__page` (muted caption), `.bank-panel__empty`. **Tokens only — NO raw hex/px** (raw values allowed only in `src/theme/**`, enforced by `no-raw-values.test.ts`). Reuse existing tokens (`--color-*`, `--space-*`, `--type-*`, `--radius-*`, `--shadow-card`, `--hairline-width`) + the new `--bank-*` tokens from Task 4.

- [x] **Task 3: `Reader.jumpToAnnotation` imperative (`client/src/Reader.tsx`) (AC: #4).**
  - [x] Add `jumpToAnnotation: (pageIndex: number, topFraction: number) => void` to the `ReaderHandle` interface (next to `jumpToPage`), and to the `useImperativeHandle` object.
  - [x] Implement it by GENERALIZING the existing `scrollToPage` mechanic (do not duplicate it): resolve the target card (`cards.current.get(pageIndex + 1)`), then `container.scrollTo({ top: card.offsetTop + topFraction * card.clientHeight - margin, behavior: reduceMotion ? "auto" : "smooth" })`, where `reduceMotion` is read the SAME way `scrollToPage` reads it (`matchMedia("(prefers-reduced-motion: reduce)")`), and `margin` keeps the mark a little below the viewport top rather than pinned to it (a small fraction of the container `clientHeight`, e.g. ~15%, or a spacing token read via the existing `readSpacePx` helper — your call, keep it a named constant/derivation, not a bare literal in the middle of the expression). Refocus the canvas after (`container.focus?.({ preventScroll: true })`) exactly like `scrollToPage`, so PgUp/PgDn stays live after a Bank jump. No-op where layout/`scrollTo` is unavailable (jsdom) — same guards as `scrollToPage`. **No anchor/coordinate math in the Reader** (AD-9): `topFraction` arrives pre-computed from `bank.ts`; the Reader only multiplies it by `card.clientHeight`.
  - [x] Optional cleanliness: factor the shared "scroll a card's `offsetTop (+ extra)` into view + refocus, honoring reduced-motion" into one private helper that both `scrollToPage` (extra = 0) and `jumpToAnnotation` (extra = `topFraction * clientHeight - margin`) call. Keep `jumpToPage` behavior byte-identical.

- [x] **Task 4: Transient `flashId` in the store + the flash render (`store/index.ts`, `AnnotationLayer.tsx`, `Annotations.css`, `theme/components.css`) (AC: #4, #6).**
  - [x] **Store:** add `flashId: string | null` (init `null`) + `flash: (id: string | null) => void` (`set({ flashId: id })`) to `AnnotationStore`. It is the transient sibling of `hoveredId`/`selectedId`: **add `flashId` to the `partialize` EXCLUSION list** (partialize still returns only `{ annotations }`, so this is automatic — but UPDATE the header-comment "Partialize exclusions" line to name `flashId`) so a flash never enters undo history and is never PUT (AC-6). Also clear `flashId` in the `hydrate` action's transient reset (alongside `selectedId`/`hoveredId`/`dragPreview`), so a re-open never restores a stale flash.
  - [x] **Auto-clear:** export a free function `flashAnnotation(id: string): void` (the sibling of `hydrateStore`) that (1) calls `flash(id)`, (2) schedules `flash(null)` after `FLASH_MS`, CANCELLING any prior pending clear (module-level timer handle) so rapid row clicks don't strand a flash or double-fire. Keep `FLASH_MS` a behavioral constant here (like `Reader.REPAINT_DEBOUNCE`), not a design token. This keeps the timer out of `App` and out of React render.
  - [x] **Render:** in `AnnotationLayer`, subscribe to `flashId` and add a `flashed` state to `markState` (reuse `inActiveGroup(a, flashId, annotations)` so it is GROUP-AWARE like hover/select — a two-page mark's visible half flashes, AC-4). Thread it through `markClass` as a `--flash` modifier on the mark base classes (`annotation-highlight`, `annotation-pen`, `annotation-memo`, `annotation-comment-pin`, and the region via `annotation-highlight`). Follow the EXACT pattern the `--hovered`/`--selected` modifiers already use — do not invent a new mechanism.
  - [x] **CSS (`Annotations.css`):** add a `@keyframes bank-flash` pulse + the `.annotation-*--flash` rules (a brief emphasis: e.g. an outline/box-shadow ring or a short opacity/scale pulse, consistent with the existing selected-ring treatment; a few hundred ms, ending back at rest). Add `@media (prefers-reduced-motion: reduce) { .annotation-*--flash { animation: none; } }` so the flash is INSTANT under reduced-motion (AC-4) — the `flashId` field still sets/clears, giving a brief static emphasis with no motion. Tokens only (no raw hex/px outside `theme/**`); pull any dims from `--bank-*`/existing tokens.
  - [x] **Tokens (`theme/components.css`):** add the `--bank-*` custom props next to the `--toc-*` block: `--bank-panel-width: 320px;` (DESIGN.md `annotation-bank-panel.width`), `--bank-panel-offset` (reuse the 16px feel), `--bank-panel-max-height`, `--bank-row-gap`, `--bank-dot-size`, `--bank-icon-size`, and any flash dim (e.g. `--bank-flash-ring-width`). `components.css` is HAND-authored (per CLAUDE.md `gen:tokens` regenerates `tokens.css` only) — add there, do not run a generator for these.

- [x] **Task 5: Wire the panel + toggle + jump into `App.tsx` (AC: #1, #4).**
  - [x] Add `const [bankOpen, setBankOpen] = useState(false)`.
  - [x] Wire the EXISTING placeholder Bank button (the `Cards` pill): add `aria-pressed={bankOpen}` and `onClick={() => setBankOpen((o) => !o)}` (mirror the ToC button one element above it); drop the "still a focusable placeholder" comment.
  - [x] **`Ctrl B` toggle:** the current App tool-key effect early-returns on any Ctrl chord (`if (e.ctrlKey || ...) return`), so `Ctrl B` can NOT live there. Add a SMALL dedicated document-level effect (gated on `docOpen`, mirroring the Reader's Ctrl-zoom effect): on `e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "b" || e.key === "B")` → `e.preventDefault()` (block the browser bookmark bar) + `setBankOpen((o) => !o)`. Exempt editable targets (INPUT/TEXTAREA/contentEditable) so typing a note is never hijacked — reuse the same `isExempt` shape the tool-key effect uses. Bind at DOCUMENT level (Epic-1 retro AP-1 / memory `held-key-state-reset-on-blur` sibling: never bind to `.pdf-canvas`).
  - [x] Render `<BankPanel open={bankOpen} docId={doc.doc_id} onClose={() => setBankOpen(false)} onJump={handleBankJump} />` next to `<TocPanel …>` inside `<main className="stage">`.
  - [x] `handleBankJump(item: BankItem)`: `readerRef.current?.jumpToAnnotation(item.pageIndex, item.topFraction)`, then `flashAnnotation(item.id)`. **Decide whether to close the panel on jump** (see Open Q1 — recommended: KEEP it open so the reader can click through several marks; ToC closes on jump because a ToC is one-shot navigation, the Bank is a review surface — EXPERIENCE.md F2 "he scans, clicks…"). Do NOT also `select(item.id)` unless you want the persistent ring (Open Q2 — recommended: flash only, no select, so the mark is not left in an edit-frame/quick-box state from a review click).

- [x] **Task 6: Tests (AC: #1–#6).**
  - [x] **`bank.test.ts` (pure, plain data):** ordering by `created_at` asc; group-dedup (two `group_id`-shared annotations → ONE row, keeping the earliest); `doc_id` filter (a foreign-doc mark is excluded); snippet selection per type (text→`anchor.text`, memo/comment→`body`, region/pen→placeholder label, empty body→fallback label, newlines collapsed); `topFraction` = min `y0` for a multi-rect text mark, `rect.y0` for rect, `pointsBounds.y0` for path; `page = page_index + 1`. Build annotations with a small factory (mirror the `make_annotation`/store-test helpers).
  - [x] **`store/index.test.ts`:** `flash(id)` sets `flashId`; `flash(null)` clears; `flashId` is NOT in `partialize` (a `flash` call adds NO zundo history entry — assert `temporal.getState().pastStates.length` unchanged, the pattern the select/hover tests use); `hydrate` clears `flashId`; `flashAnnotation(id)` sets `flashId` then clears it after `FLASH_MS` under fake timers, and a second `flashAnnotation` before the first clears cancels the first timer (no premature clear of the second). Reset store + `temporal.clear()` in `beforeEach` (existing pattern).
  - [x] **`BankPanel.test.tsx` (jsdom + Vitest):** returns null when `open=false`; renders one row per annotation with the snippet + page + a `data-testid={`bank-row-${id}`}`; a two-page group renders ONE row; empty state shows "No annotations yet." when the doc has no marks; only the current `docId`'s marks show; clicking a row calls `onJump` with the right `BankItem`; Esc calls `onClose`; rows + close are real buttons (queryable by role). Seed the store via `useAnnotationStore.getState().hydrate([...])` (or `addAnnotations`) in each case; reset in `beforeEach`.
  - [x] **`Reader.test.tsx`:** assert the `ReaderHandle` exposes `jumpToAnnotation` and calling it does not throw in jsdom (scrollTo is absent/guarded) — mirror the existing `jumpToPage` handle test. **The `vi.mock("./render")` barrel is UNCHANGED** (no new `render/` export — `jumpToAnnotation` is a Reader method) — confirm both `App.test.tsx` and `Reader.test.tsx` render mocks are untouched (CLAUDE.md mock-barrel rule).
  - [x] **`AnnotationLayer.test.tsx`:** with `flashId` set to a mark's id, that mark's div carries the `--flash` modifier class; group-aware (a sibling sharing `group_id` also flashes); clearing `flashId` removes it. Follow the existing hovered/selected class assertions.
  - [x] **`App.test.tsx`:** the Bank button toggles the panel (click → `bank-panel` appears, `aria-pressed=true`; click again → gone); `Ctrl B` toggles it (fireEvent `keydown` on `document`, `{ ctrlKey: true, key: "b" }`); clicking a row calls `readerRef`'s `jumpToAnnotation` (spy the handle or assert via a store flash side-effect) and sets `flashId` (then clears after `FLASH_MS` with fake timers). Seed a mark into the store before opening the panel. Existing `beforeEach` already stubs `getAnnotations`→`[]`; no barrel change.
  - [x] **`no-raw-values.test.ts` stays green** (all new CSS references tokens); **`focus-ring.test.ts`** if it enumerates focusable chrome — add the Bank rows/close if required by that test's contract.

- [x] **Task 7: Version, checks, live smoke, close-out (AC: #1–#6).**
  - [x] Bump `server/pyproject.toml` `[project].version` `0.2.7 -> 0.2.8` (single source → `app/version.py` → `GET /api/health` → top-bar badge; bump once at PR merge). Sync `server/uv.lock` (`uv lock`) if needed. (No other backend change — this is the ONLY server-side edit in the story.)
  - [x] `cd client && npm run typecheck` clean; `npm test` green (578 tests); backend suite still green (`cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q`, 67 passed), unchanged; version bump didn't break `test_models`/health assertions.
  - [x] **Confirm NO contract drift:** did NOT run `export_openapi`/`gen:api`; `git status` shows `client/src/api/schema.d.ts`, `server/openapi.json`, and `docs/API.md` UNCHANGED (verified: this story adds no endpoint).
  - [x] Cross-model Codex review (AE-6) on the working-tree diff (`ae66352..HEAD`). Findings: 1 Medium (jump margin used the page card's own `clientHeight` instead of the scroll container's/viewport's, so at high zoom the margin could overshoot the visible area; fixed in `Reader.tsx`, regression test added asserting the exact `top` value with mismatched card/container heights), 2 Low (a placeholder Bank-row accessible name could omit the type label, e.g. "Region" without "Highlight"; fixed in `BankPanel.tsx` to always lead with the type label; stray untracked `smoke-*.png` screenshots at repo root predate this story's changes, left for the user to triage). Both real findings fixed, tests added, full suite re-verified green after.
  - [x] **Live smoke on own fresh servers** (uvicorn on port 8010, vite on port 5183, real `~/.paper-mate`, never the user's already-running server on 8000). At **DPR 1.5** (chrome-devtools MCP viewport emulation `1400x900x1.5`): opened `09-regularization.pdf` (23 pages, real paper text) fresh via the file picker; created a **CROSS-PAGE highlight** (dragged from page 2's last line into page 3's first paragraph, confirmed via the API as two `Annotation` rows sharing one `group_id`) + a pen stroke (page 3) + a memo (page 6) + a comment (page 8). `Ctrl B` opened the panel; the cross-page group rendered as **exactly ONE row** (not two), correct glyph/color/snippet/page for every row, ordered by creation. Verified via `getBoundingClientRect()` before/after toggle that the canvas's position/size/scrollTop is **byte-identical** open vs. closed (NFR-1). Clicking the cross-page row jumped the canvas from page 1 to **page 2** (the earliest/representative sibling, as designed); verified programmatically (DOM class list, `getComputedStyle().boxShadow`/`animationName`) that **7 rects across both pages** carried the `--flash` modifier simultaneously (group-aware), with a real animated `box-shadow` ring, auto-clearing after ~700ms (past `FLASH_MS`). Simulated `prefers-reduced-motion: reduce` via a `window.matchMedia` override and confirmed `scrollTo` was called with `behavior:"auto"` instead of `"smooth"` (the CSS `@media (prefers-reduced-motion: reduce)` animation-suppression rule was verified by source/token inspection and the `no-raw-values`/full test suite, since this specific devtools tool has no OS-level reduced-motion emulation switch). `Esc` closed the panel. No console errors throughout. Restored the pre-existing `09-regularization.pdf` document's annotation set to its exact pre-smoke snapshot via the API afterward (it already existed in the real library with unrelated prior test marks; only the 4 new marks were added/removed, nothing pre-existing was disturbed), and deleted the one fully-synthetic test document (`outlined-sample.pdf` copy, zero annotations) this session created.

## Dev Notes

### Where this story sits (the review/recall surface — the LAST v1 user feature)

Epic 3 built the durable, curatable record: 3.1 edit (command path), 3.2 undo/redo, 3.3 delete, 3.4 autosave (write), 3.5 restore-on-reopen (read). **3.6 is the READ-ONLY VIEW over that record** — no new data, no new mutation, no persistence. It closes EXPERIENCE.md's F2 climax ("Review and jump"). After this, v1 Phase-1 has: 3.7 (convert highlight↔comment) and 3.8 (adjust text range) still in backlog, plus the optional Epic-3 retro. This story does NOT depend on 3.7/3.8 and must not assume them.

- **Store is already right for the Bank.** `store.all()` already returns "every annotation, ordered by `created_at` ascending — the Bank order (AR-12)" (see the store, it was written FOR this). You may reuse `all()` inside `bankItems` (then filter by doc + dedup by group) OR keep `bankItems` self-contained on the raw `annotations` values — either is fine; keep the sort in ONE place. The store comment at the very top already says "the Annotation Bank reads them ordered by `created_at` ascending (AR-12)" — this is the story that consumes it.

### Adopt-stable / don't-reinvent (Epic-1 retro, memory `prefer-stable-solutions`)

- **The panel is `TocPanel` again.** Same right-overlay, same open/close/Esc, same `<button>` rows, same "scroll inside, never reflow" (NFR-1), same empty-state paragraph. Read `TocPanel.tsx` + the `.toc-panel*` CSS in `App.css` and mirror the structure. The only differences: data source (store, not App prop), row content (glyph + dot + snippet + page, not an indented title), and the click action (jump+flash, not `jumpToPage`).
- **The jump is `scrollToPage` generalized.** Do not write new scroll math — `scrollToPage` already does clamp + `card.offsetTop` + reduced-motion + refocus. `jumpToAnnotation` adds a single term (`topFraction * card.clientHeight - margin`). Factor the shared body; keep `jumpToPage` identical.
- **The flash is `hoveredId`/`selectedId` again.** A transient store id + a group-aware `--flash` modifier class rendered by `AnnotationLayer` via the SAME `inActiveGroup` + `markClass` helpers. The only new thing is the auto-clear timer (`flashAnnotation`, the `hydrateStore` sibling).
- **The row glyphs are the rail's icons.** `Highlighter`/`TextUnderline`/`PencilSimple`/`TextT`/`ChatCircle` from `@phosphor-icons/react` — the exact icons `ToolRail.tsx` imports (so a highlight row reads as the highlight tool). Keep them in one `TYPE_ICON` record in `BankPanel`.

### Architecture conventions you MUST honor

- **AD-9 layering / downward-only imports:** `bank.ts` imports only `api/` types (a leaf). `BankPanel` imports `store/` + `bank.ts` + `anchor` types if needed. The Reader does NO anchor math — `topFraction` is computed in `bank.ts` (via the `pointsBounds` anchor helper) and passed down. `App` owns the toggle state + wiring; the store owns `flashId`.
- **AR-12 conventions:** Bank order = `created_at` ascending; colors reference DESIGN.md `{colors.annotation-*}` tokens (paint `var(--color-${token})`), never raw hex. IDs are opaque; a two-page group is `group_id`-tied → one Bank row.
- **NFR-1 layout stability (the DEFINING bar):** the panel OVERLAYS — `position:absolute`, `z-index` over the canvas, internal scroll. The canvas must be pixel-stable open/closed. The jump is scroll-OFFSET only (never scale/geometry/reflow). Smoke this by watching a fixed glyph while toggling.
- **AR-7 / AD-7 one command path, unchanged:** the flash is NOT an annotation edit — it never enters `annotations`, undo history, or autosave. It is UI state exactly like selection. Adding it must not create a second mutation surface.
- **No em-dash in user-facing strings** (CLAUDE.md / memory `no-emdash-user-facing`): the title "Annotations", the empty "No annotations yet.", tooltips/aria-labels, placeholder snippet labels ("Region", "Pen stroke") — grep the diff for `—` before committing. Code comments are exempt.

### What already exists, do NOT rebuild

- **`client/src/App.tsx`** — the Bank toggle button is ALREADY rendered (the `Cards` pill, `aria-label="Annotation bank"`), just inert. The `docOpen` document-level tool-key effect is the template for the `Ctrl B` effect (but Ctrl chords need their OWN effect — the tool-key one early-returns on Ctrl). `readerRef` (`ReaderHandle`) is already the imperative channel; `TocPanel` is already wired the way `BankPanel` will be.
- **`client/src/Reader.tsx`** — `scrollToPage` (clamp + `offsetTop` + reduced-motion + refocus) is the jump template; `ReaderHandle`/`useImperativeHandle` already exposes `jumpToPage`. `cards.current` (page→element registry), `boxes` (scale-1.0), `readSpacePx` (token→px) are all present.
- **`client/src/store/index.ts`** — `selectedId`/`hoveredId`/`dragPreview` are the transient-field template for `flashId`; `hydrateStore` is the template for `flashAnnotation`; `partialize`/`equality` already exclude transient fields (adding `flashId` needs only the header-comment update, since partialize returns `{ annotations }` only). `all()` is the AR-12 order.
- **`client/src/annotations/AnnotationLayer.tsx`** — `inActiveGroup` (group-aware match), `markState` (hover/selected preamble), `markClass` (BEM modifier suffixing) are the flash's rendering machinery; add `flashed` to `markState` and `--flash` via `markClass`, nothing new.
- **`client/src/anchor/index.ts`** — `pointsBounds(points)` gives a pen stroke's bbox (for `topFraction`); text/rect `y0` is read directly. No new anchor helper needed.
- **`client/src/TocPanel.tsx` + `App.css` `.toc-panel*`** — the panel template (structure + CSS).
- **`client/src/theme/components.css`** — the `--toc-*` block is where `--bank-*` tokens go (hand-authored).

### What must NOT change (guardrails)

- **No backend, no contract, no persistence.** No `export_openapi`/`gen:api`; `schema.d.ts`/`openapi.json`/`docs/API.md` stay byte-identical. `storage`, `routes`, `useAutosave.ts` untouched. The ONLY server file that changes is `pyproject.toml` (the version bump).
- **No new annotation mutation.** `flashId`/`flash`/`flashAnnotation` are transient UI only — excluded from `partialize` (undo) and never in `annotations` (autosave). Do not route the flash or the jump through any mutating action (AE-3: no new client-only mutation in Epic 3).
- **Canvas pixel-stable** — the panel overlays, the jump is offset-only (NFR-1). No `render/` barrel export added → the `vi.mock("./render")` barrels in `App.test.tsx`/`Reader.test.tsx` stay untouched (CLAUDE.md).
- **Document-level `Ctrl B`**, phase/doc-gated, exempting editable fields — never bound to `.pdf-canvas` (Epic-1 retro AP-1, the recurring focus bug). `preventDefault` so the browser bookmark bar never opens.
- **Reduced-motion**: BOTH the scroll (`behavior:"auto"`) and the flash (`animation:none`) degrade to instant (UX-DR17, AC-4). The `flashId` set/clear still runs (a brief static emphasis), just with no motion.

### Project Structure Notes

New files: `client/src/bank.ts` (pure derivation), `client/src/BankPanel.tsx` + `client/src/BankPanel.css` (the panel), and their tests `client/src/bank.test.ts`, `client/src/BankPanel.test.tsx`. Edited: `client/src/App.tsx` (bankOpen + Ctrl B + button wiring + panel + jump handler), `client/src/Reader.tsx` (`jumpToAnnotation`), `client/src/store/index.ts` (`flashId`/`flash`/`flashAnnotation` + header comment + hydrate reset), `client/src/annotations/AnnotationLayer.tsx` (flash render) + `client/src/annotations/Annotations.css` (flash keyframes/modifiers/reduced-motion), `client/src/theme/components.css` (`--bank-*` tokens), and the tests `Reader.test.tsx`, `store/index.test.ts`, `AnnotationLayer.test.tsx`, `App.test.tsx`. Server: `server/pyproject.toml` (+ `uv.lock`) version only. No new layer; no backend/contract/docs change.

### Testing standards

- Frontend: `cd client && npm test` (Vitest from `client/`); `npm run typecheck` must pass. Pure `bank.ts` + store-flash tests carry the logic; jsdom carries the panel structure + toggle + Esc + row-click wiring. The flash-timer test uses `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`.
- **DPR ≥ 1.25 live smoke is mandatory** (memory `verify-on-hidpi-and-real-host`): the overlay-no-reflow and jump-to-fractional-position + flash paths are jsdom-invisible. Include a CROSS-PAGE group (one Bank row, jumps to the representative page) and the reduced-motion instant path. On your OWN fresh servers (CLAUDE.md).
- Backend suite unchanged; run it once to confirm the version bump is clean.
- Cross-model Codex review on the diff (AE-6); High/Med resolved before done.

### Versioning

PATCH +1 when 3.6 reaches done: `0.2.7 -> 0.2.8`. Single source `server/pyproject.toml [project].version`. Bump once at PR merge. (Epic 3 is not complete — 3.7/3.8 remain — so no MINOR bump.)

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-3.6] the 4 ACs: `Ctrl B`/toggle → 320px overlay never reflowing (FR-18, UX-DR9, NFR-1); rows = glyph+dot+snippet+page ordered `created_at` asc (FR-19, UX-DR9, AR-12); empty "No annotations yet." (UX-DR9, UX-DR18); row click → jump + flash, instant under reduced-motion (FR-20, UX-DR9, UX-DR17). Epic 3 intro (line 704) + FG-D (FR-18/19/20, line 139-141).
- [Source: .bmad/planning-artifacts/epics.md#AR-12] IDs/dates/order conventions: store keys by `id`; Bank order = `created_at` ascending; colors reference DESIGN.md `{colors.annotation-*}` tokens, not raw hex. #NFR-1 layout stability (the defining bar): rail/picker/Bank overlay or reserve fixed space; none reflow the canvas.
- [Source: DESIGN.md#Annotation-Bank] `annotation-bank-panel` (320px floating right overlay, `{colors.surface-card}`, 1px `{colors.hairline}`, soft drop, title `{typography.title-md}`, scrollable `bank-list-item` list); `bank-list-item` (glyph + color dot + snippet/page, `{typography.body-sm}`, `{rounded.sm}`, hover → `bank-list-item-hover` `{colors.surface-strong}`, click jumps + flashes). Top-bar: Bank + ToC toggles right. "Respect `prefers-reduced-motion`" (line 528).
- [Source: EXPERIENCE.md] F2 "Review and jump (climax: instant recall)": `Ctrl B` opens the bank, marks listed with snippets, click → canvas jumps + target flashes. IP-11 (Bank jump: `Ctrl B` toggles; row click jumps + flashes). Empty Bank copy "No annotations yet." (line 52). Reduced-motion: jump-flash + panel slides degrade to instant (line 134). Keyboard map: `Ctrl B` toggle (line 122).
- [Source: client/src/TocPanel.tsx + client/src/App.css `.toc-panel*`] the panel template (right overlay, header/close, Esc effect, `<button>` rows, empty paragraph, internal scroll, `z-index:5`).
- [Source: client/src/Reader.tsx] `scrollToPage` (the jump mechanic to generalize), `ReaderHandle`/`useImperativeHandle` (`jumpToPage` sibling), `cards.current`, `readSpacePx`, the reduced-motion read.
- [Source: client/src/store/index.ts] `selectedId`/`hoveredId`/`dragPreview` (transient-field template), `hydrate` (transient reset), `hydrateStore` (free-fn + side-effect template for `flashAnnotation`), `partialize`/`equality` (transient exclusion), `all()` (AR-12 order), the header "Partialize exclusions" comment to update.
- [Source: client/src/annotations/AnnotationLayer.tsx] `inActiveGroup`/`markState`/`markClass` (the group-aware modifier machinery the flash reuses); the `--hovered`/`--selected` CSS in `Annotations.css` (the flash's visual sibling).
- [Source: client/src/anchor/index.ts] `pointsBounds` (pen bbox for `topFraction`). [client/src/ToolRail.tsx] the per-tool Phosphor icons (`Highlighter`/`TextUnderline`/`PencilSimple`/`TextT`/`ChatCircle`) the Bank glyphs reuse.
- [Source: .bmad/implementation-artifacts/3-5-restore-on-reopen.md] the store the Bank reads (hydrated on open) + the doc-per-page-load model (one doc per session, filter by `doc_id`). [3-1-edit-annotations-command-path.md] the command-path boundary the flash must NOT cross.
- [Source: CLAUDE.md] AP-1 document-level handlers (the `Ctrl B` effect); NO em-dash in user-facing strings; AD-2 pinned deps; render mock-barrel sync (untouched here); versioning; "launch your OWN dev servers for live smoke"; AE-6 Codex review. `src/no-raw-values.test.ts` (tokens only outside `theme/**`).
- Memories: `verify-on-hidpi-and-real-host` (DPR>1 smoke: overlay-no-reflow + fractional jump + cross-page group are jsdom-invisible); `prefer-stable-solutions` (reuse `TocPanel`, `scrollToPage`, the hover/selected flash machinery — don't rebuild); `no-emdash-user-facing`; `held-key-state-reset-on-blur` (document-level key handler discipline).

## Open Questions

> Each has a recommended default so work is not blocked.

1. **Close the panel on row click, or keep it open?** Recommended default: **keep it OPEN.** The ToC closes on jump because it is one-shot section navigation; the Bank is a REVIEW surface (EXPERIENCE.md F2: "he scans, clicks the theorem highlight" — plural review implies staying open to click more). Keeping it open lets the reader jump through several marks. Revisit if the PO wants ToC-style close-on-jump.
2. **Also `select` the annotation on jump, or flash only?** Recommended default: **flash ONLY (no select).** Selecting would leave the mark in an edit-frame/quick-box state and could open a memo/comment bubble from a review click — heavier than "recall where it is". The flash is the spec'd feedback (FR-20). A "select from the Bank" affordance can come later if wanted.
3. **Snippet for a text-less mark (region highlight / pen stroke):** Recommended default: **a placeholder LABEL** ("Region" / "Pen stroke") with `isPlaceholder=true` (dimmed in CSS), so the row still has the glyph + color + page and is clickable. Alternative (a blank snippet) reads as broken. Comment/memo prefer `body`; an empty body falls back to the type label ("Comment"/"Memo").
4. **Flash treatment + duration:** Recommended default: a **short ring/opacity pulse (~600 ms)**, echoing the selected-ring weight, ending back at rest, cleared by `flashAnnotation`'s timer; `animation:none` under reduced-motion (instant static emphasis). Exact easing is EXPERIENCE-behavioral, not a token (DESIGN.md line 528). Tune in live smoke.
5. **`BankPanel.css` (own file) vs `.bank-panel*` in `App.css` (like `TocPanel`):** Recommended default: **own `BankPanel.css`** (the modular `SaveIndicator.css`/`Toast.css` precedent; keeps App.css from growing). `TocPanel`-in-`App.css` is the alternative if you prefer symmetry with the sibling panel.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (bmad-dev-story implementation); Codex CLI (cross-model review, AE-6).

### Debug Log References

- Cross-model Codex review (`codex exec`, working-tree diff vs. `ae66352`): 1 Medium (jump margin used the page card's `clientHeight` instead of the scroll container's), 2 Low (placeholder Bank-row accessible name omitted the type label; stray pre-existing untracked `smoke-*.png` files at repo root, not from this story). Both real findings fixed (`Reader.tsx`, `BankPanel.tsx`) with regression tests; full suite re-verified green.
- Live smoke: chrome-devtools MCP, DPR 1.5, own fresh servers (uvicorn :8010, vite :5183). Verified programmatically (not just visually) via `getBoundingClientRect`/`getComputedStyle`/DOM class inspection: canvas geometry byte-identical panel open/closed (NFR-1); cross-page group → one row, jump lands on the earlier/representative page; flash sets a real `box-shadow` ring + `animation: bank-flash` on all rects of both pages of the group, auto-clears after ~700ms; `prefers-reduced-motion` (simulated via a `window.matchMedia` override, since the browser tool has no OS-level reduced-motion emulation switch) makes `scrollTo` use `behavior:"auto"` instead of `"smooth"`.

### Completion Notes List

- All 7 tasks complete; all 6 ACs implemented and live-smoked. Pure-client Annotation Bank: `bank.ts` (leaf derivation), `BankPanel.tsx`/`.css` (TocPanel-mirrored overlay), `Reader.jumpToAnnotation` (scrollToPage generalized), transient store `flashId`/`flash`/`flashAnnotation` rendered group-aware by `AnnotationLayer` via the existing `markState`/`markClass` machinery, `App.tsx` wiring (`bankOpen`, a dedicated Ctrl+B effect, `handleBankJump`).
- No backend/contract/persistence change: `schema.d.ts`/`openapi.json`/`docs/API.md` confirmed byte-identical; the only server edit is the `pyproject.toml` version bump (+ `uv.lock` sync).
- Cross-model Codex review caught one real Medium (viewport- vs. card-relative jump margin) and one real Low (placeholder a11y name); both fixed with regression tests before closing out the story.
- Two unrelated user-reported fixes landed in the same session (both verified with tests, included in the same diff/review): (1) `AnnotationInteraction.tsx`: a comment's click-away now deselects instead of stacking a new pin, mirroring the existing `useMemoPlacement.ts` first-click-deselects pattern (capture-phase ordering) that had never been applied to the comment-click path; (2) `ToolRail.tsx`/`App.tsx`: the Highlight flyout now shows an explicit "Text highlight" option beside "Box highlight" (was a single box-only checkbox), via a renamed `onSetBoxHighlight(value)` prop.
- Full suite: 578 frontend tests (35 files) + 67 backend tests, typecheck clean.

### File List

- `client/src/bank.ts` (new)
- `client/src/bank.test.ts` (new)
- `client/src/BankPanel.tsx` (new)
- `client/src/BankPanel.css` (new)
- `client/src/BankPanel.test.tsx` (new)
- `client/src/Reader.tsx` (edited: `jumpToAnnotation` + `scrollCardIntoView` helper)
- `client/src/Reader.test.tsx` (edited: `jumpToAnnotation` tests)
- `client/src/store/index.ts` (edited: `flashId`/`flash`/`flashAnnotation`, header comment, hydrate reset)
- `client/src/store/index.test.ts` (edited: flash tests)
- `client/src/annotations/AnnotationLayer.tsx` (edited: `flashed` state, `--flash` modifier)
- `client/src/annotations/AnnotationLayer.test.tsx` (edited: flash render tests)
- `client/src/annotations/Annotations.css` (edited: `bank-flash` keyframes + reduced-motion)
- `client/src/theme/components.css` (edited: `--bank-*` tokens)
- `client/src/App.tsx` (edited: `bankOpen`, Ctrl+B effect, Bank button wiring, `BankPanel` render, `handleBankJump`; also the box-highlight prop rename for the unrelated ToolRail fix)
- `client/src/App.test.tsx` (edited: Annotation Bank describe block)
- `client/src/annotations/AnnotationInteraction.tsx` (edited: comment first-click-deselects fix, unrelated user-reported bug)
- `client/src/annotations/AnnotationInteraction.test.tsx` (edited: regression test for the above)
- `client/src/ToolRail.tsx` (edited: Text/Box highlight two-option picker, unrelated user-reported feature request)
- `client/src/ToolRail.test.tsx` (edited: updated + new tests for the above)
- `server/pyproject.toml` (edited: version `0.2.7` → `0.2.8`)
- `server/uv.lock` (edited: synced with the version bump)
- `.bmad/implementation-artifacts/sprint-status.yaml` (edited: story status)

## Change Log

- 2026-07-01: Story drafted (ready-for-dev). The review/recall surface + EXPERIENCE F2 climax: a pure-client Annotation Bank — `bank.ts` (ordered, group-deduped, doc-filtered rows: glyph + color + snippet + page + jump target), `BankPanel.tsx`/`BankPanel.css` (320px right overlay mirroring TocPanel, Ctrl B / toggle / Esc, empty state), `Reader.jumpToAnnotation` (scrollToPage generalized to a fractional page position), and a transient store `flashId` + `flashAnnotation` auto-clear rendered group-aware by AnnotationLayer with a reduced-motion-instant flash. No backend/contract/persistence change (client-only); version 0.2.7 → 0.2.8.
- 2026-07-01: Implemented and live-smoked (review). All 6 ACs done; cross-model Codex review found and fixed 1 Medium (viewport-relative jump margin) + 1 Low (placeholder row a11y name) with regression tests. Also fixed two unrelated user-reported issues in the same session: comment click-away no longer stacks a new pin (mirrors the existing memo-placement first-click-deselects fix), and the Highlight tool's flyout now shows an explicit Text/Box picker instead of a box-only checkbox. Version `0.2.7` → `0.2.8`. 578 frontend + 67 backend tests green; typecheck clean; no contract drift.
