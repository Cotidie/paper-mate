# Paper Mate — PRD Addendum

Technical-how and downstream depth that does not belong in the PRD narrative. Feeds architecture / UX work.

## Storage layout & the Firefox/disk tension

- **Decision:** local-first, on disk. A dedicated folder (e.g. `~/.paper-mate/`) holds each uploaded PDF alongside its annotations, side by side. IndexedDB is a nice-to-have (cache/index). Sync, WebDAV, cloud, and import/export are explicitly later.
- **Tension:** writing to `~/.paper-mate/` from a *pure web app* requires the **File System Access API** — supported in Chrome, **not in Firefox**. The "Chrome + Firefox" runtime requirement therefore forces an architectural choice:
  - **Option A — local backend/desktop shell** (e.g. a small local server, or Tauri/Electron): real disk access in both browsers, satisfies on-disk requirement uniformly. Heaviest.
  - **Option B — File System Access API on Chrome, IndexedDB fallback on Firefox**: pure web, but Firefox loses the on-disk folder (annotations live in IndexedDB there). Splits behavior by browser.
  - **Option C — manual file open/save** (download/upload sidecar): works everywhere, weakest UX, conflicts with "reserved annotations" feeling automatic.
- Resolve in architecture. Decision affects FR-21/FR-22 and NFR-4.

## Spatial-anchor model (through-line)

One coordinate/anchor model designed once in v1, consumed across all phases:

- Anchor = `page index + rect (and/or text range)` in PDF coordinate space, independent of zoom/scroll.
- Consumers: v1 annotations (FG-A..E), Phase 2 inline-preview triggers (`Figure N`, footnotes, `[1]`), Phase 3 click/drag-to-chat target resolution and Figure/Table selection.
- NFR-3 (anchor fidelity across zoom) is the v1 proof this model holds.

## Agent abstraction (through-line, Phase 3)

- Local agent CLIs only — no hosted API.
- One switchable interface so Claude / Codex / Antigravity are interchangeable.
- Default paper-digest context injection is vendor-agnostic (built on the digest, not on a vendor's API shape).

## Tech stack

Not yet chosen. Repo is pre-implementation (only README/DESIGN/BMad). Stack decision belongs to architecture; record real build/test/run commands in `CLAUDE.md` once scaffolded.

## Design source caveat

`DESIGN.md` frontmatter is `Expo-design-analysis`. Use its **token scales** (`colors.*`, `typography.*`, `spacing.*`, `rounded.*`) and the immersion principle only; the component catalog (hero, pricing, device-mockup) is Expo marketing and does not map to Paper Mate. Retarget the component layer to the reader UI.
