# Sprint Change Proposal — Tool-state FSM + arm-time color pick

- Date: 2026-06-29
- Trigger: Story 2.3 live smoke (Playwright on the running app)
- Author: Dev (correct-course)
- Scope classification: **Moderate** (backlog reorg + spec/architecture edits; no PRD scope change)

## 1. Issue Summary

The Story 2.3 live smoke surfaced two design-level problems that go beyond a single story's scope:

- **#2 — Two tools can be active at once.** `mode` (cursor/hand/box; in `App`+`ToolRail`+`Reader`) and `armedTool` (highlight; in `App`) are two orthogonal states. With the hand tool armed AND highlight armed, the Reader's pan handler ate the drag (`data-pan` suppresses text selection), so highlight-on-drag produced **no reaction** — the user's reported "highlight doesn't work at all." Story 2.3 shipped a **surgical mutual-exclusion patch** (arming an annotation tool forces `mode="cursor"`; picking a pointer tool clears `armedTool`) that fixes the live bug, but the orthogonal two-state model is still the root design flaw and every later tool story (2.4–2.9) would re-add the same pattern.
- **#4 — No way to pick a highlight color before drawing.** The swatch row only appears as a *recolor* after a mark is created. Users expect arming a color tool to offer a default-color picker up front.

Evidence: live Playwright run loaded `fixtures/sample-pdfs/09-regularization.pdf`; with hand+highlight armed a text drag panned (0 marks); after the 2.3 mutual-exclusion fix the same gesture highlighted (8 line-marks) and stayed glued across a 157%→197% zoom.

## 2. Impact Analysis

- **Epic impact:** Epic 2 (in-progress) only. No change to Epics 1 or 3.
- **Story impact:**
  - 2.3 (done): its surgical mutual-exclusion patch is **superseded** by the new FSM story (kept working in the interim; no rollback).
  - 2.4–2.9 (backlog tool stories): all arm a tool and pop a quick-box, so they should be built on the unified FSM + the arm-time color pick. → renumbered, and they inherit both.
- **Artifact conflicts:**
  - `ARCHITECTURE-SPINE.md` has no tool-state invariant → add **AD-11 (Tool-state model)**.
  - `EXPERIENCE.md` IP-1 (tool select) and IP-3 (quick-box mapping) don't state mutual-exclusion or an on-arm color pick → amend.
  - `epics.md` + `sprint-status.yaml` → insert two stories, renumber.
- **Technical impact:** `App.tsx`, `ToolRail.tsx`, `Reader.tsx`, and the Story 2.2 `annotations/machine.ts` overlay machine converge into one `activeTool` source. No backend, no contract, no anchor/store math change.

## 3. Recommended Approach

**Direct adjustment** (no rollback, no MVP change). Two new stories, sequenced **next** (before the remaining tool features) so 2.6–2.11 build on the unified model — Epic-1 retro **PREP-3** ("design the transient-overlay state machine once"). User decisions (2026-06-29): two separate stories; FSM first.

### New sprint order for Epic 2

| New # | Story | Note |
|---|---|---|
| 2.4 | **Unify tool state (single `activeTool` FSM)** | NEW, refactor — #2 |
| 2.5 | **Arm-time color quick-pick** | NEW, feature — #4 |
| 2.6 | Underline text | was 2.4 |
| 2.7 | Pen / freehand | was 2.5 |
| 2.8 | Textbox memo | was 2.6 |
| 2.9 | Comment (highlight + pin + bubble) | was 2.7 |
| 2.10 | Box-select a region | was 2.8 |
| 2.11 | Drag-to-change-tool quick-box | was 2.9 |

Risk: low. The FSM refactor is internal (App/ToolRail/Reader/machine), covered by existing tests; the color-pick is additive. Timeline: two small stories inserted ahead of five existing ones.

## 4. Detailed Change Proposals

### 4.1 New Story 2.4 — Unify tool state (single `activeTool` FSM)

> As a reader, I want exactly one tool active at a time, so that arming a tool never lets another (pan) swallow my gesture and the rail always shows one active tool.

Acceptance criteria (to be expanded by create-story):
1. One `activeTool` source of truth: `"cursor" | "hand" | "box" | "highlight" | "underline" | "pen" | "memo" | "comment"`, mutually exclusive by construction. Replaces App's `mode` + `armedTool` and Story 2.2's `machine.ts` armed-tool split; the 2.3 surgical mutual-exclusion patch is removed in favor of the FSM (behavior preserved). [AD-11]
2. Pointer tools (cursor/hand/box) and annotation tools (highlight/...) live in the same FSM; arming any tool disarms the previous. The rail shows exactly one active button (cursor active in plain cursor mode, per the 2.3 #3 fix, preserved).
3. Hotkeys (`V`/`Esc`/`H`/`U`/`D`/`T`/`C`/`M`) and the rail set `activeTool`; document-level handlers, phase-gated, editable/buttons exempt (AP-1).
4. The 2.2 overlay machine (`empty/armed/annotating/pending`) is reconciled with the tool FSM (one model drives both "which tool" and "transient quick-box state") — PREP-3.
5. No regression: highlight-on-drag (2.3), pan (1.8), box-select-arm parity, zoom/scroll; the Reader's `panArmed` derives from `activeTool === "hand"`. All existing tests green; FSM transition unit tests added.
6. Layering preserved (AD-9); no anchor/store/contract change.

### 4.2 New Story 2.5 — Arm-time color quick-pick

> As a reader, I want to pick the highlight color when I arm the tool (before drawing), so that new marks land in my chosen color.

Acceptance criteria (to be expanded by create-story):
1. Arming a color tool (highlight; later underline/pen) shows the `{component.color-swatch}` row as an on-arm picker to set the **default** color for subsequent marks (distinct from the post-create recolor row). [EXPERIENCE.md IP-1/IP-3 amended]
2. The chosen default persists for the armed session; new marks use it (the create path reads the active color, not a hardcoded `annotation-default`).
3. The post-create recolor row (2.3) still works; both read/write the same active-color state.
4. Keyboard-reachable, `Esc`-dismissable, never shifts the canvas (NFR-1). No anchor/contract change.

### 4.3 `ARCHITECTURE-SPINE.md` — add AD-11

> **### AD-11 — Tool-state model**
> - **Binds:** the active tool across pointer (cursor/hand/box) and annotation (highlight/underline/pen/memo/comment) tools.
> - **Prevents:** two tools active at once (e.g., pan eating an annotation drag); divergent per-feature arming state.
> - **Rule:** a single `activeTool` finite-state model is the one source of truth; tools are mutually exclusive by construction. `render/`'s pan derives from it (`hand`); the `annotations/` overlay machine (transient `armed/annotating/pending`) is driven by the same model, not a parallel one (Epic-1 retro PREP-3). Hotkeys + rail set it; document-level handlers, phase-gated.

### 4.4 `EXPERIENCE.md` — amend IP-1 and IP-3

- **IP-1 Tool select:** "Click rail icon (or hotkey) arms tool; stays armed. **Exactly one tool is active at a time — arming any tool (pointer or annotation) disarms the previous (mutual exclusion).**"
- **IP-3 quick-box mapping:** add a note — "**Arming** a color tool (highlight / underline / pen) also pops the `{component.color-swatch}` row to set the **default** color before drawing; the post-create row recolors the just-made mark."

## 5. Implementation Handoff

- **Scope:** Moderate → backlog reorganization + spec/arch edits, then standard story cycle.
- **Applied by this proposal:** `epics.md` (two new stories + renumber + restructure note), `sprint-status.yaml` (insert + renumber), `ARCHITECTURE-SPINE.md` (AD-11), `EXPERIENCE.md` (IP-1/IP-3).
- **Next:** `create-story 2-4` → `dev-story` (FSM refactor first), then `create-story 2-5` (arm-time color pick), then continue 2.6–2.11.
- **Success criteria:** only one rail button reads active in any state; no tool can swallow another's gesture; arming highlight offers a default-color pick; all prior tests green.
