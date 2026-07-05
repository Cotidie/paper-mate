# Library Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the Library's top bar, move the file count + a new Add dropdown (File upload / Folder upload) into one row in the main pane, restyle the left pane, and show the app version at the bottom of that pane.

**Architecture:** Four independent, sequential changes to `client/src/library/`: (1) left-pane restyle + version display, (2) top-bar removal with the count line hoisted from `CollectionTable` into a new `LibraryPage` toolbar row, (3) a new standalone `AddMenu` dropdown component built and tested in isolation, (4) wiring `AddMenu` into the toolbar in place of the plain button, plus a folder-upload input that filters to PDFs client-side before handing files to the existing Story 6.4 `uploadFiles` pipeline.

**Tech Stack:** React 19.2 + TypeScript 6.0, Vitest + `@testing-library/react`, `@phosphor-icons/react` 2.1.10, existing `client/src/api/client.ts` (`getLibrary`, `fetchHealth`, `uploadDoc` via `useBulkUpload`).

## Global Constraints

- **Tokens only, no raw hex/px** outside `client/src/theme/**` (enforced by `src/no-raw-values.test.ts`, which scans every `.tsx`/`.css` file except `theme/`, `schema.d.ts`, and `*.test.*`).
- **No em-dash (`—`) in any user-facing string** (labels, `aria-label`, tooltips, copy) — comments are exempt.
- **Bind interaction handlers at the document level** (key/pointer handlers on `document`, not a specific element), gated by open state, exempting nothing else needed here (CLAUDE.md engineering principle; mirrors `ToolRail.tsx`'s existing flyout-dismiss effect).
- Run `cd client && npm test` (full suite) and `npm run typecheck` after every task — both must stay green (904 tests baseline before this plan).
- Every step's commands assume the working directory is `client/` unless stated otherwise.

---

## Task 1: Left-pane restyle + version display

**Files:**
- Modify: `client/src/library/LibraryPage.tsx`
- Modify: `client/src/library/LibraryPage.css`
- Modify: `client/src/library/LibraryPage.test.tsx`

**Interfaces:**
- Consumes: `fetchHealth(): Promise<HealthStatus>` from `@/api/client` (already exported; `HealthStatus = { status: "ok"; version: string }`).
- Produces: nothing new consumed by later tasks — this task is self-contained.

- [ ] **Step 1: Write the failing tests**

Open `client/src/library/LibraryPage.test.tsx`. In the shared `beforeEach` (currently only mocking `getLibrary`), add a `fetchHealth` stub so every existing test never hits the network (mirrors the exact convention already used in `client/src/reader/ReaderPage.test.tsx`'s `beforeEach`):

```ts
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [], folders: [] });
  // The Library fetches the version on mount (GET /api/health), same as
  // ReaderPage. Stub it so tests never hit the network; individual tests
  // override to assert the rendered value.
  vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "9.9.9" });
});
```

Then add a new `describe` block at the end of the file (after the `Code review fixes (Story 6.4)` block):

```ts
describe("Left pane (version display)", () => {
  it("shows the app version once fetchHealth resolves", async () => {
    vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "0.4.4" });
    renderLibrary();
    await waitFor(() => expect(screen.getByTestId("library-version").textContent).toBe("v0.4.4"));
  });

  it("renders no version label if fetchHealth fails", async () => {
    vi.spyOn(api, "fetchHealth").mockRejectedValue(new Error("boom"));
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
    expect(screen.queryByTestId("library-version")).toBeNull();
  });

  it("still exposes the Folders landmark and an active All item", () => {
    renderLibrary();
    expect(screen.getByLabelText("Folders")).toBeTruthy();
    expect(screen.getByText("All")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
npx vitest run src/library/LibraryPage.test.tsx
```

Expected: the 3 new tests in `Left pane (version display)` FAIL (`getByTestId("library-version")` finds nothing; the existing tests all still PASS since the `fetchHealth` stub is harmless).

- [ ] **Step 3: Add the version fetch + left-pane restyle to `LibraryPage.tsx`**

In `client/src/library/LibraryPage.tsx`, change the import line to also pull in `fetchHealth`:

```ts
import { getLibrary, fetchHealth, type CollectionRow, type Doc, type Library } from "@/api/client";
```

Add a `version` state and its fetch effect, right after the existing `fetchSeqRef` declaration (before the `mountedRef` effect):

```ts
  const [version, setVersion] = useState<string | null>(null);
```

And add this effect anywhere among the other `useEffect`s (e.g. right after the `mountedRef` effect):

```ts
  useEffect(() => {
    let live = true;
    fetchHealth()
      .then((h) => {
        if (live) setVersion(h.version);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
```

Replace the `<aside>` block:

```tsx
        <aside className="library-folder-panel" aria-label="Folders">
          <span className="library-folder-panel__placeholder">All</span>
        </aside>
```

with:

```tsx
        <aside className="library-folder-panel" aria-label="Folders">
          <span className="library-folder-panel__label">Library</span>
          <span className="library-folder-panel__item library-folder-panel__item--active">All</span>
          {version && (
            <span className="library-folder-panel__version" data-testid="library-version">
              v{version}
            </span>
          )}
        </aside>
```

- [ ] **Step 4: Restyle `LibraryPage.css`'s folder panel**

Replace this block in `client/src/library/LibraryPage.css`:

```css
/* Folder-panel region: static bounded placeholder in 6.1 (Epic 7 owns CRUD). */
.library-folder-panel {
  flex: 0 0 auto;
  width: var(--toc-panel-width);
  border-right: var(--hairline-width) solid var(--color-hairline);
  background: var(--color-surface-card);
  padding: var(--space-sm);
}

.library-folder-panel__placeholder {
  font-family: var(--font-sans);
  font-size: var(--type-body-sm-size);
  font-weight: var(--type-body-sm-weight);
  line-height: var(--type-body-sm-leading);
  color: var(--color-body);
}
```

with:

```css
/* Folder-panel region: static bounded placeholder in 6.1 (Epic 7 owns real
   folder CRUD). Restyled (quiet refresh): a caption label, "All" as a
   selected-nav-item pill, the app version pinned to the bottom via the
   column flex layout + margin-top: auto. */
.library-folder-panel {
  flex: 0 0 auto;
  width: var(--toc-panel-width);
  border-right: var(--hairline-width) solid var(--color-hairline);
  background: var(--color-surface-card);
  padding: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xxs);
}

.library-folder-panel__label {
  font-family: var(--font-sans);
  font-size: var(--type-caption-uppercase-size);
  font-weight: var(--type-caption-uppercase-weight);
  line-height: var(--type-caption-uppercase-leading);
  letter-spacing: var(--type-caption-uppercase-letter-spacing);
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: var(--space-xxs);
}

.library-folder-panel__item {
  font-family: var(--font-sans);
  font-size: var(--type-body-sm-size);
  font-weight: var(--type-body-sm-weight);
  line-height: var(--type-body-sm-leading);
  color: var(--color-body);
  padding: var(--space-xxs) var(--space-xs);
  border-radius: var(--radius-pill);
}

.library-folder-panel__item--active {
  background: var(--color-ink);
  color: var(--color-canvas);
}

.library-folder-panel__version {
  margin-top: auto;
  padding-top: var(--space-xs);
  border-top: var(--hairline-width) solid var(--color-hairline);
  font-family: var(--font-sans);
  font-size: var(--type-caption-size);
  font-weight: var(--type-caption-weight);
  line-height: var(--type-caption-leading);
  color: var(--color-muted);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/library/LibraryPage.test.tsx
```

Expected: all tests PASS (the 3 new ones, plus every pre-existing one — the `fetchHealth` stub doesn't change any existing assertion).

- [ ] **Step 6: Run the full suite, typecheck, and the raw-values guard**

```bash
npm test
npm run typecheck
npx vitest run src/no-raw-values.test.ts
```

Expected: all green (904 baseline tests + 3 new = 907; typecheck clean; no raw hex/px offenders).

- [ ] **Step 7: Commit**

```bash
git add client/src/library/LibraryPage.tsx client/src/library/LibraryPage.css client/src/library/LibraryPage.test.tsx
git commit -m "Feat: Restyle Library left pane and show app version"
```

---

## Task 2: Remove the top bar; hoist the count line into a new toolbar row

**Files:**
- Modify: `client/src/library/LibraryPage.tsx`
- Modify: `client/src/library/LibraryPage.css`
- Modify: `client/src/library/LibraryPage.test.tsx`
- Modify: `client/src/library/CollectionTable.tsx`
- Modify: `client/src/library/CollectionTable.css`
- Modify: `client/src/library/CollectionTable.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `.library-toolbar` row in `LibraryPage` (count text + a **plain** `Add` button for now — Task 4 swaps this button for `AddMenu`). `CollectionTable` no longer accepts or renders any count text; it is purely `rows`/`pendingRows`/`onOpenRow`/`loading` → DOM.

- [ ] **Step 1: Write the failing tests**

In `client/src/library/CollectionTable.test.tsx`, find this exact test (the first one in the file, inside `describe("CollectionTable (Story 6.3)")`):

```ts
  it("renders the four column headers and the count line", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    for (const label of ["Title", "Authors", "Added", "File type"]) {
      expect(screen.getByRole("columnheader", { name: label })).toBeTruthy();
    }
    expect(screen.getByText("3 files in library")).toBeTruthy();
  });
```

Replace it with these two tests:

```ts
  it("renders the four column headers", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    for (const label of ["Title", "Authors", "Added", "File type"]) {
      expect(screen.getByRole("columnheader", { name: label })).toBeTruthy();
    }
  });

  it("never renders a count line itself (Library layout redesign: LibraryPage owns it)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    expect(screen.queryByText(/files in library/)).toBeNull();
  });
```

Leave the existing `"shows skeleton rows and no real data while loading"` test untouched — it already asserts `expect(screen.queryByText(/files in library/)).toBeNull();`, and its skeleton-row assertion stays valid (`TableSkeleton`'s rows are unaffected by this task, only its count placeholder goes away in Step 3 below).

In `client/src/library/LibraryPage.test.tsx`, remove the "Paper Mate" branding assertion — replace:

```ts
  it("renders the empty-collection dropzone, app identity, and folder panel", async () => {
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
    expect(screen.getByText("Paper Mate")).toBeTruthy();
    expect(screen.getByLabelText("Folders")).toBeTruthy();
  });
```

with:

```ts
  it("renders the empty-collection dropzone and folder panel, with no app-name top bar", async () => {
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
    expect(screen.queryByText("Paper Mate")).toBeNull();
    expect(screen.getByLabelText("Folders")).toBeTruthy();
  });
```

Add one more test to the same `describe("Library shell (Story 6.1, AC-3)")` block confirming the count+Add row appears once there's data, and reserves space while loading:

```ts
  it("shows the count and an Add control in one row once the library has papers", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("1 files in library")).toBeTruthy());
    expect(screen.getByRole("button", { name: /add/i })).toBeTruthy();
  });

  it("shows a count skeleton (not the real count) while the library is still loading", async () => {
    let resolveFetch: (lib: api.Library) => void = () => {};
    vi.spyOn(api, "getLibrary").mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderLibrary();
    expect(document.querySelector(".library-toolbar__count-skeleton")).toBeTruthy();
    expect(screen.queryByText(/files in library/)).toBeNull();
    resolveFetch({ papers: [], folders: [] });
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
  });
```

- [ ] **Step 2: Run the tests to verify the new/changed ones fail**

```bash
npx vitest run src/library/CollectionTable.test.tsx src/library/LibraryPage.test.tsx
```

Expected: `"never renders a count line itself"` FAILS (`CollectionTable` still renders it today); `"renders the four column headers"` PASSES already (subset of the old test); the "Paper Mate" removal test FAILS (`queryByText("Paper Mate")` currently finds the brand span); the two new toolbar tests FAIL (`.library-toolbar__count-skeleton` doesn't exist yet, and the `Add` button only exists inside the old top bar today — actually it currently exists regardless of load state, so re-check: the "shows the count and an Add control in one row" test may partially pass today except for row-grouping; treat both as failing until Step 3/4 land, that's expected).

- [ ] **Step 3: Remove the count line from `CollectionTable.tsx`**

In `client/src/library/CollectionTable.tsx`, remove the count paragraph from `TableSkeleton`:

```tsx
function TableSkeleton() {
  return (
    <div className="collection-table-wrap">
      <table className="collection-table" aria-busy="true">
        <ColumnGroup />
        <TableHead />
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
            <tr key={i} className="collection-table__skeleton-row">
              {COLUMNS.map((label) => (
                <td key={label}>
                  <span className="collection-table__skeleton-cell" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

And remove the count paragraph from the real render (delete this line from the default export's JSX):

```tsx
      <p className="collection-table__count">{rows.length} files in library</p>
```

- [ ] **Step 4: Remove the now-dead count CSS from `CollectionTable.css`**

Delete these two rules (and the comment above the second one) from `client/src/library/CollectionTable.css`:

```css
.collection-table__count {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--type-caption-size);
  font-weight: var(--type-caption-weight);
  line-height: var(--type-caption-leading);
  color: var(--color-muted);
}
```

and:

```css
.collection-table__count-skeleton {
  width: var(--collection-table-file-type-width);
  /* Match the real count line's box height (font-size * line-height), not
     just its font-size, so the skeleton->loaded swap has no jump. */
  height: calc(var(--type-caption-size) * var(--type-caption-leading));
}
```

- [ ] **Step 5: Rebuild `LibraryPage.tsx`'s render — drop the top bar, add the toolbar row**

Replace the whole `return (...)` block in `client/src/library/LibraryPage.tsx` with:

```tsx
  return (
    <div className="library">
      <div className="library-body">
        <aside className="library-folder-panel" aria-label="Folders">
          <span className="library-folder-panel__label">Library</span>
          <span className="library-folder-panel__item library-folder-panel__item--active">All</span>
          {version && (
            <span className="library-folder-panel__version" data-testid="library-version">
              v{version}
            </span>
          )}
        </aside>
        <main
          className={mainClassName}
          role="main"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) uploadFiles(files);
          }}
        >
          {isTableLayout && (
            <div className="library-toolbar">
              {loading && papers.length === 0 && pending.length === 0 ? (
                <span
                  className="collection-table__skeleton-cell library-toolbar__count-skeleton"
                  aria-hidden="true"
                />
              ) : (
                <p className="library-toolbar__count">{papers.length} files in library</p>
              )}
              <button
                type="button"
                className="library-add-button"
                onClick={() => inputRef.current?.click()}
              >
                <Plus aria-hidden />
                Add
              </button>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="library-add-input"
            data-testid="library-add-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Reset so re-picking the same file(s) after a failure refires change.
              e.target.value = "";
              if (files.length > 0) uploadFiles(files);
            }}
          />
          {loading && papers.length === 0 && pending.length === 0 ? (
            <CollectionTable loading />
          ) : papers.length > 0 || pending.length > 0 ? (
            <CollectionTable
              rows={papers}
              pendingRows={pending}
              onOpenRow={(docId) => navigate(`/reader/${docId}`)}
            />
          ) : loadFailed ? null : (
            <EmptyDropzone onFiles={uploadFiles} />
          )}
        </main>
      </div>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
```

No new variable needed for the toolbar's visibility check: it's the exact same condition as the existing `isTableLayout` (`loading || papers.length > 0 || pending.length > 0`, already computed right above `mainClassName`), so the JSX above reuses `isTableLayout` directly rather than duplicating the expression.

(Note: `Plus` is already imported at the top of the file from `@phosphor-icons/react` — no import change needed in this task.)

- [ ] **Step 6: Rewrite `LibraryPage.css`'s top-bar/add-button rules into toolbar rules**

Delete these rules entirely from `client/src/library/LibraryPage.css`:

```css
.library-top-bar {
  height: var(--top-bar-height);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0 var(--space-base);
  background: var(--color-canvas);
  border-bottom: var(--top-bar-border) solid var(--color-hairline);
}

.library-top-bar__brand {
  font-family: var(--font-sans);
  font-size: var(--type-title-sm-size);
  font-weight: var(--type-title-sm-weight);
  line-height: var(--type-title-sm-leading);
  color: var(--color-ink);
}
```

Keep `.library-add-button`, `.library-add-button svg`, `.library-add-button:hover`, and `.library-add-input` exactly as they are (still used) — just add these two new rules right after `.library-add-input { display: none; }`:

```css
.library-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.library-toolbar__count {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--type-caption-size);
  font-weight: var(--type-caption-weight);
  line-height: var(--type-caption-leading);
  color: var(--color-muted);
}

.library-toolbar__count-skeleton {
  width: var(--collection-table-file-type-width);
  height: calc(var(--type-caption-size) * var(--type-caption-leading));
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/library/CollectionTable.test.tsx src/library/LibraryPage.test.tsx
```

Expected: all PASS.

- [ ] **Step 8: Run the full suite, typecheck, and the raw-values guard**

```bash
npm test
npm run typecheck
npx vitest run src/no-raw-values.test.ts
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add client/src/library/LibraryPage.tsx client/src/library/LibraryPage.css client/src/library/LibraryPage.test.tsx client/src/library/CollectionTable.tsx client/src/library/CollectionTable.css client/src/library/CollectionTable.test.tsx
git commit -m "Feat: Remove Library top bar, hoist count line into a toolbar row"
```

---

## Task 3: Build the `AddMenu` dropdown component in isolation

**Files:**
- Create: `client/src/library/AddMenu.tsx`
- Create: `client/src/library/AddMenu.css`
- Create: `client/src/library/AddMenu.test.tsx`
- Modify: `client/src/theme/components.css`

**Interfaces:**
- Produces: `export default function AddMenu({ onFileUpload, onFolderUpload }: { onFileUpload: () => void; onFolderUpload: () => void })` — a button that opens a `role="menu"` popover with two `role="menuitem"` buttons. Task 4 imports this as `import AddMenu from "@/library/AddMenu";` and wires the two callbacks to the file/folder hidden inputs.

- [ ] **Step 1: Write the failing tests**

Create `client/src/library/AddMenu.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AddMenu from "@/library/AddMenu";

afterEach(cleanup);

describe("AddMenu", () => {
  it("is closed by default", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the menu on click, with both items present", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /file upload/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /folder upload/i })).toBeTruthy();
  });

  it("calls onFileUpload and closes when File upload is clicked", () => {
    const onFileUpload = vi.fn();
    render(<AddMenu onFileUpload={onFileUpload} onFolderUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /file upload/i }));
    expect(onFileUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("calls onFolderUpload and closes when Folder upload is clicked", () => {
    const onFolderUpload = vi.fn();
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={onFolderUpload} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /folder upload/i }));
    expect(onFolderUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes and returns focus to the Add button on Escape", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    const button = screen.getByRole("button", { name: /add/i });
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside pointerdown", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("toggles closed when the Add button is clicked again while open", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    const button = screen.getByRole("button", { name: /add/i });
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/library/AddMenu.test.tsx
```

Expected: FAIL with a module-not-found error (`@/library/AddMenu` doesn't exist yet).

- [ ] **Step 3: Add the `--add-menu-width` token**

In `client/src/theme/components.css`, add this new block right after the existing `collection-table` section (before the final closing `}`):

```css

  /* add-menu (Library toolbar Add dropdown): File upload / Folder upload. */
  --add-menu-width: 180px;
```

- [ ] **Step 4: Create `AddMenu.tsx`**

Create `client/src/library/AddMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Plus, FileArrowUp, FolderOpen } from "@phosphor-icons/react";
import "@/library/AddMenu.css";

/**
 * The Library's Add control (Library layout redesign): a button that opens a
 * small dropdown offering "File upload" (one or more PDFs) or "Folder upload"
 * (every PDF in a chosen folder). Dismiss mirrors `ToolRail`'s flyout pattern:
 * document-level pointerdown/Escape close the menu (CLAUDE.md: bind
 * interaction handlers at document level), and closing returns focus to the
 * button. Presentational: never touches `uploadFiles` itself, just reports
 * which action the user picked via the two callbacks.
 */
export default function AddMenu({
  onFileUpload,
  onFolderUpload,
}: {
  onFileUpload: () => void;
  onFolderUpload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="add-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="add-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus aria-hidden />
        Add
      </button>
      {open && (
        <div className="add-menu__popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="add-menu__item"
            onClick={() => {
              close();
              onFileUpload();
            }}
          >
            <FileArrowUp aria-hidden />
            File upload
          </button>
          <button
            type="button"
            role="menuitem"
            className="add-menu__item"
            onClick={() => {
              close();
              onFolderUpload();
            }}
          >
            <FolderOpen aria-hidden />
            Folder upload
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `AddMenu.css`**

Create `client/src/library/AddMenu.css`:

```css
/* Add-button dropdown (Library layout redesign). Tokens only, no raw hex/px. */

.add-menu {
  position: relative;
}

.add-menu__button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xxs);
  font-family: var(--font-sans);
  font-size: var(--type-title-sm-size);
  color: var(--color-body);
  background: var(--color-canvas);
  border: var(--hairline-width) solid var(--color-hairline);
  border-radius: var(--radius-pill);
  padding: var(--space-xxs) var(--space-sm);
  cursor: pointer;
}

.add-menu__button svg {
  width: var(--pill-icon-size);
  height: var(--pill-icon-size);
  display: block;
}

.add-menu__button:hover {
  background: var(--color-surface-strong);
}

.add-menu__popover {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--space-xxs);
  width: var(--add-menu-width);
  display: flex;
  flex-direction: column;
  background: var(--color-surface-card);
  border: var(--hairline-width) solid var(--color-hairline);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  z-index: 4;
}

.add-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  width: 100%;
  font-family: var(--font-sans);
  font-size: var(--type-body-sm-size);
  color: var(--color-body);
  background: none;
  border: 0;
  border-bottom: var(--hairline-width) solid var(--color-hairline);
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
  text-align: left;
}

.add-menu__item:last-child {
  border-bottom: 0;
}

.add-menu__item:hover {
  background: var(--color-surface-strong);
}

.add-menu__item svg {
  width: var(--pill-icon-size);
  height: var(--pill-icon-size);
  display: block;
  flex: 0 0 auto;
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run src/library/AddMenu.test.tsx
```

Expected: all 7 tests PASS.

- [ ] **Step 7: Run the full suite, typecheck, and the raw-values guard**

```bash
npm test
npm run typecheck
npx vitest run src/no-raw-values.test.ts
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add client/src/library/AddMenu.tsx client/src/library/AddMenu.css client/src/library/AddMenu.test.tsx client/src/theme/components.css
git commit -m "Feat: Add AddMenu dropdown component (File upload / Folder upload)"
```

---

## Task 4: Wire `AddMenu` into `LibraryPage`, add folder upload

**Files:**
- Modify: `client/src/library/LibraryPage.tsx`
- Modify: `client/src/library/LibraryPage.test.tsx`

**Interfaces:**
- Consumes: `AddMenu` from Task 3 (`{ onFileUpload, onFolderUpload }`), `uploadFiles(files: File[]): void` from `useBulkUpload` (already in scope in `LibraryPage`).
- Produces: nothing new consumed elsewhere — this is the final integration task.

- [ ] **Step 1: Write the failing tests**

Add these to `client/src/library/LibraryPage.test.tsx`, in a new `describe` block after `Left pane (version display)`:

```ts
describe("Add dropdown (File upload / Folder upload)", () => {
  it("opens the Add menu and uploads via the File upload item", async () => {
    const backend = mockBackend();
    const doc = fakeDoc("m".repeat(64), "via-menu.pdf", "Via Menu Paper");
    vi.spyOn(api, "uploadDoc").mockImplementation(async () => backend.store(doc));
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /file upload/i }));

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("via-menu.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Via Menu Paper")).toBeTruthy());
  });

  it("filters a folder pick to PDFs before uploading (non-PDFs silently skipped)", async () => {
    const backend = mockBackend();
    const doc1 = fakeDoc("n".repeat(64), "paper-one.pdf", "Folder Paper One");
    const doc2 = fakeDoc("o".repeat(64), "paper-two.pdf", "Folder Paper Two");
    const uploadDoc = vi.spyOn(api, "uploadDoc").mockImplementation(async (file: File) => {
      if (file.name === "paper-one.pdf") return backend.store(doc1);
      if (file.name === "paper-two.pdf") return backend.store(doc2);
      throw new Error("should never be called for a non-PDF");
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /folder upload/i }));

    const readme = new File(["not a pdf"], "README.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("library-folder-input"), {
      target: { files: [pdfFile("paper-one.pdf"), readme, pdfFile("paper-two.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Folder Paper One")).toBeTruthy());
    expect(screen.getByText("Folder Paper Two")).toBeTruthy();
    expect(uploadDoc).toHaveBeenCalledTimes(2);
  });

  it("does nothing when a picked folder has zero PDFs", async () => {
    const uploadDoc = vi.spyOn(api, "uploadDoc");
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /folder upload/i }));

    const readme = new File(["not a pdf"], "README.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("library-folder-input"), {
      target: { files: [readme] },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(uploadDoc).not.toHaveBeenCalled();
    expect(screen.getByText("Drop PDFs here")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/library/LibraryPage.test.tsx
```

Expected: all 3 new tests FAIL (`getByRole("menuitem", ...)` finds nothing — the toolbar still has a plain `Add` button from Task 2, no menu yet; `library-folder-input` testid doesn't exist yet).

- [ ] **Step 3: Wire `AddMenu` + the folder input into `LibraryPage.tsx`**

Change the import block at the top of `client/src/library/LibraryPage.tsx` — remove the now-unused `Plus` import (it moved into `AddMenu`) and add the `AddMenu` import:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import "@/library/LibraryPage.css";
import Toast from "@/components/Toast/Toast";
import CollectionTable from "@/library/CollectionTable";
import EmptyDropzone from "@/components/EmptyDropzone/EmptyDropzone";
import AddMenu from "@/library/AddMenu";
import { useBulkUpload } from "@/library/useBulkUpload";
import { getLibrary, fetchHealth, type CollectionRow, type Doc, type Library } from "@/api/client";
```

Add a PDF-detection helper right after the imports (before `docToRow`):

```ts
const PDF_EXTENSION = /\.pdf$/i;

/** A folder pick returns every file type in the directory tree; this filters
 *  it down to PDFs before handing anything to `uploadFiles` (AC: folder
 *  upload silently skips non-PDF clutter rather than surfacing a failure
 *  toast per non-PDF file). */
function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXTENSION.test(file.name);
}
```

Rename the existing `inputRef` to `fileInputRef` and add a `folderInputRef`, right after the `navigate` line:

```ts
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
```

Add an effect to set the non-standard `webkitdirectory`/`directory` attributes on the folder input (React's `InputHTMLAttributes` has neither field). Add this among the other effects, e.g. right after the version-fetch effect from Task 1:

```ts
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);
```

Replace the toolbar's plain `<button>` + the single `<input>` (both currently referencing `inputRef`) with `AddMenu` plus two inputs. The toolbar `div` becomes:

```tsx
          {isTableLayout && (
            <div className="library-toolbar">
              {loading && papers.length === 0 && pending.length === 0 ? (
                <span
                  className="collection-table__skeleton-cell library-toolbar__count-skeleton"
                  aria-hidden="true"
                />
              ) : (
                <p className="library-toolbar__count">{papers.length} files in library</p>
              )}
              <AddMenu
                onFileUpload={() => fileInputRef.current?.click()}
                onFolderUpload={() => folderInputRef.current?.click()}
              />
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="library-add-input"
            data-testid="library-add-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Reset so re-picking the same file(s) after a failure refires change.
              e.target.value = "";
              if (files.length > 0) uploadFiles(files);
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="library-add-input"
            data-testid="library-folder-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).filter(isPdfFile);
              e.target.value = "";
              if (files.length > 0) uploadFiles(files);
            }}
          />
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/library/LibraryPage.test.tsx
```

Expected: all tests PASS, including the 3 new ones from Step 1.

- [ ] **Step 5: Run the full suite, typecheck, and the raw-values guard**

```bash
npm test
npm run typecheck
npx vitest run src/no-raw-values.test.ts
```

Expected: all green.

- [ ] **Step 6: Live-smoke the redesigned page**

Per CLAUDE.md, launch fresh dev servers (do not reuse any server already running) against a scratch data directory:

```bash
cd server && PAPER_MATE_DATA=/tmp/pm-redesign-smoke uv run uvicorn app.main:app --port 8110 &
cd client && PAPER_MATE_API_TARGET=http://127.0.0.1:8110 npx vite --port 5210 &
```

In a browser at `http://127.0.0.1:5210/`, confirm: no top bar/title anywhere; the left pane shows "LIBRARY" / a dark "All" pill / the version at the bottom; picking a real PDF via the top-bar Add → File upload streams it in as before; clicking Add → Folder upload and picking a folder containing a mix of PDFs and non-PDFs uploads only the PDFs; Escape and an outside click both close the Add menu. Then shut down both servers and delete the scratch data dir.

- [ ] **Step 7: Commit**

```bash
git add client/src/library/LibraryPage.tsx client/src/library/LibraryPage.test.tsx
git commit -m "Feat: Wire AddMenu into Library toolbar, add folder upload"
```
