---
version: alpha
status: final
updated: 2026-06-28
name: Paper-Mate-design
description: A web PDF reading companion for academic papers. The aesthetic is immersive, non-distracting reading in the Obsidian dialect — the paper is the page, and all UI (toolbar rail, annotation bank, contextual quick-boxes) recedes behind it as floating, hairline-bounded surfaces that never reflow the PDF canvas. Pure-white canvas, near-black ink (`#171717`), pure black (`#000000`) reserved for the rare primary action, a small blue accent (`#0d74ce`) for inline links. Inter for all UI text (display 600, body 400), JetBrains Mono for code/monospace surfaces. A soft annotation accent palette (yellow/green/pink/blue/purple) carries highlights, underlines, and pen strokes. Restraint over surfaces: prefer hairlines and soft single-tier shadow; no atmospheric decoration.

colors:
  primary: "#000000"
  primary-active: "#1a1a1a"
  text-link: "#0d74ce"
  text-link-secondary: "#476cff"
  ink: "#171717"
  body: "#60646c"
  body-strong: "#171717"
  muted: "#999999"
  muted-soft: "#cccccc"
  hairline: "#f0f0f3"
  hairline-soft: "#f5f5f7"
  hairline-strong: "#dcdee0"
  canvas: "#ffffff"
  canvas-soft: "#fafafa"
  surface-card: "#ffffff"
  surface-strong: "#f0f0f3"
  surface-dark: "#171717"
  surface-dark-elevated: "#1a1a1a"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  on-dark-soft: "#b0b4ba"
  reader-backdrop: "#f5f5f7"
  accent-warning: "#ab6400"
  accent-preview: "#8145b5"
  accent-link-bright: "#47c2ff"
  semantic-error: "#eb8e90"
  semantic-success: "#16a34a"
  annotation-yellow: "#ffe478"
  annotation-green: "#b9efc6"
  annotation-pink: "#ffc7de"
  annotation-blue: "#bcdcff"
  annotation-purple: "#e0c8ff"
  annotation-default: "#ffe478"

typography:
  display-mega:
    fontFamily: "'Inter', -apple-system, system-ui, sans-serif"
    fontSize: 64px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -1.92px
  display-xl:
    fontFamily: "'Inter', sans-serif"
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -1.44px
  display-lg:
    fontFamily: "'Inter', sans-serif"
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -1.08px
  display-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.84px
  display-sm:
    fontFamily: "'Inter', sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.5px
  title-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  title-sm:
    fontFamily: "'Inter', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  body-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "'Inter', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: "'Inter', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  caption-uppercase:
    fontFamily: "'Inter', sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.88px
    textTransform: uppercase
  code:
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  button:
    fontFamily: "'Inter', sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: 0
  nav-link:
    fontFamily: "'Inter', sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 20px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px

components:
  top-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.title-sm}"
    height: 48px
    borderBottom: "1px {colors.hairline}"
  save-indicator:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
  tool-rail:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xs}"
    border: "1px {colors.hairline}"
    shadow: "0 4px 12px rgba(0,0,0,0.04)"
    width: 48px
  tool-button:
    backgroundColor: transparent
    textColor: "{colors.body}"
    rounded: "{rounded.md}"
    size: 36px
  tool-button-armed:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    size: 36px
  tool-flyout:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.md}"
    padding: "{spacing.xxs}"
    border: "1px {colors.hairline}"
    shadow: "0 4px 12px rgba(0,0,0,0.04)"
  pdf-canvas:
    backgroundColor: "{colors.reader-backdrop}"
    textColor: "{colors.ink}"
  page-surface:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.xs}"
    shadow: "0 4px 12px rgba(0,0,0,0.04)"
    border: "1px {colors.hairline}"
  quick-box:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.md}"
    padding: "{spacing.xxs}"
    border: "1px {colors.hairline}"
    shadow: "0 4px 12px rgba(0,0,0,0.04)"
  color-swatch:
    rounded: "{rounded.pill}"
    size: 20px
    border: "1px {colors.hairline-strong}"
  annotation-highlight:
    backgroundColor: "{colors.annotation-default}"
    opacity: 0.4
  annotation-underline:
    borderColor: "{colors.annotation-default}"
  annotation-pen:
    strokeColor: "{colors.ink}"
  annotation-memo:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
    border: "1px {colors.hairline-strong}"
  annotation-comment-pin:
    backgroundColor: "{colors.surface-card}"
    borderColor: "{colors.ink}"
    opacity: 0.4
    size: 20px
  comment-bubble:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
    border: "1px {colors.hairline-strong}"
    shadow: "0 4px 12px rgba(0,0,0,0.04)"
  annotation-bank-panel:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    border: "1px {colors.hairline}"
    shadow: "0 4px 12px rgba(0,0,0,0.04)"
    width: 320px
  bank-list-item:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  bank-list-item-hover:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  zoom-control:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "{spacing.xxs} {spacing.sm}"
    border: "1px {colors.hairline}"
    shadow: "0 4px 12px rgba(0,0,0,0.04)"
  toc-panel:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    border: "1px {colors.hairline}"
    width: 280px
  empty-dropzone:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.muted}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    border: "1px dashed {colors.hairline-strong}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 10px 18px
    height: 40px
  button-secondary:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 9px 17px
    height: 40px
    border: "1px {colors.hairline-strong}"
  button-tertiary-text:
    backgroundColor: transparent
    textColor: "{colors.text-link}"
    typography: "{typography.button}"
  text-input:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 12px 16px
    height: 44px
    border: "1px {colors.hairline-strong}"
  badge-pill:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.caption-uppercase}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  toast:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.base}"
---

## Overview

Paper Mate is a web PDF reading companion for academic papers. The governing principle is **immersive, non-distracting reading**: the paper is the page; every piece of UI recedes behind it. The base canvas is a soft neutral backdrop (`{colors.reader-backdrop}`) that frames white page surfaces; near-black ink `{colors.ink}` (#171717) carries all UI text. The single primary voltage stays **pure black** (`{colors.primary}`), used scarcely. A small blue text-link accent (`{colors.text-link}`) is for inline links only.

UI runs **Inter** as the single sans family (display 600, body/UI 400-500). **JetBrains Mono** carries code/monospace surfaces (per CLAUDE.md, code surfaces use the mono family). A soft **annotation accent palette** (yellow / green / pink / blue / purple) is the only saturated color in the product — and it lives *on the paper*, as highlights, underlines, pen strokes, and comment pins, never on chrome.

**Key Characteristics:**
- Reader chrome is Obsidian-quiet: floating, hairline-bounded surfaces over the paper, single soft shadow tier.
- The PDF canvas is sacred — **no UI ever reflows or resizes it** (the toolbar rail, Annotation Bank, and quick-boxes all overlay).
- Annotation accent palette is the only saturated color, and only on the page.
- Pure black reserved for the rare primary action; text-link blue for inline links only.
- Inter for all UI; JetBrains Mono for code/monospace surfaces.
- Compact developer-ergonomic radii — 8px controls, 12px panels, 4px page surfaces.

## Colors

### Brand & Accent
- **Black** (`{colors.primary}` — #000000): The rare primary action. Used scarcely.
- **Black Active** (`{colors.primary-active}` — #1a1a1a): Press state.
- **Text Link Blue** (`{colors.text-link}` — #0d74ce): Inline links only — never on chrome or CTAs.

### Annotation Accent Palette
The only saturated color in the product, and only on the paper. Applied to highlights (at ~40% opacity), underlines, pen strokes, and comment pins. Quick-box color pickers offer this row.
- **Yellow** (`{colors.annotation-yellow}` — #ffe478): default highlight.
- **Green** (`{colors.annotation-green}` — #b9efc6).
- **Pink** (`{colors.annotation-pink}` — #ffc7de).
- **Blue** (`{colors.annotation-blue}` — #bcdcff).
- **Purple** (`{colors.annotation-purple}` — #e0c8ff).
- **Default** (`{colors.annotation-default}`): aliases yellow; the first-armed color.

### Surface
- **Reader Backdrop** (`{colors.reader-backdrop}` — #f5f5f7): The neutral floor the PDF pages sit on.
- **Canvas** (`{colors.canvas}` — #ffffff): White page surface and panel fill.
- **Canvas Soft** (`{colors.canvas-soft}` — #fafafa): Empty/dropzone fill.
- **Surface Card** (`{colors.surface-card}` — #ffffff): Floating chrome (rail, panels, quick-boxes).
- **Surface Strong** (`{colors.surface-strong}` — #f0f0f3): Armed tool state, hover rows, badges.
- **Surface Dark** (`{colors.surface-dark}` — #171717): Toast/notification only.

### Hairlines
- **Hairline** (`{colors.hairline}` — #f0f0f3): Default 1px divider and panel border.
- **Hairline Soft** (`{colors.hairline-soft}` — #f5f5f7): Lighter divider.
- **Hairline Strong** (`{colors.hairline-strong}` — #dcdee0): Stronger outline (inputs, memo border).

### Text
- **Ink** (`{colors.ink}` — #171717): UI text, emphasis.
- **Body** (`{colors.body}` — #60646c): Secondary/running UI text.
- **Muted** (`{colors.muted}` — #999999): Sub-labels, save indicator, empty-state copy.
- **Muted Soft** (`{colors.muted-soft}` — #cccccc): Disabled text.
- **On Primary / On Dark** (`#ffffff`): White text on black action / toast.

### Semantic
- **Warning** (`{colors.accent-warning}` — #ab6400).
- **Success** (`{colors.semantic-success}` — #16a34a): "Saved" confirmation accent.
- **Error** (`{colors.semantic-error}` — #eb8e90): Load/save failure.

## Typography

### Font Family
**Inter** is the single sans family across every UI role. **JetBrains Mono** carries code/monospace surfaces. Fallback: `-apple-system, system-ui, sans-serif`.

### Hierarchy

| Token | Size | Weight | Use |
|---|---|---|---|
| `{typography.display-mega}` | 64px | 600 | Reserved (large empty-state hero, if any) |
| `{typography.display-sm}` | 22px | 600 | Empty-state headline |
| `{typography.title-md}` | 18px | 600 | Panel titles (Annotation Bank, ToC) |
| `{typography.title-sm}` | 16px | 600 | Top-bar filename, list labels |
| `{typography.body-md}` | 16px | 400 | Default body, memo text |
| `{typography.body-sm}` | 14px | 400 | Bank rows, comment bubbles, memo |
| `{typography.caption}` | 13px | 400 | Save indicator, zoom %, page X/Y |
| `{typography.caption-uppercase}` | 11px | 600 | Badges, section labels |
| `{typography.code}` | 13px | 400 | Code/monospace surfaces — JetBrains Mono |
| `{typography.button}` | 14px | 500 | Action labels |

### Principles
- **Display/title weight stays 600**; UI body 400, action labels 500.
- **Negative letter-spacing on display sizes only.**
- **JetBrains Mono on every code/monospace surface.**

## Layout

### Spacing System
- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.base}` 16px · `{spacing.md}` 20px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px.

### Reader Frame
- **Top bar:** 48px, hairline bottom border. Filename + save indicator left/center, Bank toggle + ToC right.
- **PDF canvas:** fills the remaining viewport on the `{colors.reader-backdrop}` floor. White `page-surface` cards centered, vertical scroll. **Fixed — never reflowed by chrome.**
- **Tool rail:** floating 48px-wide card, overlays the canvas at the left edge, collapsible. Does not consume canvas width.
- **Annotation Bank:** 320px floating panel, overlays the canvas at the right edge when open.
- **Zoom control:** floating pill, bottom-right corner.

### Whitespace Philosophy
Quiet and dense where it counts. Chrome hugs the edges and floats; the paper owns the center. Gaps inside panels sit at 8-12px.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Backdrop | `{colors.reader-backdrop}` (#f5f5f7) | The floor pages rest on |
| Page surface | `{colors.canvas}` + 1px `{colors.hairline}` + soft drop | PDF pages |
| Floating chrome | `{colors.surface-card}` + 1px `{colors.hairline}` + soft drop | Rail, panels, quick-boxes |
| Soft drop | `0 4px 12px rgba(0,0,0,0.04)` | Single shadow tier for all floats |
| Dark inversion | `{colors.surface-dark}` (#171717) | Toast only |

One shadow tier only. No atmospheric decoration — restraint keeps the paper dominant.

## Shapes

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Page surface corners, inline tags |
| `{rounded.sm}` | 6px | Bank rows, memo |
| `{rounded.md}` | 8px | Tool buttons, controls, quick-boxes, inputs |
| `{rounded.lg}` | 12px | Tool rail, panels, dropzone |
| `{rounded.pill}` | 9999px | Color swatches, zoom pill, badges |
| `{rounded.full}` | 9999px | Comment pins |

## Components

### Top Bar & Status

**`top-bar`** — Background `{colors.canvas}`, 48px, 1px `{colors.hairline}` bottom border. Filename in `{typography.title-sm}`, `save-indicator` adjacent, Bank + ToC toggles right.

**`save-indicator`** — Text-only. `Saving…` in `{colors.muted}` → `Saved` flashing `{colors.semantic-success}`, settling to `{colors.muted}`. `{typography.caption}`.

**`toast`** — Transient notice (errors). Background `{colors.surface-dark}`, text `{colors.on-dark}`, `{rounded.md}`. Bottom-center.

### Tool Rail

**`tool-rail`** — Floating left toolbar. Background `{colors.surface-card}`, `{rounded.lg}`, 1px `{colors.hairline}`, soft drop, 48px wide. Overlays the canvas; collapsible (`[` toggle). Holds tool buttons top→bottom: cursor (with flyout), highlight, underline, pen, memo, comment, box-select, ToC.

**`tool-button`** — 36px, transparent, icon in `{colors.body}`, `{rounded.md}`. Hover → `{colors.surface-strong}`.

**`tool-button-armed`** — Selected/armed tool. Background `{colors.surface-strong}`, icon `{colors.ink}`. The armed tool **stays armed** until another is chosen.

**`tool-flyout`** — Secondary picker off a rail button (cursor → cursor / hand / box-select). Background `{colors.surface-card}`, `{rounded.md}`, 1px `{colors.hairline}`, soft drop.

### PDF Surface

**`pdf-canvas`** — The scroll region. Background `{colors.reader-backdrop}`. Hosts centered `page-surface` cards. Pixel-stable: chrome never changes its box.

**`page-surface`** — One rendered PDF page. Background `{colors.canvas}`, `{rounded.xs}`, 1px `{colors.hairline}`, soft drop.

**`zoom-control`** — Floating pill, bottom-right. `−` / live `%` / `+` in `{typography.caption}`. Background `{colors.surface-card}`, `{rounded.pill}`, 1px `{colors.hairline}`, soft drop.

### Quick-Box (contextual)

**`quick-box`** — Floating popup at drag-release, **contents depend on active mode** (see EXPERIENCE.md interaction specs). Background `{colors.surface-card}`, `{rounded.md}`, 1px `{colors.hairline}`, soft drop. Never shifts the canvas.
- *Selection mode* → tool-type picker (highlight / underline / comment / memo icons).
- *Highlight or underline mode* → `color-swatch` row.
- *Pen mode* → `color-swatch` row + stroke-width steps.
- *Memo mode* → inline `text-input` + color/size.
- *Comment mode* → `comment-bubble` opens directly.

**`color-swatch`** — 20px pill, the annotation accent token as fill, 1px `{colors.hairline-strong}` ring; armed swatch gets a 2px `{colors.ink}` ring.

### Annotations (on the page)

**`annotation-highlight`** — Accent token fill at ~0.4 opacity over the text run.

**`annotation-underline`** — 2px accent-token underline under the text run.

**`annotation-pen`** — Freehand vector stroke in the chosen accent or `{colors.ink}`; stroke width from the pen quick-box.

**`annotation-memo`** — Free-floating text box typed onto the page. Background `{colors.surface-card}`, `{rounded.sm}`, 1px `{colors.hairline-strong}`, `{typography.body-sm}`. Does not displace page text.

**`annotation-comment-pin`** — A comment both **highlights the underlying text** (accent at ~0.4) **and** anchors a fixed comment-bubble glyph (`{colors.surface-card}` body, `{colors.ink}` border, not tinted to the mark's own accent) floating just above the run at ~0.4 opacity, to mark it as a comment. Click opens the `comment-bubble`.

**`comment-bubble`** — The comment's note. Background `{colors.surface-card}`, `{rounded.md}`, 1px `{colors.hairline-strong}`, soft drop, `{typography.body-sm}`. Opens on pin click.

### Annotation Bank

**`annotation-bank-panel`** — 320px floating panel, overlays the canvas right edge, toggled (`Ctrl B`). Background `{colors.surface-card}`, 1px `{colors.hairline}`, soft drop. Title in `{typography.title-md}`; scrollable list of `bank-list-item`.

**`bank-list-item`** — One annotation row: type glyph + color dot + snippet/page. `{typography.body-sm}`, `{colors.body}`, `{rounded.sm}`. Hover → `bank-list-item-hover` (`{colors.surface-strong}`). Click jumps the canvas to the annotation and flashes the target.

### Navigation & Entry

**`toc-panel`** — Table-of-contents overlay, 280px. Background `{colors.surface-card}`, 1px `{colors.hairline}`, `{typography.body-sm}` rows; click jumps.

**`empty-dropzone`** — S0 state, no PDF loaded. Background `{colors.canvas-soft}`, 1px dashed `{colors.hairline-strong}`, `{rounded.lg}`. Copy `Drop a PDF here` in `{colors.muted}` + a `button-secondary` to browse.

### Generic Controls

**`button-primary`** — Black action. Background `{colors.primary}`, text `{colors.on-primary}`, `{rounded.md}`. Used scarcely.

**`button-secondary`** — White, 1px `{colors.hairline-strong}` border.

**`button-tertiary-text`** — Inline blue text link.

**`text-input`** — Background `{colors.surface-card}`, 1px `{colors.hairline-strong}`; focus thickens to 2px `{colors.ink}`.

**`badge-pill`** — Uppercase pill, `{colors.surface-strong}`, `{typography.caption-uppercase}`.

## Do's and Don'ts

### Do
- Keep the PDF canvas pixel-stable — rail, Bank, and quick-boxes **overlay**, never reflow it.
- Reserve the annotation accent palette for marks on the page.
- Use one soft shadow tier for all floating chrome.
- Use Inter for UI (600 display/title, 400-500 body/labels); JetBrains Mono for code surfaces.
- Default highlight to `{colors.annotation-default}` (yellow); let the quick-box recolor.
- Keep chrome quiet and edge-hugging; let the paper own the center.

### Don't
- Don't let any panel or popup resize or shift the PDF canvas.
- Don't put a saturated color on chrome — accents live on the paper only.
- Don't use blue (`{colors.text-link}`) on a button — inline links only.
- Don't stack multiple shadow tiers or add atmospheric decoration.
- Don't make the rail a fixed gutter — it floats and collapses over the canvas.

## Platform

Desktop web only (Chrome + Firefox). No mobile/tablet layouts in v1. No responsive collapse strategy — the reader frame assumes a desktop viewport. Behavioral and storage platform notes live in EXPERIENCE.md and the PRD addendum.

## Known Gaps

- Inter and JetBrains Mono are freely available — no licensing concerns.
- Animation timings (panel slide, jump-flash) specified behaviorally in EXPERIENCE.md; easing values out of scope here. Respect `prefers-reduced-motion`.
- Dark mode not defined for v1 (dark tokens retained for toast only).
- Phase 2/3 surfaces (inline reference previews, Library, AI chat) not yet styled — to be added when those phases are designed.
