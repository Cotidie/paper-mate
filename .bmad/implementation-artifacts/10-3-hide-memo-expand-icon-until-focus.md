---
baseline_commit: 7122e0b4175088346b084592abdf7b44a0202357
---

# Story 10.3: Hide the memo expand icon until hover or focus

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the memo expand icon hidden until I hover or focus the memo,
so that idle memos stay clean and unobtrusive.

## Acceptance Criteria

1. **(Idle = hidden, item 4, UX-DR minimal-chrome)** Given a memo that is neither hovered nor focus-within, when it renders, then its expand/collapse chevron (`.memo-collapse-toggle`) is visually hidden — the memo shows only its box + content (expanded textarea or collapsed `(...)` preview), keeping idle chrome minimal.
2. **(Reveal on hover OR focus-within, item 4, UX-DR17)** Given the memo is hovered OR has focus-within (its textarea focused, a resize handle focused, or the chevron itself focused), then the chevron appears and is fully clickable/keyboard-operable, and its appearing/disappearing does NOT shift the memo's layout or the page.
3. **(Keyboard reachability, UX-DR17)** Given keyboard-only use, then the chevron is reachable whenever the memo is focused — never hover-only. Reaching it (tabbing onto it) must itself reveal it: a COLLAPSED memo has no textarea, so the chevron is the only focusable control inside it, and it must stay in the tab order and focusable while hidden so a keyboard user can focus it to expand the memo.
4. **(No regression)** Given the change, then it does not regress: the toggle still renders in the DOM and still toggles `style.collapsed` on click (Story 2.9 collapse feature + its tests); the toggle stays a child of `.annotation-memo` so every `.closest(".annotation-memo")` gate still treats a press on it as "on the mark" ([[icon-button-swallowed-by-exempt-check]]); Story 10.2's edit handles, resize, and z-index behavior are untouched. Live-smoked at DPR>1.

## Tasks / Subtasks

- [x] **Task 1 — Gate the chevron reveal on hover + focus-within, CSS-only (AC: #1, #2, #3).** In `client/src/annotations/Annotations.css`, change `.memo-collapse-toggle` from always-visible to hidden-by-default, revealed when its memo is hovered or has focus-within. Mirror the EXISTING in-repo reveal-on-hover pattern verbatim (do NOT invent a new one) — `FolderPanel.css` `.folder-panel__row-actions` / `.library-folder-panel__trash-action` and `CollectionTable.css` `.collection-table__open-button` all do exactly this:
  - Base rule: add `opacity: 0;` and change `pointer-events: auto;` → `pointer-events: none;`, plus `transition: opacity 0.1s ease-out;` (the codebase's de-facto reveal fade — same `0.1s ease-out` those three controls use; the "short fade vs instant" open call is decided: short fade, matching precedent).
  - Reveal rule: `.annotation-memo:hover .memo-collapse-toggle, .annotation-memo:focus-within .memo-collapse-toggle { opacity: 1; pointer-events: auto; }`.
  - **Do NOT use `display:none` or `visibility:hidden`** — both drop the `<button>` out of the tab order, which would make a collapsed memo permanently un-expandable by keyboard (breaks AC #3). `opacity:0` + `pointer-events:none` keeps the button keyboard-focusable; `:focus-within` then reveals it. This is precisely how `.library-folder-panel__trash-action:focus-visible { opacity:1 }` works in-repo.
  - `.annotation-memo:focus-within` covers all three focus cases at once (textarea, a resize handle, or the chevron itself), so no separate `.memo-collapse-toggle:focus`/`:focus-visible` reveal rule is needed. Leave the existing `.memo-collapse-toggle:hover` (background) and `:focus-visible` (outline) rules as-is.
- [x] **Task 2 — Update the now-stale comments (AC: #1).** The chevron is no longer "always present": update the CSS comment on `.memo-collapse-toggle` (currently "Always present (not selection-gated)...") and the `MemoBox.tsx` header comment to say it is hidden until the memo is hovered or focus-within (still not selection-gated — hover/focus, not selection, reveals it; a reader can still expand/collapse WITHOUT selecting). Keep the DOM-nesting rationale intact ("ALWAYS nested INSIDE `.annotation-memo`" is about `closest()`, not visibility — it stays true).
- [x] **Task 3 — Tests (AC: #4).** No JS/logic change, so no new behavior test is required; the reveal itself is CSS `:hover`/`:focus-within`, which jsdom does not evaluate (LIVE-SMOKE only, note it in the Dev Agent Record). Guard against regression:
  - Run the existing suite — `AnnotationLayer.test.tsx` already asserts the toggle renders (`getByTestId("memo-collapse-toggle-m1")`) and that clicking it calls `setMemoCollapsed(id, true/false, ...)`. These must stay green unchanged (`fireEvent.click` ignores CSS `pointer-events`, so a `pointer-events:none` base does not break them).
  - Optional light assertion (add only if it reads naturally): the toggle is a real `<button>` with no `disabled` / no `tabIndex="-1"`, documenting that it stays keyboard-focusable while hidden.
- [x] **Task 4 — Live smoke at DPR>1 (AC: #1, #2, #3), own dev servers, real paper.** With YOUR OWN `uvicorn` + `vite dev` (never a user-launched/Docker server — CLAUDE.md) and an explicit throwaway `PAPER_MATE_DATA` sandbox dir (see the 10.2 process note — the bare dev flow defaults to `~/.paper-mate`, the user's REAL library; pass a scratch dir so you never touch it), on a real paper at DPR 2: create a memo; (a) idle (pointer away, not focused): chevron is not visible; (b) hover the memo box: chevron fades in and is clickable → collapses/expands; (c) click into the textarea (focus): chevron visible while editing; (d) collapse the memo, then move focus away (chevron hidden), then TAB to reach the chevron with keyboard only → it reveals on focus and Enter/Space expands it; (e) confirm no layout shift of the box/page as it appears/disappears; (f) re-check at a second zoom level. Delete the transient test memo afterward and verify the doc's `annotations.json` is clean.
- [x] **Task 5 — Backend unaffected.** Client-only, CSS + comments only. No `server/` file, no OpenAPI contract change, `docs/API.md` untouched, no store/anchor change. No version bump in this change (happens at PR-merge time per CLAUDE.md versioning).

## Dev Notes

### What "expand icon" is (resolves the open design call)

There is exactly ONE expand/collapse control on a memo: the chevron button `.memo-collapse-toggle` in `MemoBox.tsx` (rendered `CaretUp` when expanded, `CaretDown` when collapsed; `data-testid=memo-collapse-toggle-<id>`, `aria-label`/`title` "Collapse memo"/"Expand memo"). The user's "expand icon" = this chevron. There is no separate control. So "expand" = the collapse/expand toggle (the open call in epics.md is decided).

### The change is CSS-only — one proven in-repo pattern, do not hand-roll

This is a presentation gate, nothing else. `MemoBox.tsx` needs no logic change (only a comment refresh). The reveal is the SAME pattern the codebase already ships for three reveal-on-hover controls — reuse it verbatim so behavior is identical and reviewed once:

- `client/src/library/FolderPanel/FolderPanel.css:148-155` (`.folder-panel__row-actions`): `opacity:0; pointer-events:none; transition: opacity 0.1s ease-out;` revealed by `.folder-panel__row:hover .folder-panel__row-actions, .folder-panel__row-actions:focus-within { opacity:1; pointer-events:auto; }`.
- `client/src/library/FolderPanel/FolderPanel.css` (`.library-folder-panel__trash-action`): same base, revealed by `...:hover ...` OR `.library-folder-panel__trash-action:focus-visible`.
- `client/src/library/CollectionTable/CollectionTable.css:600-619` (`.collection-table__open-button`): same base, revealed by `tr:hover ...` OR `...:focus-visible`.

Apply the identical shape to `.memo-collapse-toggle`, keying the reveal off `.annotation-memo:hover` and `.annotation-memo:focus-within`.

### Why `opacity` (not `display`/`visibility`) — this is the whole subtlety of AC #3

A COLLAPSED memo renders NO textarea (it renders the `.annotation-memo__preview` div, non-editable). The chevron is then the ONLY focusable control inside that memo, and it's the only way to expand it. If the hidden chevron is `display:none` or `visibility:hidden`, it leaves the tab order → a keyboard-only user can never focus it → a collapsed memo becomes permanently un-expandable by keyboard. `opacity:0` + `pointer-events:none` keeps the `<button>` in the tab order and keyboard-focusable (CSS opacity/pointer-events do NOT affect focusability or keyboard activation); tabbing onto it fires `.annotation-memo:focus-within`, which reveals it. This is exactly why the in-repo precedents reveal on `:focus-within`/`:focus-visible` and never use `display`/`visibility`.

### `:focus-within` covers every focus case in one selector

`.annotation-memo:focus-within` matches when focus is on the textarea (editing / selected memo autofocuses via `autoFocus={selected}`), on a Story-10.2 resize handle button, OR on the chevron itself. So one reveal selector satisfies AC #2's "textarea or a control focused" and AC #3's keyboard reach. No per-child focus rule needed.

### No layout shift is inherent (AC #2)

`.memo-collapse-toggle` is `position:absolute` (straddles the box's bottom-center edge, half below it, `translate(-50%, calc(100% + var(--space-xxs)))`). Toggling `opacity`/`pointer-events` changes nothing in flow — zero layout shift on the memo box or the page. Nothing extra to do for the "no shift" AC.

### Micro-behavior to expect during smoke (not a bug)

The chevron sits half BELOW the box and is `pointer-events:none` while hidden, so hovering the empty region just under the box does NOT reveal it — the reveal trigger is hovering the memo BOX itself (then the chevron becomes `pointer-events:auto` and clickable, even though it renders slightly below the box). This matches the folder/table precedents (revealed action lives within/adjacent to the hovered parent) and is the intended "hover the memo" gesture. A bonus side effect: while hidden, the chevron's below-box footprint no longer intercepts clicks meant for the page under the memo.

### prefers-reduced-motion

The three existing reveal controls do NOT gate their `0.1s` opacity fade under `prefers-reduced-motion` (only the flash-pulse `@keyframes` are gated, `Annotations.css:1210-1221`). A 0.1s opacity fade is negligible motion; match precedent — do NOT add a reduced-motion override for it (consistency over churn). UX-DR17's reduced-motion clause targets jump-flash/panel-slide, not a 100ms control fade.

### Token / raw-value rules (AD-4 design contract, enforced by `src/no-raw-values.test.ts`)

`no-raw-values.test.ts` forbids only raw hex (`#…`) and raw px (`\d+px`) outside `src/theme/**`. `opacity: 0` / `opacity: 1`, `pointer-events`, and `transition: opacity 0.1s ease-out` are all allowed (opacity literals and the `0.1s` timing appear verbatim in the existing reveal controls and pass the test). Do not introduce any hex or px. No new token needed.

### Source tree — files to touch

- `client/src/annotations/Annotations.css` — `.memo-collapse-toggle` (lines ~583-625): base rule gets `opacity:0` + `pointer-events:none` (was `auto`) + `transition: opacity 0.1s ease-out`; add the `.annotation-memo:hover .memo-collapse-toggle, .annotation-memo:focus-within .memo-collapse-toggle { opacity:1; pointer-events:auto; }` reveal rule; refresh the "Always present" comment. Leave `:hover` (bg) and `:focus-visible` (outline) rules unchanged.
- `client/src/annotations/MemoBox.tsx` — header comment only (lines ~8-18): note the chevron is hidden until hover/focus-within. No JSX/logic change.

### Regressions to guard (AC #4)

- **Story 2.9 collapse/expand:** the toggle still renders and still calls `onToggleCollapse` → `setMemoCollapsed`; `AnnotationLayer.test.tsx`'s toggle-render + click tests stay green (jsdom `fireEvent.click` ignores CSS `pointer-events`).
- **`.closest(".annotation-memo")` gates ([[icon-button-swallowed-by-exempt-check]]):** the chevron stays a child of `.annotation-memo`, so `useSelection`'s deselect guard, `useMultiSelectGesture`'s on-mark check, and the `useEditGesture` exclusion still treat a press on it as "on the mark." Unchanged (DOM position untouched).
- **Story 10.2 edit handles / resize / z-index:** untouched. `.edit-handle`/`.edit-handle--*` (including the `.annotation-memo > .edit-handle--*` border-compensation overrides) and the `editable` inline `z-index:1` are separate rules; do not touch them. Note the resize handles also live inside `.annotation-memo`, so they too fall under `:focus-within` — fine (they're the Story-10.2 selection frame; when a memo is selected/editing the chevron showing is expected).
- **Auto-grow, move-grip, empty-space drag-to-move:** all in `MemoBox.tsx` JSX/effects — untouched by a CSS-only + comment change.

### Testing standards

- Frontend: Vitest (`cd client && npm test`), typecheck (`npm run typecheck`). No `render/index.ts` export change → the two `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) need no edit.
- jsdom has no layout and does not compute `:hover` from a stylesheet, so the reveal is a LIVE-SMOKE assertion (AC #1-#3), not a jsdom test — same posture as Story 10.2's frame-tracking. Unit coverage is the existing toggle render/click regression guard.
- **Live smoke is mandatory at DPR>1 on a real paper with YOUR OWN dev servers and an explicit throwaway `PAPER_MATE_DATA`** (Story 10.2 process note: the bare dev flow defaults to `~/.paper-mate`, the user's real library; never smoke against it). Prefer trusted input for the keyboard-reach check (real Tab/Enter). `claude-in-chrome` was unavailable in Stories 10.1/10.2 (fell back to `chrome-devtools-mcp`, `emulate({viewport:"1400x900x2"})` for DPR 2) — if it's still down, note the deviation and use the same fallback.

### Project Structure Notes

- Downward-dependency rule holds: this is a pure presentation change in the `annotations/` component layer (CSS + one comment). No `anchor/`, no `store/`, no contract touched. The chevron-vs-handle handle-markup duplication from Story 10.2 is explicitly Story 10.9's (terminal refactor) concern, not this story's — do not refactor it here.

### References

- Epic + ACs: [Source: .bmad/planning-artifacts/epics.md#Story 10.3] (lines 2338-2358, incl. the "expand icon" / reveal-trigger / fade open design calls this story resolves).
- FR-10 (memo): [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md#FR-10] (L52). UX-DR17 (accessibility floor: every action keyboard-operable, 2px ink focus rings, respect prefers-reduced-motion): [Source: .bmad/planning-artifacts/epics.md] (L124). UX minimal-chrome principle (UI recedes behind content): [Source: CLAUDE.md#Design conventions] + DESIGN.md.
- Prior story continuity (own dev servers + explicit throwaway `PAPER_MATE_DATA`, DPR>1 smoke, delete transient test data, `claude-in-chrome`-unavailable fallback): [Source: .bmad/implementation-artifacts/10-2-memo-resize-handle-position-min-size.md] (Dev Agent Record, esp. the "wrong data directory" process note).
- Code touch points (verbatim, current):
  - Target chevron: `client/src/annotations/MemoBox.tsx:138-152` (button) + header comment `MemoBox.tsx:8-18`; CSS `client/src/annotations/Annotations.css:583-625` (`.memo-collapse-toggle` + `:hover` + `:focus-visible` + `svg`).
  - The reveal-on-hover pattern to mirror: `client/src/library/FolderPanel/FolderPanel.css:148-155` and `:218-235`; `client/src/library/CollectionTable/CollectionTable.css:600-619`.
  - Regression anchors: toggle tests `client/src/annotations/AnnotationLayer.test.tsx:857-936`; `.closest(".annotation-memo")` memory [[icon-button-swallowed-by-exempt-check]]; Story 10.2 handle CSS `client/src/annotations/Annotations.css:1059-1088`.
  - `no-raw-values.test.ts` scope (only hex + px forbidden): `client/src/no-raw-values.test.ts`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Own dev servers (not any user-launched instance): backend `uv run uvicorn app.main:app --port 8091` with an explicit throwaway `PAPER_MATE_DATA` (`/tmp/claude-.../scratchpad/paper-mate-data`, never `~/.paper-mate`), frontend `npm run dev -- --port 5193` (`PAPER_MATE_API_TARGET=http://127.0.0.1:8091`). Uploaded `fixtures/sample-pdfs/1903.03295v2.pdf` via `POST /api/docs` to get a fresh `doc_id` in the throwaway library (no upload-through-UI needed).
- `claude-in-chrome` unavailable this session (`tabs_context_mcp` returned "Browser extension is not connected") — same recurring gap as Stories 10.1/10.2. Fell back to `chrome-devtools-mcp`, `emulate({viewport:"1400x900x2"})` for a real DPR-2 Chrome instance (AE7-2 still open).
- Two other stray `chrome-devtools-mcp` pages were already open pointing at unrelated ports (5273, 5183) from other sessions/instances — left entirely untouched; all smoke ran only against the newly-opened page on my own port 5193.
- Verified CSS reveal state via `getComputedStyle`/`:matches()` in `evaluate_script` (opacity, pointer-events, `:hover`/`:focus-within`) rather than pixel-peeking screenshots — more reliable and catches the exact mechanism the story cares about. One instructive false alarm: a synchronous `getComputedStyle` read taken in the same script turn as `element.focus()` reported `opacity:"0"` even though `:focus-within` already matched and `pointer-events` had already flipped to `"auto"` — the read landed mid-transition before the 0.1s opacity animation resolved. Re-read after an `await new Promise(r=>setTimeout(r,200))` showed the correct settled `opacity:"1"`. Not a bug: an artifact of reading a CSS-transitioning property synchronously; documented here in case a future story hits the same read-timing trap.
- Keyboard-reach check (AC #3): moved focus to `.memo-collapse-toggle` via `element.focus()` (a real `focus` event, indistinguishable from a Tab landing for `:focus-within` purposes) rather than counting real Tab-stops through the whole toolbar/page chrome, then pressed a REAL `Enter` key (`press_key`, trusted input) to confirm keyboard activation — expanding a COLLAPSED memo (the case with no textarea, chevron is the only focusable control) worked end-to-end: reveal-on-focus, then Enter toggled `collapsed: false`.
- Confirmed no layout shift (AC #2) by diffing `getBoundingClientRect()` of `.annotation-memo` between idle and hover/focus states at 313% zoom — identical `x/y/width/height`, as expected for an `opacity`-only change on a `position:absolute` child.
- Re-verified the reveal (idle→hidden, hover→shown) at a second in-app zoom level (200% → 313%, via the app's own Zoom-in control, not just the Chrome DPR emulate) per Task 4(f).
- Deleted the transient test memo via the app's own Delete-key command path afterward; confirmed the throwaway sandbox's `library/<doc_id>/annotations.json` reads `{"schema_version":1,"annotations":[]}`. The user's real `~/.paper-mate` was never touched (a separate throwaway `PAPER_MATE_DATA` was passed to the backend for this entire session, per the Story 10.2 process-note follow-up).

### Completion Notes List

- **Task 1 (CSS reveal gate).** `.memo-collapse-toggle` (`Annotations.css`) base rule changed from `pointer-events: auto` (always-visible) to `opacity: 0; pointer-events: none; transition: opacity 0.1s ease-out;` — mirrors the in-repo `.folder-panel__row-actions` / `.collection-table__open-button` reveal-on-hover pattern verbatim (same `0.1s ease-out`). Added `.annotation-memo:hover .memo-collapse-toggle, .annotation-memo:focus-within .memo-collapse-toggle { opacity: 1; pointer-events: auto; }`. Deliberately opacity-only, not `display`/`visibility` (the AC #3 subtlety: a collapsed memo has no textarea, so the chevron is its only focusable control — hiding it from the tab order would make a collapsed memo permanently un-expandable by keyboard). Existing `:hover` (bg) and `:focus-visible` (outline) rules untouched.
- **Task 2 (comments).** Refreshed the `.memo-collapse-toggle` CSS comment and the `MemoBox.tsx` header comment to describe the new hover/focus-within reveal (no longer "Always present"); kept the DOM-nesting (`.closest(".annotation-memo")`) rationale intact since it's unaffected by visibility.
- **Task 3 (tests).** No JS/logic change, so no new behavior test needed; added one light regression assertion (`AnnotationLayer.test.tsx`) documenting that the toggle stays a real, non-disabled, `tabIndex=0` `<button>` on a COLLAPSED memo (guards against a future accidental `display:none`/`disabled` regression that would silently break AC #3). All pre-existing toggle render/click/collapse tests pass unchanged (`fireEvent.click` ignores CSS `pointer-events`). Full suite: 1549/1549 passing (1548 + 1 new), typecheck clean.
- **Task 4 (live smoke, DPR 2, own throwaway sandbox).** Every AC verified via direct DOM/CSS assertions in `chrome-devtools-mcp`'s `evaluate_script` (`getComputedStyle` + `:matches()`), not just visual screenshots:
  - AC #1 (idle→hidden): fresh memo (non-empty body, so it survives deselect), mouse and focus both elsewhere → `opacity:"0"`, `pointerEvents:"none"`.
  - AC #2 (hover reveal + no shift): hovering `.annotation-memo` (via the tool's real-mouse `hover`, not a synthetic event) → `opacity:"1"`, `pointerEvents:"auto"`, confirmed visually in a screenshot too. Focus-within reveal tested independently of hover (clicked into the textarea, then moved the mouse elsewhere) → still `opacity:"1"` via `:focus-within`, `:hover` false — proving the two triggers are independent, matching the AC's "hovered OR focus-within" wording exactly. `getBoundingClientRect()` identical between idle and revealed states (opacity-only change, no reflow).
  - AC #3 (keyboard reach on a COLLAPSED memo): collapsed the memo, deselected (Escape; stayed alive since non-empty), confirmed idle-hidden, then focused the toggle directly (equivalent to a Tab landing) → revealed via `:focus-within`; pressed a real Enter key → the memo expanded (`collapsed` flipped to `false`), proving the hidden-but-focusable design works end-to-end for the exact case the AC calls out (no textarea to fall back on).
  - AC #4 (no regression): Story 10.2's move/resize handles rendered correctly when the memo was selected+expanded (visible in the accessibility snapshot: "Move annotation" + 4× "Resize annotation" buttons); the toggle stayed inside `.annotation-memo` throughout (DOM position unchanged, so `.closest()` gates are unaffected); re-verified the hover/idle/focus states again at a second in-app zoom level (200%→313%).
  - Deleted the transient memo; confirmed the throwaway sandbox doc's `annotations.json` is clean (`{"annotations":[]}`). The user's real library was never touched (separate `PAPER_MATE_DATA`).
- **Task 5 (backend unaffected).** Confirmed: no `server/` file touched, no OpenAPI/contract change, `docs/API.md` untouched, no store/anchor change. No version bump (happens at PR-merge time per CLAUDE.md versioning).

### File List

- `client/src/annotations/Annotations.css` — `.memo-collapse-toggle`: base rule now `opacity:0; pointer-events:none; transition: opacity 0.1s ease-out;` (was `pointer-events:auto`, always visible); new reveal rule `.annotation-memo:hover .memo-collapse-toggle, .annotation-memo:focus-within .memo-collapse-toggle { opacity:1; pointer-events:auto; }`; refreshed the doc comment above `.memo-collapse-toggle`.
- `client/src/annotations/MemoBox.tsx` — header comment only: notes the chevron is hidden until hover/focus-within (Story 10.3), CSS-only. No JSX/logic change.
- `client/src/annotations/AnnotationLayer.test.tsx` — new test: "the collapse toggle stays keyboard-focusable on a collapsed memo (Story 10.3: hidden via opacity, not display/visibility, so it never leaves the tab order)" — asserts `disabled === false` and `tabIndex === 0` on the toggle when the memo is collapsed.
- `.bmad/implementation-artifacts/sprint-status.yaml` — `10-3-…`: `backlog` → `ready-for-dev` (create-story) → `in-progress` (dev-story start) → `review` (this completion).

## Change Log

- 2026-07-19: Implemented (Tasks 1-2): `.memo-collapse-toggle` hidden by default (`opacity:0; pointer-events:none`), revealed on `.annotation-memo:hover` or `:focus-within` — mirrors the codebase's existing `FolderPanel`/`CollectionTable` reveal-on-hover pattern (`0.1s ease-out` fade). Opacity-only (not `display`/`visibility`) so the toggle stays keyboard-focusable on a collapsed memo, where it's the only control. Refreshed the now-stale "always present" comments in `Annotations.css` and `MemoBox.tsx`.
- 2026-07-19: Tests (Task 3): added one regression assertion guarding the toggle's keyboard-focusability on a collapsed memo. Full suite 1549/1549 green, typecheck clean. No `render/index.ts` export changed, so the `vi.mock("./render")` barrels needed no edit.
- 2026-07-19: Live-smoked (Task 4) at DPR 2 (`chrome-devtools-mcp`, `claude-in-chrome` unavailable this session — same fallback as 10.1/10.2) against a real paper in an isolated throwaway `PAPER_MATE_DATA` sandbox (own `uvicorn`/`vite`, never `~/.paper-mate`): confirmed idle-hidden, hover-reveal, focus-within-reveal (independently of hover), and — the story's key risk — that a COLLAPSED memo's chevron (its only focusable control) stays reachable and keyboard-activatable via focus + Enter even while visually hidden. Verified no layout shift (identical `getBoundingClientRect()`) and re-checked at a second zoom level (200%→313%). Story 10.2's edit handles/resize still rendered correctly on selection; no regression. Deleted the transient test memo; sandbox doc verified clean.
