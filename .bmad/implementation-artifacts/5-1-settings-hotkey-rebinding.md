---
baseline_commit: 33da559cd16f5d90deca68120db177cd17a75b50
---

# Story 5.1: Settings modal + custom hotkey rebinding

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a Settings modal where I can rebind hotkeys,
so that the keyboard map fits my habits.

## Acceptance Criteria

> Source: `epics.md#Story-5.1` (FR-24, AD-11, UX-DR15/UX-DR17). The two through-lines: **(a)** the enabler is a keymap-as-data slice the document keydown reads; the modal UI is secondary. **(b)** No contract change — this is client-only, app-global `localStorage`, never `~/.paper-mate`.

1. **Keymap-as-data enabler.** The hard-coded key literals in `App.tsx` (the tool-key effect `e.key === "h"`/`"u"`/… and the separate `Ctrl B` bank-toggle effect) are refactored into ONE keymap data structure (`action → binding`) that a `useKeymap` matcher reads. The document keydown handler resolves the pressed key to an action via the keymap, not via inline literals — so a binding can be swapped at runtime. Default bindings are byte-identical to today's behavior (see Keyboard map below); with defaults unchanged, every existing hotkey test stays green without an assertion edit. (FR-24, AD-11)

2. **Settings modal.** A Settings affordance (Phosphor `Gear`) in the tool-rail opens a focus-trapped, `Esc`-dismissable modal. The modal shows a keybinding pane: one row per rebindable action (label + its current binding + a "press a key" capture control). Focus moves into the modal on open and returns to the Settings trigger on close (UX-DR17). While the modal is open — and especially while a capture is active — the global tool-key handler is suppressed, so pressing `H` to rebind does NOT arm the highlight tool behind the modal. (FR-24, UX-DR15, UX-DR17)

3. **Rebinding rules + persistence.** Capturing a key rebinds that action. **Conflict detection** blocks assigning a key already bound to another action (inline message, no rebind applied). A **reset-to-defaults** control restores the whole keymap. **Reserved combos** are rejected as capture targets: `Escape` (universal dismiss/deselect), the reader-owned keys (`Ctrl +/-/0` zoom, `Space` pan, `PgUp`/`PgDn` + `Ctrl ↑/↓` page nav), undo/redo (`Ctrl Z`/`Ctrl Shift Z`), and browser/OS-critical combos (e.g. `Ctrl W/T/N/R`, `F5`, `Ctrl Shift I`). Preferences persist in `localStorage` — app-global (survive reload AND doc switch), NOT per-doc `~/.paper-mate`. Token-driven CSS (no raw hex/px outside `theme/`), no em-dash in any copy, and **no contract change** (`server/openapi.json` + `client/src/api/schema.d.ts` byte-identical). (FR-24)

## Tasks / Subtasks

> Land as a small sequence so a regression is bisectable: (1) the pure enabler (keymap data + matcher + store), (2) the App.tsx refactor onto it (behavior-neutral for defaults), (3) the modal + capture UI, (4) close-out. Run `cd client && npm test` continuously.

- [x] **Task 1 — Keymap data + `useKeymap` matcher + settings store (AC: #1, #3).** The pure enabler; no UI yet.
  - [x] Add a `settings/` module (client feature boundary, sibling of `annotations/`). Define the `KeyAction` union and `KeyBinding` shape (`{ key: string; ctrl?: boolean }`), and `DEFAULT_KEYMAP: Record<KeyAction, KeyBinding>` matching the Keyboard map table below EXACTLY (letters lower-cased; `toggleBank` = `{ key: "b", ctrl: true }`).
  - [x] Add a **separate** Zustand store `useSettingsStore` for app-global prefs, wrapped in the `persist` middleware writing to `localStorage` (key `paper-mate:settings`, `version: 1`). Do NOT fold this into `useAnnotationStore` (that store is the doc-scoped working copy, zundo-wrapped, persisted to `~/.paper-mate` — a rebinding is neither doc-scoped nor undoable). State: `keymap`; actions: `rebind(action, binding)` (applies the conflict + reserved guards, returns a result/reason so the UI can show why a rebind failed), `resetKeymap()`.
  - [x] Add `useKeymap()` (or a pure `matchAction(keymap, e): KeyAction | null` helper it wraps): normalizes `e.key` (letters → lowercase) and matches `ctrl` for chords; returns the bound action or `null`. Keep it a pure, unit-testable function (leaf, imports only `settings/` types) so App just calls it.
  - [x] Add pure guards: `isReserved(binding)` (denylist: `Escape`; reader-owned `+ = - 0` with ctrl, `PageUp`/`PageDown`, `ArrowUp`/`ArrowDown` with ctrl, `" "`; `z` with ctrl; browser/OS `w t n r l` with ctrl, `F1..F12`) and conflict lookup (key already assigned to a DIFFERENT action). `Escape` is never in the keymap.
  - [x] Unit tests: matcher (single key, chord, unknown → null, case-insensitive letters), store `rebind` conflict + reserved rejection + `resetKeymap`, persistence round-trip shape.
- [x] **Task 2 — Refactor `App.tsx` onto the keymap (AC: #1).** Behavior-neutral for the default keymap.
  - [x] Collapse the TWO document-level keydown effects (the tool-key effect ~lines 118-175 and the `Ctrl B` bank effect ~lines 183-203) into ONE keymap-driven `document` keydown effect. Keep the same guards: `docOpen` gate, the `isExempt` check (INPUT/TEXTAREA/SELECT/BUTTON/contentEditable), `preventDefault` on a match. Resolve the action with `matchAction`; `switch` on it to the existing setters (`setActiveTool`, `setBoxHighlight` for `boxHighlight`, `setRailCollapsed`, `setBankOpen`).
  - [x] `Escape` stays hard-coded and reserved: it always returns to cursor/deselect (and remains the modal/quick-box/toast dismiss). Do NOT route `Escape` through the keymap. `V` (the `cursor` action) stays rebindable.
  - [x] Suppress the global handler while the Settings modal is open or a capture is active (read a flag off local state or the settings store), so a captured `H` never leaks to the tool arm.
  - [x] The existing `App.test.tsx` hotkey tests (V/Esc/H/U/D/T/C/M, `[`, Ctrl+B) MUST pass unchanged. If an assertion has to change to stay green, the refactor altered default behavior: STOP and reassess.
- [x] **Task 3 — Settings modal + capture UI (AC: #2, #3).**
  - [x] Add a `Gear` (`@phosphor-icons/react`) trigger to the tool-rail (`ToolRail.tsx`), keyboard-reachable, `aria-label`/`title` "Settings" (no em-dash). Match the existing `.tool-button` idiom; place at the rail's tail. Wire an `onOpenSettings` prop up to App (App owns the open/closed state, same pattern as `bankOpen`/`tocOpen`).
  - [x] Build `SettingsModal` (new component + co-located CSS + test). Focus-trapped + `Esc`-dismissable + a scrim/backdrop; focus returns to the `Gear` on close (UX-DR17). See Dev Notes "Modal approach" for the `<dialog>`-vs-hand-rolled decision + the jsdom caveat.
  - [x] Keybinding pane: iterate the keymap actions, render one row each (human label + current-binding chip + a capture control). A capture control, when activated, enters capture mode; the NEXT keydown becomes the candidate binding. Capture must NOT go through the global handler (own listener on the capture element / modal). `Escape` while capturing cancels the capture (does NOT close the modal). On a valid capture, call `rebind`; on conflict/reserved, show an inline reason (no em-dash), leave the binding unchanged.
  - [x] A "Reset to defaults" button calls `resetKeymap()`.
  - [x] All dims/colors are tokens (see Dev Notes "Tokens"): add the scrim color to `DESIGN.md` colors + `npm run gen:tokens`, add `--settings-modal-*` dims to `components.css`, reuse `surface-card` + `hairline` + soft-drop + panel radius. Run `no-raw-values.test.ts` after CSS work.
- [x] **Task 4 — Close-out.**
  - [x] Full green matrix: `cd client && npm test` (Vitest), `npm run typecheck`, `npm run build`; backend `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (unchanged; run on host — sandbox caveat in CLAUDE.md). Contract guard: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` EMPTY.
  - [x] Bump `server/pyproject.toml` `[project].version` `0.3.7 → 0.3.8` (PATCH +1 per story; single source). Sync `server/uv.lock` `paper-mate-server` version to match (the `test_version.py` guard from AE3-6 asserts they are equal) — this bit Story 5.0's review.
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Live smoke on YOUR OWN servers (never the user's :8000/:5173): open Settings via the Gear; rebind `H` → some free key (e.g. `G`); close; press the new key → highlight arms, press `H` → nothing; reload the page → the rebind persists; open Settings, "Reset to defaults" → `H` arms highlight again; try to bind `Escape` and `Ctrl W` → both rejected with a reason; bind a key already in use → conflict blocked. Use trusted input (real click/press_key), not `dispatchEvent`, because focus-trap + capture + the tool-key-exemption are focus-sensitive. Shut the servers down after.
  - [ ] Cross-model Codex review (`bmad-code-review` via `codex exec`) after dev-story; resolve High/Med before done. Fill the Dev Agent Record fully (AE3-2) before flipping status to `done`; flip `sprint-status.yaml` at PR-merge (AE3-1).

## Dev Notes

### The current state (what you are refactoring) — read these before touching anything

- **`client/src/App.tsx`** owns the tool keys. There are **two** `document`-level keydown effects (Epic-1 retro AP-1: handlers bind at `document`, NOT `.pdf-canvas`, gated by `docOpen`, exempting editable/BUTTON):
  - **Tool-key effect (~lines 118-175):** early-returns on `e.ctrlKey || e.altKey || e.metaKey`, then `isExempt`, then a long `if/else` on `e.key`: `v/V/Escape → setActiveTool("cursor")`, `h/H → "highlight"`, `u/U → "underline"`, `d/D → "pen"`, `t/T → "memo"`, `c/C → "comment"`, `m/M → "highlight" + setBoxHighlight(true)`, `[ → setRailCollapsed(toggle)`. These `e.key === "…"` literals are the AC-1 target.
  - **`Ctrl B` effect (~lines 183-203):** a SEPARATE effect (because the tool-key effect early-returns on any Ctrl chord) that requires `ctrlKey && !alt && !meta`, exempts editable/BUTTON, and toggles `bankOpen`. Fold this into the unified keymap handler — `toggleBank` is the one default chord binding, so the unified matcher must handle modifiers rather than blanket-early-returning on `ctrlKey`.
- **`client/src/Reader.tsx`** owns keys you are NOT refactoring but MUST NOT collide with: `Ctrl +/-/0` zoom (~lines 405-422), hold-`Space` temp-pan (~lines 431-471, includes the blur/visibilitychange reset — do not disturb), `PgUp/PgDn` + `Ctrl ↑/↓` page nav (~lines 496-507). These stay reader-owned and are **reserved** capture targets (rebinding a tool onto them would shadow the reader). This story does NOT add reader keys to the rebindable keymap.
- **`client/src/store/index.ts`** is zundo-`temporal`-wrapped and is the doc-scoped annotation working copy. It has NO `persist` middleware. Do NOT add settings to it — settings are a separate store.
- **`client/src/ToolRail.tsx`** is where the `Gear` trigger goes. It already renders `.tool-button`s and has a collapsed mode (a single expand affordance). Add the Settings trigger consistent with the existing button idiom; thread an `onOpenSettings` prop from App.
- **`client/src/App.test.tsx`** asserts the default hotkeys (V/Esc/H/U/D/T/C/M) via `fireEvent.keyDown(document, { key: "h" })` etc. (~lines 254-360). These are your safety net: defaults unchanged ⇒ they pass unchanged.

### The keymap model (prescribed)

```ts
// settings/keymap.ts (leaf — imports only its own types)
export type KeyAction =
  | "cursor" | "highlight" | "underline" | "pen" | "memo" | "comment"
  | "boxHighlight" | "toggleRail" | "toggleBank";

export interface KeyBinding { key: string; ctrl?: boolean } // shift/alt/meta not user-settable in v1

export const DEFAULT_KEYMAP: Record<KeyAction, KeyBinding> = {
  cursor: { key: "v" }, highlight: { key: "h" }, underline: { key: "u" },
  pen: { key: "d" }, memo: { key: "t" }, comment: { key: "c" },
  boxHighlight: { key: "m" }, toggleRail: { key: "[" },
  toggleBank: { key: "b", ctrl: true },
};

export function matchAction(keymap, e: KeyboardEvent): KeyAction | null; // normalize e.key (lowercase letters), match ctrl chord
```

- `Escape` is deliberately NOT an action — it stays a hard-coded reserved dismiss/deselect in App (and remains the modal/quick-box/toast dismiss). `V` (`cursor`) IS rebindable; `Escape` continues to also return to cursor.
- Store `rebind(action, binding)` returns a discriminated result (`{ ok: true }` | `{ ok: false; reason: "conflict" | "reserved" }`) so the modal can show why a capture was rejected.

### Modal approach (decision + jsdom caveat)

Two options — **recommend hand-rolled** for jsdom testability:
- **Native `<dialog>` + `showModal()`** gives focus-trap + `Esc`-close + inert-backdrop for free (adopt-stable primitive, per CLAUDE.md engineering principles). BUT jsdom 29 (this repo's test env) does not implement `showModal()`/`close()`/`::backdrop` — tests would need a shim, and the suite is the safety net here. If you take this path, gate/shim it so tests don't false-fail.
- **Hand-rolled overlay** (a `div[role="dialog"][aria-modal]` over a scrim, a small focus-trap: focus first control on open, cycle Tab within, restore focus to the `Gear` on close, `Escape` closes): fully jsdom-testable, matches the app's existing overlay idiom (the rail flyout + Toast already do `document` `keydown`/`Escape` handling). No new dependency. **Recommended.** There is no focus-trap library in the repo and adding one for one modal is not warranted.

### Tokens (no-raw-values compliance)

`no-raw-values.test.ts` forbids raw `#hex` / `\d+px` anywhere except `src/theme/**` (comments are stripped). So:
- Modal **card**: reuse `{colors.surface-card}` + 1px `{colors.hairline}` + the single soft-drop shadow `0 4px 12px rgba(0,0,0,0.04)` + the 12px panel radius (all already in `DESIGN.md`/`components.css`).
- Modal **scrim**: there is NO scrim token yet. Add one to `DESIGN.md` colors (e.g. `scrim: "rgba(0,0,0,0.32)"`) and `cd client && npm run gen:tokens` so it lands in the generated `tokens.css`. (Do NOT inline the rgba in a component stylesheet.)
- Modal **dims** (width, padding, row height, capture-chip size): add `--settings-modal-*` vars to `components.css` (the hand-authored token layer), following the `--toc-panel-*` / `--bank-panel-*` precedent.
- All user-facing copy (labels, `title`, `aria-label`, conflict/reserved messages, "Reset to defaults") must contain no em-dash (`—`); use a colon/comma/period. Grep the new strings before committing.

### Keyboard map (defaults — must stay byte-identical)

Source: `EXPERIENCE.md#Keyboard-map` + `App.tsx` as-built. Note `M` in the as-built App = **box-highlight** (arm Highlight + box mode), which is what the keymap default encodes; ignore the EXPERIENCE.md table's `M = box-select` label (never implemented that way).

| Action | Default | Action | Default |
|---|---|---|---|
| `cursor` (V; Esc reserved) | `v` | `comment` | `c` |
| `highlight` | `h` | `boxHighlight` | `m` |
| `underline` | `u` | `toggleRail` | `[` |
| `pen` | `d` | `toggleBank` | `Ctrl B` |
| `memo` | `t` | | |

Reader-owned, NOT rebindable (reserved): `Ctrl +/-/0` zoom, `Space` pan, `PgUp`/`PgDn` (`Ctrl ↑/↓`) page nav, `Ctrl Z`/`Ctrl Shift Z` undo/redo, `Escape` dismiss.

### What must NOT change (regression guardrails)

- **No contract change.** No Pydantic/OpenAPI/`schema.d.ts` edit; settings are client-only `localStorage`. `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` EMPTY.
- **No behavior change for default bindings.** Every current hotkey behaves identically out of the box; the App.test hotkey assertions pass without edits.
- **Reader keys untouched.** Do not modify the zoom / Space-pan (incl. its blur reset) / page-nav effects in `Reader.tsx`.
- **AD-9 layering.** `settings/` is a client feature module; it does not import `render/`/`anchor/` upward, and those never import it.
- **AP-1 (document-level handlers).** The unified keydown handler stays on `document`, phase/doc-gated, exempting editable + BUTTON — never bound to `.pdf-canvas`.
- **AP-2 (render mock barrels).** N/A here (no `render/` export moves), but if you touch a `render/` export, update BOTH `vi.mock("./render")` barrels.

### Testing standards

- Vitest + jsdom (`cd client && npm test`). **Gotcha #1:** the `persist` middleware writes `localStorage`, which leaks across tests. Reset the settings store to defaults AND clear `localStorage` in `beforeEach`, or a rebind in one test poisons the next.
- **Focus-sensitive paths need trusted input.** Focus-trap, capture-suppresses-global-handler, and the BUTTON-exemption are focus-dependent. In unit tests use Testing Library `userEvent` (real focus/keyboard), not raw `dispatchEvent`/`.click()`. In live smoke use real `click`/`press_key`, not `dispatchEvent` (memory: use-trusted-input-for-focus-sensitive-smoke).
- **Icon-button exemption interplay.** The global handler exempts BUTTON, so the `Gear` button won't fire tool keys while focused (good). The capture control must receive keys via its OWN listener (the global handler is suppressed while the modal/capture is active), not rely on the global path — verify a captured `H` rebinds and does NOT arm highlight (memory: icon-button-swallowed-by-exempt-check is the mirror-image hazard — verify capture actually fires).
- New coverage: `matchAction` (unit), settings store (`rebind` conflict/reserved/`resetKeymap`, persistence), `SettingsModal` (opens focus-trapped, `Esc` closes + returns focus, capture rebinds, conflict/reserved show a reason + no rebind, reset restores), App integration (rebound key arms new tool; old key inert; capture suppresses global handler).
- Backend: no model/contract change; run pytest on host to confirm green (sandbox can hang the TestClient tests — CLAUDE.md Backend-tests note).
- No new DPR>1 smoke is required (no geometry/paint change); the live smoke above is the coverage jsdom can't give for focus/persistence.

### Project Structure Notes

- New client feature module `client/src/settings/`: `keymap.ts` (types + `DEFAULT_KEYMAP` + `matchAction` + guards), `store.ts` (`useSettingsStore` + `persist`), `SettingsModal.tsx` + `SettingsModal.css` + `SettingsModal.test.tsx`, `keymap.test.ts`, `store.test.ts`. Co-locate component + scoped CSS + test (bulletproof-react convention already used in `annotations/`).
- `App.tsx`: two keydown effects → one; owns `settingsOpen` state; passes `onOpenSettings` to `ToolRail` and renders `SettingsModal`.
- `ToolRail.tsx`: add the `Gear` trigger + `onOpenSettings` prop.
- `DESIGN.md` (+ regen `tokens.css`) for the scrim color; `components.css` for `--settings-modal-*` dims.
- No server changes. No `render/`/`anchor/`/`api/` changes.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-5.1] — the 3 ACs + "keymap-as-data is the real cost, modal is secondary".
- [Source: .bmad/planning-artifacts/epics.md#Story-5.0] + [.bmad/implementation-artifacts/5-0-structural-refactor.md] — 5.0 (done) consolidated the overlay/gesture code but LEFT the App.tsx tool-key literals as-is; this story is the keymap enabler 5.0 pointed at.
- [Source: EXPERIENCE.md#Keyboard-map] + [EXPERIENCE.md#Accessibility-Floor] — the default map; "keyboard-operable, Esc-dismissable, focus moves in on open and returns on close" (UX-DR17).
- [Source: .bmad/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#AD-11] — single `activeTool`, mutual exclusion (the keymap dispatches into it). #AD-8 — `~/.paper-mate` is the DOC-scoped annotation store; settings are app-global `localStorage`, a different persistence tier. #AD-9 — layer/boundary invariants. #AD-3 — generated contract never hand-authored (unchanged here).
- [Source: CLAUDE.md#Engineering-principles] — adopt-stable (native `<dialog>` / zustand `persist`), document-level handlers (AP-1), render mock barrels (AP-2), `no-raw-values` (raw values only in `theme/**`).
- [Source: CLAUDE.md#Versioning] — PATCH +1 (`0.3.7 → 0.3.8`); [.bmad/planning-artifacts/sprint-change-proposal-2026-07-02.md] — AE3-6 version-match guard (`test_version.py`) requires `pyproject.toml` == `uv.lock`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (xHigh)

### Debug Log References

### Completion Notes List

- Task 1: Added `settings/keymap.ts` (types, `DEFAULT_KEYMAP`, `matchAction`, `isReserved`, `findConflict`, `formatBinding`) and `settings/store.ts` (`useSettingsStore` with zustand `persist` → `localStorage` key `paper-mate:settings` v1). `isReserved` cross-checked against `Reader.tsx`'s actual zoom/pan/page-nav key handling (not just the AC prose) so the denylist matches real reserved behavior (e.g. PgUp/PgDn reserved regardless of Ctrl; Ctrl+Up/Down reserved as the page-nav alias). 36 unit tests added, all green.
- Task 2: Collapsed `App.tsx`'s two document keydown effects (tool-key + Ctrl B) into one, driven by `matchAction(keymap, e)` + a `switch` on the resolved `KeyAction`. `Escape` stays hard-coded outside the keymap. Added `settingsOpen` App state that fully un-mounts the document listener while true (effect gate `if (!docOpen || settingsOpen) return`). Alt/Meta chords still short-circuit (keymap bindings only support a Ctrl modifier); the exempt-target check (INPUT/TEXTAREA/SELECT/BUTTON/contentEditable) is unchanged. Wired `onOpenSettings` through `ToolRail` (new Gear trigger, tail of the rail) and rendered `SettingsModal` from `App`. Verified `App.test.tsx`'s existing hotkey suite (V/Esc/H/U/D/T/C/M, `[`, Ctrl+B) passes with zero assertion edits, confirming default-binding behavior is unchanged.
- Task 3: Built `SettingsModal.tsx` as a hand-rolled `role="dialog"` overlay (native `<dialog>` skipped per Dev Notes: jsdom 29 here has no `showModal()`). Focus moves to the first row's capture control on open, restores to the invoking element on close (a `previouslyFocused` ref captured at open-time, refocused from the effect's cleanup). A small in-component Tab-trap wraps focus between the header Close button (first) and the Reset button (last) via `querySelectorAll("button:not([disabled])")` on Tab/Shift+Tab. Capture uses the dialog's OWN `onKeyDown`, never `document` (which App fully suppresses via `settingsOpen` regardless). `Escape` during capture cancels the capture only (checked before the modal-closing `Escape` branch); a bare Control/Shift/Alt/Meta keydown is ignored as a candidate binding (real-world necessity, not spec scope creep: without it, holding Ctrl before the letter would capture `{key:"control", ctrl:true}` as a nonsense binding). `rebind`'s conflict/reserved rejection surfaces as inline copy per-row (no em-dash), binding left unchanged, capture mode exits either way. Added the `scrim` color (`DESIGN.md` + regenerated `tokens.css`) and `--settings-modal-*`/`--settings-capture-chip-*` dims to `components.css`; `no-raw-values.test.ts` green. Added a `Gear` trigger to `ToolRail` (new `onOpenSettings` prop, now required — updated both `ToolRail.test.tsx` render call sites) and 5 App-level integration tests (Gear opens the modal, a rebound key arms/old key inert, global handler suppressed while modal open, a captured key doesn't leak through, Escape closes + returns focus). Both `App.test.tsx` and `SettingsModal.test.tsx` reset `useSettingsStore` + clear `localStorage` in `beforeEach` (Gotcha #1: `persist` middleware leaks across tests otherwise). No `@testing-library/user-event` dependency exists in this repo (Dev Notes' aspirational recommendation) and adding one needs approval per the dev-story HALT rule; followed the codebase's existing 100%-`fireEvent` convention instead, using explicit `.focus()` calls where a test needs real `document.activeElement` tracking (matches the one focus-sensitive precedent already in `App.test.tsx`, the "H over a focused button" test). Full suite: 777/777 client tests green, `npm run typecheck` clean, `no-raw-values` green.

### File List

- client/src/settings/keymap.ts (new)
- client/src/settings/keymap.test.ts (new)
- client/src/settings/store.ts (new)
- client/src/settings/store.test.ts (new)
- client/src/settings/SettingsModal.tsx (new)
- client/src/settings/SettingsModal.css (new)
- client/src/settings/SettingsModal.test.tsx (new)
- client/src/App.tsx (modified: unified keydown effect, settingsOpen state, SettingsModal render)
- client/src/App.test.tsx (modified: settings-store beforeEach reset + Story 5.1 integration tests)
- client/src/ToolRail.tsx (modified: Gear trigger + onOpenSettings prop)
- client/src/ToolRail.test.tsx (modified: onOpenSettings wired into both render call sites + Gear test)
- DESIGN.md (modified: `scrim` color, `settings-modal` + `settings-capture-chip` component entries)
- client/src/theme/tokens.css (regenerated: `--color-scrim`)
- client/src/theme/components.css (modified: `--settings-modal-*` / `--settings-capture-chip-*` dims)

### Review Findings

Codex (`codex exec`) adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor) of `33da559..55e40c1` against this story's ACs. 1 patch found, applied; 0 decision-needed, 0 defer, 3 dismissed as noise.

- [x] [Review][Patch] Reserved `Ctrl Shift I` was capturable — fixed [client/src/settings/keymap.ts:101]. `KeyBinding` has no `shift` field (v1: "shift/alt/meta not user-settable") and both capture (`SettingsModal.tsx`) and `matchAction` drop `e.shiftKey`, so `Ctrl+Shift+I` was indistinguishable from `Ctrl+I`. `isReserved`'s ctrl-chord denylist blocked `w t n r l` but not `i`, so `Ctrl+Shift+I` (AC-3's own devtools example) could be captured and would then `preventDefault` the real browser shortcut. Fix: added `"i"` to the reserved ctrl-chord list (blocks the bare key unconditionally, which is the only way to also block the shifted chord at this layer) + 2 new `keymap.test.ts` cases. `npm run typecheck` clean; `keymap.test.ts`/`store.test.ts`/`SettingsModal.test.tsx`/`App.test.tsx` (94 tests) green.
