# Library layout redesign: drop the top bar, Add dropdown, version display

## Problem

The Library page (Story 6.1 shell + Story 6.3 table + Story 6.4 bulk upload) currently has a top bar (`Paper Mate` title + a bare `Add` button) above a two-pane body (folder panel + main table). The user wants a flatter layout matching a reference app (Anara): no top bar/title at all, the file count and Add control sharing one row inside the main pane, and the Add control expanded into a dropdown offering "File upload" vs. "Folder upload" (a whole directory of PDFs at once). A separately-queued small request (show the app version somewhere in the Library) lands naturally in the same redesign, at the bottom of the restyled left pane.

## Scope

- Remove `library-top-bar` entirely: no `Paper Mate` title, no separate header row. `document.title` (browser tab) is unaffected.
- The `N files in library` count line and the `Add` control move into one row at the top of the main pane, replacing where the count line used to render (inside `CollectionTable`) — the count line moves up into `LibraryPage`.
- `Add` becomes a button that opens a small dropdown (`role="menu"`) with two items: **File upload** and **Folder upload**. No third "New note" or "Import" item (those aren't Paper Mate features) — narrower than the Anara reference by design.
- **Folder upload** uses the browser's native directory picker (`webkitdirectory`), recursively collects every file in the chosen folder (and subfolders), and **silently filters to PDFs client-side** before handing the rest to the existing Story 6.4 bulk-upload pipeline (`uploadFiles`). A folder full of images/READMEs never produces a wall of failure toasts.
- Left pane (`library-folder-panel`) gets a "quiet refresh": a `LIBRARY` caption label, `All` rendered as a selected-nav-item pill (dark background, matching `--color-ink`), and the app version pinned at the bottom of the pane. Still Paper Mate's existing light/hairline theme — **no new dark-theme tokens**, no broader restyle of the app chrome. Epic 7's real folder CRUD still owns turning this into a real folder list.
- Version display reuses the exact `fetchHealth()`-on-mount pattern `ReaderPage.tsx` already uses for its settings-panel version badge — same API call, same "stays `null` and simply doesn't render on failure" behavior, just rendered in the folder panel instead of a settings modal.
- No backend change. No new `/api` surface. `GET /api/health` (version) and `POST /api/docs` (upload) are the only endpoints touched, and both already exist.

## Architecture

Three independent pieces, one shared consumer (`LibraryPage`):

1. **Top-bar removal + count/Add row hoist** — `LibraryPage.tsx` structural change. `CollectionTable` stops owning the count paragraph (a pure `rows`/`pendingRows` → DOM presentational component going forward); `LibraryPage` renders the count line itself, in the same row as the new `AddMenu`.
2. **`AddMenu`** — a new, small, Library-only component (`client/src/library/AddMenu.tsx` + `.css` + `.test.tsx`). Single consumer (this row), so it is **not** promoted to a shared `components/` primitive — that would be premature given nothing else needs a dropdown menu yet. Owns its own open/closed state and the show/hide interaction; takes `onFileUpload: () => void` and `onFolderUpload: () => void` callbacks and never touches `uploadFiles` itself (keeps the same downward-dependency shape Story 6.4 established: view → hook → api client).
3. **Left-pane restyle + version label** — CSS-only changes to `LibraryPage.css`'s `.library-folder-panel` rules, plus a small `fetchHealth()`-on-mount effect in `LibraryPage` (mirroring `ReaderPage.tsx`'s existing one) feeding a `<span>` at the bottom of the pane.

## Component-level design

### `LibraryPage.tsx`

- Delete the `<header className="library-top-bar">` block (title span, old `Add` button, old hidden `<input>`) entirely.
- New top row inside `.library-main`, above the table/dropzone: `<div className="library-toolbar">` containing the count line (`{papers.length} files in library`, moved verbatim out of `CollectionTable`) and `<AddMenu onFileUpload={...} onFolderUpload={...} />`. This row is **only** shown once the collection isn't in the bare-empty-dropzone state (mirrors today's "loading → table+pendingRows → dropzone" branching di Story 6.4 already built) — the empty-state `EmptyDropzone` keeps its own "Drop PDFs here / or browse…" copy untouched, no `AddMenu` duplicated there.
- Two hidden `<input type="file">` elements, same as today's single `library-add-input` but now two: one plain `multiple accept="application/pdf"` (file upload), one with `webkitdirectory` **and** `directory` (folder upload) set imperatively via a `useEffect` + ref (TypeScript's `InputHTMLAttributes` has neither field; older WebKit only recognized the unprefixed `directory`, so both are set for cross-browser safety — `inputRef.current?.setAttribute("webkitdirectory", ""); inputRef.current?.setAttribute("directory", "")` on mount).
- Folder-upload `onChange` handler: `Array.from(e.target.files ?? [])`, filter to `f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")` (mirrors the existing `accept="application/pdf"` intent, belt-and-suspenders since directory picks don't respect `accept`), then `uploadFiles(filtered)` — if the filtered list is empty (a folder with zero PDFs), do nothing (no empty-batch toast; `uploadFiles([])` already no-ops per Story 6.4's `useBulkUpload`).
- New `version` state + `useEffect(() => { fetchHealth().then(...).catch(() => {}) }, [])`, identical shape to `ReaderPage.tsx`'s existing one (`live` flag guard against unmount).

### `AddMenu.tsx` (new)

- Props: `{ onFileUpload: () => void; onFolderUpload: () => void }`.
- Local state: `open: boolean`. A `rootRef` wraps the button + popover (same shape as `ToolRail`'s flyout wrapper).
- Button: `+ Add` (reuses the existing `Plus` Phosphor icon, no added caret/chevron — the reference screenshot's Add button has none either; the dropdown-on-click behavior is the only affordance), `aria-haspopup="menu"`, `aria-expanded={open}`, toggles `open` on click.
- Popover (`role="menu"`, only rendered while `open`): two `role="menuitem"` rows —
  - `FileArrowUp` + "File upload" → calls `onFileUpload()`, closes the menu.
  - `FolderOpen` + "Folder upload" → calls `onFolderUpload()`, closes the menu.
- Keyboard access is plain Tab order — each menu item is a real, focusable `<button role="menuitem">`. No arrow-key roving-tabindex navigation between the two items; matches the existing `ToolFlyout` precedent (its buttons are also plain-Tab, no arrow-key nav) and is proportionate for a 2-item menu (YAGNI on full WAI-ARIA menu keyboard semantics).
- Dismiss: a `useEffect` (only registered while `open`) adding **document-level** `pointerdown` (outside `rootRef` → close) and `keydown` (`Escape` → close) listeners, exactly mirroring `ToolRail.tsx`'s existing flyout-dismiss effect (CLAUDE.md's standing "bind interaction handlers at document level" convention). On close via Escape or an item click, focus returns to the `Add` button (`buttonRef.current?.focus()`).
- CSS (`AddMenu.css`): popover positioned `absolute; top: 100%; right: 0` under the button (opens downward, right-aligned — unlike `ToolFlyout`'s `left: 100%` sideways rail anchor, which doesn't fit this context), reusing existing tokens only: `--color-surface-card`, `--color-hairline`, `--radius-md`, `--shadow-card` (all already defined, used by `ToolFlyout`/other floating surfaces) — no new tokens needed for the menu shell itself. One new dim if needed (menu width) goes in `client/src/theme/components.css`, token-only per `no-raw-values.test.ts`.

### `CollectionTable.tsx`

- Remove the `<p className="collection-table__count">` line and the `rows.length` computation from this component — `pendingRows`/`rows` rendering is otherwise unchanged. `TableSkeleton` loses its matching count-skeleton placeholder too (that placeholder existed only to reserve the count line's height in this component; the real one now lives in `LibraryPage`, which needs its own equivalent placeholder — see below).
- `LibraryPage`'s new toolbar row needs to reserve its own height while `loading` (so the skeleton state doesn't jump when data lands) — same problem Story 6.3's Codex review already fixed once for the in-table count line, now relocated. The `library-toolbar` renders even during `loading` (count text swapped for a skeleton pulse bar, `Add` control still interactive — uploading while the initial fetch is in flight already works per Story 6.4's fixes).

### Left pane (`LibraryPage.css`)

- `.library-folder-panel` gains a small header (`LIBRARY`, `{typography.caption-uppercase}`, `{colors.muted}`) above the existing `All` placeholder.
- `All` becomes a pill: `background: var(--color-ink); color: var(--color-canvas); border-radius: var(--radius-pill);` (same ink/canvas pairing the `library-add-button` and selected table rows already use elsewhere) — still just a static placeholder, no click behavior yet (Epic 7 owns real folder switching).
- Version label: `position: absolute` or a flex `margin-top: auto` pinned to the bottom of the panel (panel is already `display: flex; flex-direction: column` in spirit — confirm/adjust in implementation), `{typography.caption}`, `{colors.muted}`, text `v{version}` (or nothing while `version` is `null`).

## Edge cases

- **Folder picker on non-Chromium browsers:** `webkitdirectory` is Chromium/Firefox/Safari-supported today (it's a de facto standard despite the vendor prefix) but not part of any spec; if a browser ever ignores it, the input just behaves like a normal multi-file picker — no crash, graceful degradation.
- **Folder upload finds zero PDFs:** no-op, no toast (matches "N files in library" not incrementing for a no-op action; `uploadFiles([])` already returns early).
- **Add menu open during an in-flight upload:** unaffected — `AddMenu` doesn't know about upload state, it only fires the two callbacks; `uploadFiles` handles concurrency/dedupe exactly as Story 6.4 already built. A user can open Add and enqueue a second batch while a first is still uploading (already correctly capped by the shared semaphore from the Story 6.4 code-review fix).
- **Very long folder picks (hundreds of files):** no additional client-side cap beyond the existing `UPLOAD_CONCURRENCY = 4` throttle; this redesign doesn't add a max-batch-size guard (not requested, YAGNI — the existing pending-rows list simply grows).
- **Toolbar row during the true empty state:** not shown — the empty-state `EmptyDropzone` replaces the whole main-pane content exactly as Story 6.4 built it; the count+Add toolbar only appears once there's at least one real or pending row (or during the initial loading skeleton).

## Testing

- `AddMenu.test.tsx` (new): closed by default; click opens the menu (`role="menu"` present); clicking "File upload" calls `onFileUpload` and closes the menu; clicking "Folder upload" calls `onFolderUpload` and closes the menu; `Escape` while open closes it and returns focus to the Add button; a `pointerdown` outside the component closes it; a `pointerdown` inside (e.g. on a menu item) does not spuriously close before the item's own click fires.
- `LibraryPage.test.tsx`: no `Paper Mate` text anywhere; the count line and an `Add` button render in the same row once papers/pending exist; picking files via the "File upload" path still uploads (regression coverage reusing Story 6.4's existing bulk-upload assertions, just routed through the new menu item instead of a bare button); a mocked folder pick containing a `.txt` and two `.pdf`s only calls `uploadDoc` twice (the non-PDF never reaches `uploadFiles`); the version string appears after a mocked `fetchHealth` resolves and is absent if it rejects.
- `CollectionTable.test.tsx`: the count-line assertions currently in this file move to `LibraryPage.test.tsx`; add/keep a case confirming `CollectionTable` itself no longer renders any count text (guards against a future accidental re-add in the wrong component).
- Live smoke (per this repo's CLAUDE.md convention — own fresh dev servers, not the user's): confirm the top bar is gone, the Add dropdown opens/closes correctly (click, Escape, outside-click), a real folder pick (OS folder-select dialog) uploads only its PDFs, and the version label renders the real `GET /api/health` version. Not a DPR-sensitive/placement feature, so the AE-5 DPR>1 gate doesn't apply (same call as Stories 6.3/6.4).
