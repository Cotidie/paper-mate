---
title: Paper Mate Experience Spine
status: final
created: 2026-06-28
updated: 2026-06-28
sources:
  - .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md
  - DESIGN.md
---

# Paper Mate — EXPERIENCE.md

How Paper Mate *works*. Visual identity lives in `DESIGN.md`; this spine references its tokens by name with `{component.*}` / `{colors.*}`. Both spines win over any mock on conflict. Scope: **v1 = Phase 1 (Viewer / Annotator)**.

## Foundation

- **Form-factor:** desktop web, Chrome + Firefox. No mobile/tablet. Mouse + keyboard primary; trackpad supported.
- **UI system:** none inherited — components defined in `DESIGN.md`. This spine carries behavior only.
- **Governing principle:** immersive, non-distracting reading. The PDF canvas is sacred: no chrome ever reflows or resizes it (PRD NFR-1). Rail, Annotation Bank, and quick-boxes **overlay**.
- **Storage feel:** autosave; annotations persist on disk and are restored exactly on reopen (PRD NFR-4). No save button. (Disk-vs-browser mechanism is an architecture decision — see PRD addendum.)

## Information Architecture

Near single-surface.

- **S0 · Empty / Open** — no PDF loaded. `{component.empty-dropzone}`: drag-drop a PDF or browse. Lands in S1 on load.
- **S1 · Reader** — the app. Three overlay zones on a fixed canvas:
  - **Top bar** — filename, `{component.save-indicator}`, Bank toggle, ToC toggle.
  - **PDF canvas** (`{component.pdf-canvas}`) — centered `{component.page-surface}` pages, vertical scroll. **Fixed box.**
  - **Tool rail** (`{component.tool-rail}`) — collapsible, overlays left edge.
  - **Annotation Bank** (`{component.annotation-bank-panel}`) — overlays right edge when open.
  - **Zoom control** (`{component.zoom-control}`) — top bar, left of the ToC button (revised 2026-06-28; was a bottom-right pill).
- **Transient overlays** — contextual `{component.quick-box}`, `{component.tool-flyout}`, `{component.toc-panel}`, `{component.comment-bubble}`, `{component.toast}`.

Visual reference for S1: [`mockups/reader-mock.html`](mockups/reader-mock.html). Spines win over the mock on conflict.

**Surface closure:** every PRD v1 need maps here. Open/load → S0. View/scroll/zoom/pan/ToC → S1 canvas + rail + zoom. Annotate (highlight/underline/pen/memo/comment/box-select) → rail tools + quick-box. Edit/undo/delete → canvas selection + keys. Review/jump → Annotation Bank. Persist → autosave + save-indicator. No orphan needs, no orphan surfaces.

## Voice and Tone

Obsidian-quiet. Microcopy is sparse, plain, lowercase-leaning, never chatty. (Brand voice lives in `DESIGN.md`.)

| Context | Copy |
|---|---|
| Empty state | `Drop a PDF here` · secondary: `or browse…` |
| Saving | `Saving…` |
| Saved | `Saved` |
| Load failure | `Couldn't open this file.` |
| Save failure | `Couldn't save — changes kept in this session.` |
| Page status | `Page 3 of 23` |
| Zoom | `184%` |
| Empty Bank | `No annotations yet.` |

No exclamation marks. No emoji in product copy. Errors state the fact, then the fallback.

## Component Patterns (behavioral)

Visual specs in `DESIGN.md`; behavior here.

- **Tool rail** — click arms a tool; armed tool **stays armed** for multiple annotations until another is chosen or `Esc`/`V` returns to cursor. Rail does **not** auto-collapse after a pick. `[` toggles collapse. The cursor button carries a `{component.tool-flyout}`: cursor / hand / box-select.
- **Quick-box** — appears on drag-release, contents by active mode (see Interaction Primitives). Dismiss on pick, outside-click, or `Esc`. Positioned at the selection; nudges to stay on-screen; never shifts the canvas.
- **Annotation (page object)** — selectable (click), editable (drag handles to move/resize, restyle via re-opened quick-box, double-click text annotations to re-edit), deletable. Each carries a stable spatial anchor (page + rect/range) so it re-renders at exact coords across zoom (PRD NFR-3).
- **Comment** — special annotation: highlights the underlying text **and** anchors a `{component.annotation-comment-pin}`. Click pin → `{component.comment-bubble}` opens for read/edit.
- **Annotation Bank** — lists all annotations (type glyph, color, snippet, page). Click row → canvas jumps to the annotation + target flashes. v1 = list + jump only (no filter/search/edit-in-bank/export).
- **Zoom control** — `−` / `+` / live `%`; mirrors keyboard + `ctrl+scroll`.

## State Patterns

| State | Trigger | UI |
|---|---|---|
| Empty | no PDF | `{component.empty-dropzone}` |
| Loading | file chosen | dropzone → spinner/skeleton; canvas reserves frame |
| Rendering | large doc | pages stream in top→down; scroll usable as they arrive |
| Reading (idle) | loaded | canvas + collapsed-or-open rail; no selection |
| Tool-armed | tool picked | armed tool styled; cursor reflects tool |
| Annotating | drag in progress | live preview of mark; on release → quick-box |
| Editing | annotation selected | handles + restyle affordance; `Del` removes |
| Saving / Saved | any change | `Saving…` → `Saved` (debounced autosave) |
| Error (load) | bad/unsupported file | `{component.toast}` + return to S0 |
| Error (save) | disk/storage fail | `{component.toast}`; changes kept in session; retry on next change |

Loading and rendering must **never** shift final page geometry — reserve the layout up front (NFR-1).

## Interaction Primitives

| ID | Primitive | Behavior |
|---|---|---|
| IP-1 | Tool select | Click rail icon (or hotkey) arms tool; stays armed. **Exactly one tool is active at a time: arming any tool (pointer or annotation) disarms the previous (mutual exclusion, AD-11).** |
| IP-2 | Drag-to-annotate | Drag over text/region creates a mark in the armed tool. |
| IP-3 | Contextual quick-box | On drag-release, a mode-specific `{component.quick-box}` pops (table below). |
| IP-4 | Pan | Hand tool drag, or hold `Space` + drag. |
| IP-5 | Zoom | `Ctrl +/-`, `Ctrl 0` reset/fit, `Ctrl+scroll`, bottom-right buttons; live %. |
| IP-6 | Edit | Click selects a mark (cursor mode or while an annotation tool is active; single selection, AD-12). On a selected mark: re-open the quick-box to restyle/recolor, and delete (lightweight, Story 2.5). Drag-handle move/resize and double-click-to-re-edit text are heavier edits (Epic 3, Story 3.1). |
| IP-7 | Undo / redo | `Ctrl Z` / `Ctrl Shift Z`. |
| IP-8 | Delete | `Del` / `Backspace` on selected annotation. |
| IP-9 | Freehand | Pen drag draws a vector stroke; quick-box sets color + width. |
| IP-10 | Comment | Highlights text + drops pin; click pin opens bubble. |
| IP-11 | Bank jump | `Ctrl B` toggles; row click jumps + flashes target. |

### Contextual quick-box mapping (IP-3)

| Active mode | Quick-box contents |
|---|---|
| Selection / cursor | tool-type picker: highlight / underline / comment / memo |
| Highlight | `{component.color-swatch}` row |
| Underline | `{component.color-swatch}` row |
| Pen / brush | color-swatch row + stroke-width steps |
| Textbox memo | inline `{component.text-input}` + color/size |
| Comment | `{component.comment-bubble}` opens directly |
| Box-select | region tool-type picker (highlight / comment; snapshot reserved for Phase 2) |

**Arm-time color pick:** arming a color tool (highlight / underline / pen) also pops the `{component.color-swatch}` row to set the **default** color before drawing. This is distinct from the post-drag row above, which recolors the just-made mark; both read/write the same active-color state.

### Keyboard map

| Key | Action | Key | Action |
|---|---|---|---|
| `V` / `Esc` | cursor / deselect | `Ctrl Z` / `Ctrl Shift Z` | undo / redo |
| `Space` (hold) | temporary pan | `Del` / `Backspace` | delete selected |
| `H` | highlight | `Ctrl +/-` | zoom |
| `U` | underline | `Ctrl 0` | fit / reset zoom |
| `D` | pen / draw | `Ctrl B` | toggle Annotation Bank |
| `T` | text memo | `[` | toggle tool rail |
| `C` | comment | `PgUp` / `PgDn` (or `Ctrl ↑` / `Ctrl ↓`) | page nav |
| `M` | box-select | | |

## Accessibility Floor

Solo tool, but baseline:
- Every tool and action is **keyboard-operable** (the hotkey map covers all primitives).
- Visible focus rings on all interactive chrome (2px `{colors.ink}` per `DESIGN.md` input focus).
- Token contrast meets ~AA for UI text on chrome.
- Quick-box and comment bubble are keyboard-reachable and `Esc`-dismissable; focus moves into them on open and returns on close.
- Respect `prefers-reduced-motion`: the Bank jump-flash and panel slides degrade to instant.
- Annotation accent colors are distinguishable by the Bank's type glyph + label, not color alone.

## Key Flows

### F1 — Annotate a paper (climax: the page doesn't move)

*Wonseok, 11pm, reviewing the regularization chapter.*
1. Drops `09-regularization.pdf` onto the `{component.empty-dropzone}` → pages render.
2. Presses `H`, drags across a theorem. **The highlight lands and the page does not jump or reflow** — the Kami pain is gone. *(climax beat)*
3. The highlight quick-box offers the color row; he leaves it yellow.
4. Presses `T`, clicks the margin, types a note — the free-floating memo sits beside the text without displacing it.
5. `Saving…` → `Saved` flickers in the top bar; he never thinks about saving.

### F2 — Review and jump (climax: instant recall)

1. Later, `Ctrl B` opens the `{component.annotation-bank-panel}` — his 6 marks listed with snippets.
2. He scans, clicks the theorem highlight → **canvas jumps to it and the target flashes**. *(climax beat)*
3. Switches to cursor (`V`), clicks the highlight, drags a handle to extend it over the next line; restyles to green via the re-opened quick-box.
4. Closes the tab. Reopens tomorrow → every mark is reserved exactly where he left it.

## Inspiration & Anti-patterns

- **Borrow:** Kami's left-rail tool model and tool flyout; Obsidian's quiet, chrome-light reading surface.
- **Reject (Kami anti-patterns):** annotations/UI that reflow or shift the PDF area; having to return to the rail to switch tool mid-annotation (solved by the contextual quick-box); no freehand pen; no free-floating textbox memo.
