---
title: "Product Brief: Paper Mate"
status: complete
created: 2026-06-27
updated: 2026-06-28
---

# Product Brief: Paper Mate

## Executive Summary

Paper Mate is a web-based PDF reader for people who read academic papers and textbooks deeply, built on one stubborn principle: the page never moves. Today's best web annotators reflow the document on every highlight or comment and surround it with permanent chrome, so the act of marking up fights the act of reading. Paper Mate puts annotation on an overlay, summons UI only when asked, and is driven from the keyboard, so a dense paper can be read and annotated in one unbroken sitting.

v1 is tightly scoped to the reading and annotation experience: open a local PDF; highlight, underline, and comment without reflow; navigate by table of contents; and reopen later to find every mark exactly where it was, saved to a local sidecar file that keeps your notes private and portable. The first user is the builder and a circle of fellow grad students; success is simply that it replaces the tools they tolerate today.

The longer arc is a local-first paper-reading companion: in-place figure and citation previews, then an AI companion powered by local agents (Claude, Codex, Antigravity) that reasons about the paper without anything leaving the reader's machine. v1 builds the local storage and spatial-anchor foundations that make that future a natural next step rather than a rewrite.

## The Problem

Reading academic papers and e-textbooks means living inside a PDF for hours, but the tools made to mark them up actively break the reading experience.

Today's best-in-class web annotator (Kami) has a strong annotation system, yet every annotation action **reflows the page**: dropping a highlight or comment shrinks and expands the PDF area, and the comment composer opens as a separate right-hand panel that squeezes the page smaller still. The reader's eye is pulled off the text on every mark. Annotation and reading compete instead of compose.

Three compounding frictions:
- **Layout reflow.** Annotation UI resizes the PDF instead of overlaying it. Immersion breaks on every action.
- **Modal tooling.** You must switch modes (highlight / comment / select) in a left toolbox before acting; forget, and a stray drag spawns an unwanted comment box.
- **No structural navigation.** No table of contents, so moving through a long paper or textbook is scroll-and-hunt.

Chrome and panels permanently claim screen space the PDF should own. For someone reading several papers a week, this tax is paid every session, which is why a reader who otherwise likes their annotator still wants out.

## The Solution

Paper Mate is a web PDF reader where **the page never moves**. Annotation lives on a transparent layer over the PDF, so highlighting, underlining, and commenting leave the document exactly where it sits. The reader's eye never gets yanked off the text.

The reading surface is the whole screen. Every piece of UI is summoned, not stationed:

- **Reflow-free annotation.** Highlights and underlines paint onto an overlay. A comment opens as a small popover anchored to the marked spot, floating above the page, never a side panel that shrinks it.
- **Hybrid interaction.** Default mode is just *read* and *select* — a stray drag does nothing destructive. Select text and a small floating menu offers highlight / underline / comment right there. For sustained work, the left **toolbox drawer** sets a persistent tool. No mode to forget, no drawer trip required for a quick mark.
- **Keyboard-first.** Every tool and mode has a single-key shortcut (e.g. `V` select, `H` highlight, `U` underline, `C` comment, `T` table of contents, `B` toggle bank, `Esc` back to select), with `Ctrl +/-` zoom. Hands stay on the keyboard; the toolbox drawer is for discovery, not a required stop.
- **Collapsible chrome.** The left toolbox drawer and the right **Annotation Bank** (a running list of every mark and note) both toggle fully off, reclaiming 100% of the width for the page.
- **Structural navigation.** A table of contents lets you jump through a long paper or textbook by section instead of scrolling blind.
- **Persistent across sessions.** Reopen a PDF and every mark is exactly where you left it. Annotations are saved to a sidecar file alongside the PDF, the document is recognized by its content (rename-safe), and each mark re-resolves to its page, position, and quoted text at any zoom.
- **Local and private.** Annotations live in a local sidecar file with no account and no cloud, so they survive a browser wipe, travel with the document, and never leave your machine, which also sets up local-agent AI cleanly in later phases.
- **Export.** Save the PDF with your annotations baked in, to read or share outside the app.

The outcome: you open a paper, read it edge to edge, mark it up without ever breaking stride, and walk away with a durable annotated record, all without the tool ever competing with the text.

## What Makes This Different

Honest version: in v1 there is no defensible technology; the edge is taste and execution on the one thing incumbents get wrong. Kami and similar web annotators reflow the page and station chrome around it; Paper Mate refuses to. Reflow-free overlay annotation, keyboard-first interaction, and a local-first sidecar that never holds your notes hostage add up to a reading experience that stays out of the way: precisely what deep readers want, and what current tools break.

The durable differentiator comes later: **local-agent AI** (Phase 3). v1 deliberately lays its foundation: the local-first storage and the spatial-anchor model that maps any mark or click to an exact spot in the PDF. That companion then becomes a natural extension rather than a bolt-on.

## Who This Serves

**Primary: the deep reader.** Grad students and researchers (the builder included) who live in papers and e-textbooks for hours, read on a laptop, and annotate to *understand*, not just to mark. They read several papers a week, care about flow, and are comfortable with keyboard-driven tools. Success for them: finishing a dense paper in one immersive sitting, with a clean annotated record they can return to.

Not built for casual one-off PDF viewers or for collaborative/team annotation. Single-reader, depth-first.

## Success Criteria

This is a personal tool, so success is adoption-by-the-builder first, then a small circle:

- **The dogfood test.** The builder drops Kami and uses Paper Mate as the daily driver for real paper and textbook reading.
- **Immersion holds.** A dense paper can be read and annotated start to finish without the page ever resizing and without leaving the app.
- **Zero annotation loss.** Reopen any previously annotated PDF and every mark restores correctly, across browser restarts.
- **Peer pull.** A handful of fellow grad students adopt it unprompted and keep using it.

## Scope

**v1 is Phase 1 only: the immersive PDF viewer/annotator.** The boundary is deliberately tight.

**In:**
- Open a single local PDF (picked each session)
- Overlay highlight, underline, and text comment, none of which reflow the page
- Drag-to-annotate plus the hybrid model: floating selection menu and a persistent left toolbox drawer
- Single-key shortcut per tool/mode, keyboard-first
- Toggleable toolbox drawer and right-side Annotation Bank, both collapsible to reclaim full width
- Table-of-contents navigation
- Zoom (`Ctrl +/-`)
- Sidecar-file persistence with exact restoration of annotations on reopen
- Export an annotated PDF

**Explicitly out (later phases):**
- Library / folder management (Phase 2)
- Image, ink, or freehand comments
- Notes / markdown export (annotated PDF is the only export in v1)
- Accounts, sync, collaboration
- All AI features (Phase 3)
- Figure / footnote / reference previews and metadata extraction (Phase 2)

## Vision

Paper Mate grows from an immersive annotator into a complete paper-reading companion, in three phases:

- **Phase 1 (v1): Viewer / Annotator.** Shipped as v1, described above.
- **Phase 2: Reading Helper.** In-place previews for figures, tables, footnotes, and citations (click `Figure 1` or `[2]` and see it without losing your place), paper metadata extraction, annotated-PDF and notes export, and folder-based library management.
- **Phase 3: AI Companion.** Local-agent Q&A with the paper digested into context by default, Claude / Codex / Antigravity vendor switching, visual explanation via image generation, and click/drag-to-chat that points the agent at the exact place in the PDF the reader selected.

In two to three years this is the tool a researcher opens to read, understand, and interrogate a paper end to end, on their own machine, without anything leaving it.
