---
title: 'Ctrl+Arrow page-nav aliases'
type: 'feature'
created: '2026-06-28'
status: 'done'
route: 'one-shot'
---

# Ctrl+Arrow page-nav aliases

## Intent

**Problem:** The PDF reader only moved a page at a time via `PgUp`/`PgDn`; users expect `Ctrl+↑` / `Ctrl+↓` to do the same, but no such binding existed.

**Approach:** Extend the existing `.pdf-canvas` `handleKeyDown` so `Ctrl+ArrowDown` aliases `PgDn` (forward) and `Ctrl+ArrowUp` aliases `PgUp` (backward), reusing the same `pageNavTarget` clamp + scroll path. The Ctrl match is exclusive (no Shift/Alt/Meta) so adjacent chords — notably `Ctrl+Shift+Arrow` text selection over the page text layer — pass through. The EXPERIENCE.md keyboard map was updated in lockstep.

## Suggested Review Order

1. [client/src/Reader.tsx](../../client/src/Reader.tsx) — `handleKeyDown`: the alias match and the Ctrl-only modifier guard (the one behavioral decision).
2. [client/src/Reader.test.tsx](../../client/src/Reader.test.tsx) — interception + modifier-exclusion + direction-delta assertions.
3. [EXPERIENCE.md](../../EXPERIENCE.md) — keyboard-map row updated to document the `Ctrl ↑/↓` alias.
