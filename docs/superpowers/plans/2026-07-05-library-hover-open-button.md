# Library Hover Open Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Library table's click-to-open row gesture with a hover-revealed Open button in the Title cell, decoupling opening a paper from the row arm/select click; and gate Story 6.6's Title/Authors click-to-edit on the row already being armed, so a single click never ambiguously means both "select" and "edit".

**Architecture:** `CollectionTable.tsx`'s row click handler drops its open-on-second-click branch (arm/select becomes a pure toggle); `EditableCell` gains an `armed`/`onArm` pair so its click/Enter only edits when the row is already armed, otherwise arms it (mouse: bubbles to the row's own click; keyboard: an explicit `onArm` call); the Title cell's static render gains a sibling `<button>` (own `stopPropagation`'d `onClick` calling `onOpenRow`, unaffected by arm state), revealed via CSS `tr:hover`/`:focus-visible` only. A companion edit updates `epics.md` Story 6.7's AC text to match, since this change delivers that AC's gesture ahead of 6.7's own formal planning.

**Tech Stack:** React 19.2 + TypeScript 6.0, Vitest + `@testing-library/react`, plain CSS with design tokens (`client/src/theme/`).

## Global Constraints

- Reference tokens only, never inline hex/px in `CollectionTable.css` (enforced by `client/src/no-raw-values.test.ts`; raw values allowed only under `src/theme/**`).
- No em-dash character in any user-facing text (tooltips, labels, copy). Code comments are exempt. (`CLAUDE.md`)
- `onOpenRow`'s existing signature (`(docId: string) => void`) and owner (`LibraryPage`) do not change.
- Run the full client suite (`npm test`) and `npm run typecheck` clean before each commit that touches source, not just the touched test file.
- Live-smoke this change with your OWN freshly launched dev servers (never a server the user already has running), per this repo's CLAUDE.md convention: hover/focus/click are the exact interactions under test here, and jsdom cannot see real hover or focus-reveal CSS.

---

### Task 1: `CollectionTable` behavior + styling: Open button replaces click-to-open

**Files:**
- Modify: `client/src/library/CollectionTable.tsx`
- Modify: `client/src/library/CollectionTable.css`
- Test: `client/src/library/CollectionTable.test.tsx`

**Interfaces:**
- Consumes: existing `CollectionTableProps` (`rows`, `onOpenRow: (docId: string) => void`, `pendingRows`, `onEditField`), unchanged. Existing `InlineEditor`/`seedFieldValue`/`currentFieldValue`/`stripPdfExtension`/`statusLabel`/`rowStatusClass`, unchanged, reused as-is.
- Produces: no new exported symbols. `handleRowClick(docId: string)` becomes a pure arm/select toggle (no longer calls `onOpenRow`). `EditableCell` gains two new props: `armed: boolean` and `onArm: () => void`. The Title cell renders an additional `<button className="collection-table__open-button">Open</button>` sibling to its text.

- [ ] **Step 1: Rewrite the three tests whose assertions assume "second click opens", and add three new Open-button tests (still failing, code not touched yet)**

In `client/src/library/CollectionTable.test.tsx`, replace the test at lines 99-106 (`"opens a row on a second click while it is selected"`) with:

```tsx
  it("does not open on a second click; row click only arms/disarms selection", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row);
    expect(row.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(row);
    expect(row.getAttribute("aria-selected")).toBe("false");
    expect(onOpenRow).not.toHaveBeenCalled();
  });
```

Replace the test at lines 188-197 (`"keeps a real extracting row selectable and openable (only pending rows are inert)"`) with:

```tsx
  it("keeps a real extracting row selectable, and its Open button still works (only pending rows are inert)", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={[rowWith("extracting")]} onOpenRow={onOpenRow} onEditField={noop} />);
    const row = screen.getByText("A Title").closest("tr")!;
    expect(row.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(row); // arm/select
    expect(row.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenRow).toHaveBeenCalledWith("s".repeat(64));
  });
```

Replace the test at lines 206-219 (`"marks a parse-failed row with a subtle No metadata chip and the filename fallback, still interactive"`) with:

```tsx
  it("marks a parse-failed row with a subtle No metadata chip and the filename fallback; its Open button still works", () => {
    const onOpenRow = vi.fn();
    render(
      <CollectionTable rows={[rowWith("parse-failed", { title: null })]} onOpenRow={onOpenRow} onEditField={noop} />,
    );
    const chip = screen.getByText("No metadata");
    expect(chip.className).toContain("badge-pill--muted");
    // Filename fallback (extension stripped) stands in for the missing title.
    expect(screen.getByText("a-title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenRow).toHaveBeenCalledWith("s".repeat(64));
  });
```

Then add a new describe block right after the `"CollectionTable inline edit (Story 6.6)"` block (before `describe("formatAdded", ...)`):

```tsx
describe("CollectionTable Open button", () => {
  it("renders an Open button per real row, not per pending row", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        pendingRows={[{ tempId: "t1", filename: "brand-new.pdf" }]}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Open" }).length).toBe(rows.length);
  });

  it("clicking Open calls onOpenRow and does not enter edit mode or toggle selection", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    const openButtons = screen.getAllByRole("button", { name: "Open" });
    fireEvent.click(openButtons[0]);
    expect(onOpenRow).toHaveBeenCalledWith(rows[0].doc_id);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("the Open button is a focusable native button (keyboard-operable without custom keydown wiring)", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    const button = screen.getAllByRole("button", { name: "Open" })[0];
    button.focus();
    expect(document.activeElement).toBe(button);
    // A native <button> converts an Enter/Space keypress into a browser-fired
    // click automatically; that translation is a browser default this test
    // doesn't reimplement, so it simulates the resulting click directly.
    fireEvent.click(button);
    expect(onOpenRow).toHaveBeenCalledWith(rows[0].doc_id);
  });
});
```

- [ ] **Step 2: Rewrite the entire `"CollectionTable inline edit (Story 6.6)"` describe block for the arm-then-edit gate (fix request: a single click on Title/Authors was entering edit immediately, which conflicted with using that same click to just select the row)**

Replace the whole `describe("CollectionTable inline edit (Story 6.6)", () => { ... })` block (currently lines 222-327) with:

```tsx
describe("CollectionTable inline edit (Story 6.6, arm-gated)", () => {
  it("click on an UNARMED row's Title cell only arms it (does not enter edit)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const cell = screen.getByText("Attention Is All You Need");
    const row = cell.closest("tr")!;
    fireEvent.click(cell);
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("click on an armed row's Title cell enters edit seeded with the current text", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // armed: edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it("Enter commits the new title via onEditField", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Corrected Title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditField).toHaveBeenCalledWith(rows[0].doc_id, "title", "Corrected Title");
    expect(screen.queryByDisplayValue("Corrected Title")).toBeNull(); // editor closed
  });

  it("Esc cancels without committing and the static cell returns", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onEditField).not.toHaveBeenCalled();
    expect(screen.getByText("Attention Is All You Need")).toBeTruthy();
  });

  it("blur commits the edit", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Blurred Title" } });
    fireEvent.blur(input);
    expect(onEditField).toHaveBeenCalledWith(rows[0].doc_id, "title", "Blurred Title");
  });

  it("Esc-then-blur does not double-commit (unmount blur is guarded)", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input); // simulate the teardown blur after unmount-triggering Esc
    expect(onEditField).not.toHaveBeenCalled();
  });

  it("clicking a Title cell (armed or not) never calls onOpenRow; opening is Open-button only", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell); // unarmed: arms (bubbles to row)
    fireEvent.click(cell); // armed: edits
    expect(onOpenRow).not.toHaveBeenCalled();
  });

  it("Enter on a focused Title cell arms it; Enter again enters edit", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const cell = screen.getByText("Attention Is All You Need");
    const row = cell.closest("tr")!;
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.getByDisplayValue("Attention Is All You Need")).toBeTruthy();
  });

  it("edits an Authors cell the same way (arm then edit)", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Vaswani et al.");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Vaswani et al.") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Authors" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditField).toHaveBeenCalledWith(rows[0].doc_id, "authors", "New Authors");
  });

  it("an extracting row is not editable regardless of arm state (click leaves no input)", () => {
    function rowWith(status: CollectionRow["status"]): CollectionRow {
      return {
        doc_id: "e".repeat(64),
        title: "Extracting Row",
        authors: null,
        added: "2026-07-05T12:00:00+00:00",
        file_type: "pdf",
        status,
        folder_id: null,
        trashed: false,
        order: 0,
      };
    }
    render(
      <CollectionTable rows={[rowWith("extracting")]} onOpenRow={noop} onEditField={noop} />,
    );
    const cell = screen.getByText("Extracting Row");
    fireEvent.click(cell); // arms the row (bubbles; cell itself isn't editable, no intercept)
    fireEvent.click(cell); // disarms; still no interception at any point
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a no-op commit (unchanged value) does not call onEditField", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditField).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the suite and confirm exactly the expected tests fail**

Run: `cd client && npx vitest run src/library/CollectionTable.test.tsx`
Expected: FAIL. The three Open-button-decoupling rewrites fail because `handleRowClick` still opens on a second click. The rewritten arm-gate describe block fails because `EditableCell` still edits on the very first click/Enter (no `armed` gate yet). The three new Open-button tests fail with `Unable to find role="button" and name "Open"` (the button doesn't exist yet).

- [ ] **Step 4: Simplify `handleRowClick` (drop the open-on-second-click branch)**

In `client/src/library/CollectionTable.tsx`, replace:

```tsx
  function handleRowClick(docId: string) {
    if (selectedId === docId) {
      onOpenRow(docId);
      setSelectedId(null);
    } else {
      setSelectedId(docId);
    }
  }
```

with:

```tsx
  function handleRowClick(docId: string) {
    setSelectedId((prev) => (prev === docId ? null : docId));
  }
```

- [ ] **Step 5: Add `armed`/`onArm` to `EditableCell` and gate its click/Enter handlers on arm state (fix request: single click on Title/Authors was entering edit immediately, conflicting with using that click to select the row)**

In `client/src/library/CollectionTable.tsx`, replace the `EditableCell` function:

```tsx
function EditableCell({
  className,
  title,
  field,
  editable,
  isEditing,
  seedValue,
  children,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  className: string;
  title?: string;
  field: EditableField;
  editable: boolean;
  isEditing: boolean;
  seedValue: string;
  children: React.ReactNode;
  onStartEdit: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <td className={className}>
        <InlineEditor initialValue={seedValue} onCommit={onCommit} onCancel={onCancel} />
      </td>
    );
  }
  if (!editable) {
    return (
      <td className={className} title={title}>
        {children}
      </td>
    );
  }
  return (
    <td
      className={className}
      title={title}
      tabIndex={0}
      aria-label={field === "title" ? "Edit title" : "Edit authors"}
      onClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          onStartEdit();
        }
      }}
    >
      {children}
    </td>
  );
}
```

with:

```tsx
function EditableCell({
  className,
  title,
  field,
  editable,
  armed,
  isEditing,
  seedValue,
  children,
  onStartEdit,
  onArm,
  onCommit,
  onCancel,
}: {
  className: string;
  title?: string;
  field: EditableField;
  editable: boolean;
  armed: boolean;
  isEditing: boolean;
  seedValue: string;
  children: React.ReactNode;
  onStartEdit: () => void;
  onArm: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <td className={className}>
        <InlineEditor initialValue={seedValue} onCommit={onCommit} onCancel={onCancel} />
      </td>
    );
  }
  if (!editable) {
    return (
      <td className={className} title={title}>
        {children}
      </td>
    );
  }
  return (
    <td
      className={className}
      title={title}
      tabIndex={0}
      aria-label={field === "title" ? "Edit title" : "Edit authors"}
      onClick={(e) => {
        if (armed) {
          e.stopPropagation();
          onStartEdit();
        }
        // else: not intercepted; the click bubbles to the <tr>'s own
        // onClick, which arms the row exactly like any other cell.
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.stopPropagation();
        if (armed) {
          onStartEdit();
        } else {
          onArm();
        }
      }}
    >
      {children}
    </td>
  );
}
```

- [ ] **Step 6: Wire `armed`/`onArm` into both `EditableCell` call sites, and add the Open button as a sibling to the title text**

In the same file, inside the `rows.map` block, replace both `<EditableCell>` calls:

```tsx
                <EditableCell
                  className="collection-table__title"
                  title={displayTitle ?? undefined}
                  field="title"
                  editable={editable}
                  isEditing={isEditingTitle}
                  seedValue={seedFieldValue(row, "title")}
                  onStartEdit={() => setEditing({ docId: row.doc_id, field: "title" })}
                  onCommit={(value) => commitEdit(row, "title", value)}
                  onCancel={() => setEditing(null)}
                >
                  {displayTitle ?? <span className="collection-table__untitled">Untitled</span>}
                </EditableCell>
                <EditableCell
                  className="collection-table__authors"
                  title={row.authors ?? undefined}
                  field="authors"
                  editable={editable}
                  isEditing={isEditingAuthors}
                  seedValue={seedFieldValue(row, "authors")}
                  onStartEdit={() => setEditing({ docId: row.doc_id, field: "authors" })}
                  onCommit={(value) => commitEdit(row, "authors", value)}
                  onCancel={() => setEditing(null)}
                >
                  {row.authors ?? ""}
                </EditableCell>
```

with:

```tsx
                <EditableCell
                  className="collection-table__title"
                  title={displayTitle ?? undefined}
                  field="title"
                  editable={editable}
                  armed={selectedId === row.doc_id}
                  isEditing={isEditingTitle}
                  seedValue={seedFieldValue(row, "title")}
                  onStartEdit={() => setEditing({ docId: row.doc_id, field: "title" })}
                  onArm={() => setSelectedId(row.doc_id)}
                  onCommit={(value) => commitEdit(row, "title", value)}
                  onCancel={() => setEditing(null)}
                >
                  <span className="collection-table__title-text">
                    {displayTitle ?? <span className="collection-table__untitled">Untitled</span>}
                  </span>
                  <button
                    type="button"
                    className="collection-table__open-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenRow(row.doc_id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    Open
                  </button>
                </EditableCell>
                <EditableCell
                  className="collection-table__authors"
                  title={row.authors ?? undefined}
                  field="authors"
                  editable={editable}
                  armed={selectedId === row.doc_id}
                  isEditing={isEditingAuthors}
                  seedValue={seedFieldValue(row, "authors")}
                  onStartEdit={() => setEditing({ docId: row.doc_id, field: "authors" })}
                  onArm={() => setSelectedId(row.doc_id)}
                  onCommit={(value) => commitEdit(row, "authors", value)}
                  onCancel={() => setEditing(null)}
                >
                  {row.authors ?? ""}
                </EditableCell>
```

Note: `EditableCell`'s `!editable` branch (used for `extracting` rows) still renders bare `children` with no click handling at all, so the Open button appears there too (not editable, still openable), matching the spec's edge case. The Open button itself is scoped to the Title field only (the Authors `<EditableCell>` call has no button, just the arm/edit gating).

- [ ] **Step 7: Update `CollectionTable.css`: flex layout for the Title cell, the new title-text class, and the Open button + its hover/focus reveal**

Replace:

```css
.collection-table__title,
.collection-table__authors {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

with:

```css
.collection-table__title {
  display: flex;
  align-items: center;
  gap: var(--space-xxs);
}

.collection-table__title-text {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-table__authors {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Then, immediately after the existing `.collection-table__edit-input:focus { ... }` block (Story 6.6 section) and before the `/* Status-driven row treatment ... */` comment, add:

```css
/* Hover/focus-revealed Open button (replaces click-to-open on the row). A
   real <button>, so Tab reaches it and Enter/Space activates it natively;
   the reveal itself is CSS-only, no JS hover-state tracking. */
.collection-table__open-button {
  flex: 0 0 auto;
  opacity: 0;
  pointer-events: none;
  background: var(--color-surface-card);
  color: var(--color-ink);
  font-family: var(--font-sans);
  font-size: var(--type-body-sm-size);
  font-weight: var(--type-body-sm-weight);
  line-height: var(--type-body-sm-leading);
  border: var(--hairline-width) solid var(--color-hairline-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-xxs) var(--space-xs);
  transition: opacity 0.1s ease-out;
}

.collection-table tbody tr:hover .collection-table__open-button,
.collection-table__open-button:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
```

- [ ] **Step 8: Run the suite and confirm all `CollectionTable.test.tsx` tests pass**

Run: `cd client && npx vitest run src/library/CollectionTable.test.tsx`
Expected: PASS, all tests (the 3 Open-decoupling rewrites + the 11-test arm-gated inline-edit block + 3 new Open-button tests + every pre-existing case untouched by this change).

- [ ] **Step 9: Run the no-raw-values guard on the touched CSS file**

Run: `cd client && npx vitest run src/no-raw-values.test.ts -t "CollectionTable.css"`
Expected: PASS (every new value is a `var(--...)` token reference; no literal hex/px introduced).

- [ ] **Step 10: Commit**

```bash
cd client
git add src/library/CollectionTable.tsx src/library/CollectionTable.css src/library/CollectionTable.test.tsx
git commit -m "Replace click-to-open with a hover Open button; gate Title/Authors edit on arm state

Row click no longer opens on a second click; opening decouples entirely
into a Title-cell Open button, revealed on row hover or its own keyboard
focus. Title/Authors click-to-edit now requires the row already armed
(selected) first, so a single click never ambiguously means both select
and edit. Resolves the Story 6.6 edit-vs-open interim workaround plus a
follow-up fix request on the edit gesture itself."
```

---

### Task 2: `LibraryPage` integration tests: exercise the Open button, not the second click

**Files:**
- Modify: `client/src/library/LibraryPage.test.tsx`

**Interfaces:**
- Consumes: `CollectionTable`'s new Open button (Task 1) via `LibraryPage`'s existing `<CollectionTable onOpenRow={(docId) => navigate(...)} .../>` wiring, unchanged in `LibraryPage.tsx` itself (only the trigger moved inside `CollectionTable`).
- Produces: nothing new; this task only re-aligns two existing integration tests with the Task 1 behavior change.

- [ ] **Step 1: Update the two tests that relied on "click the row twice to open"**

In `client/src/library/LibraryPage.test.tsx`, replace the body of `"navigates to /reader/:docId when a selected row is clicked again"` (currently lines 251-262):

```tsx
  it("navigates to /reader/:docId when a selected row is clicked again", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row); // select
    expect(screen.queryByTestId("reader-stub")).toBeNull();
    fireEvent.click(row); // open

    await waitFor(() => expect(screen.getByTestId("reader-stub")).toBeTruthy());
  });
```

with:

```tsx
  it("navigates to /reader/:docId when the row's Open button is clicked", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());
    expect(screen.queryByTestId("reader-stub")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(screen.getByTestId("reader-stub")).toBeTruthy());
  });
```

Then replace the body of `"renders a parse-failed row with its filename and lets it open (interactive)"` (currently lines 532-546):

```tsx
  it("renders a parse-failed row with its filename and lets it open (interactive)", async () => {
    const id = "z".repeat(64);
    vi.spyOn(api, "getLibrary").mockResolvedValue({
      papers: [libRow(id, "parse-failed", null, "poor-paper.pdf")],
      folders: [],
    });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("poor-paper")).toBeTruthy());
    expect(screen.getByText("No metadata")).toBeTruthy();
    const row = screen.getByText("poor-paper").closest("tr")!;
    fireEvent.click(row); // select
    fireEvent.click(row); // open
    await waitFor(() => expect(screen.getByTestId("reader-stub")).toBeTruthy());
  });
```

with:

```tsx
  it("renders a parse-failed row with its filename and lets it open (interactive)", async () => {
    const id = "z".repeat(64);
    vi.spyOn(api, "getLibrary").mockResolvedValue({
      papers: [libRow(id, "parse-failed", null, "poor-paper.pdf")],
      folders: [],
    });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("poor-paper")).toBeTruthy());
    expect(screen.getByText("No metadata")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("reader-stub")).toBeTruthy());
  });
```

- [ ] **Step 2: Run the full client suite and typecheck**

Run: `cd client && npm test`
Expected: PASS, all test files (50+), including the two updated `LibraryPage.test.tsx` cases and every `CollectionTable.test.tsx` case from Task 1.

Run: `cd client && npm run typecheck`
Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
cd client
git add src/library/LibraryPage.test.tsx
git commit -m "Update Library integration tests to open via the new Open button"
```

---

### Task 3: `epics.md` Story 6.7 AC text update

**Files:**
- Modify: `.bmad/planning-artifacts/epics.md:1475-1494`

**Interfaces:**
- Consumes: nothing (planning doc only).
- Produces: nothing consumed by code; this keeps the planning artifact truthful for whoever plans/builds the rest of Story 6.7 (PDF/annotation hydration, `last_opened` update) later.

- [ ] **Step 1: Update the Story 6.7 user-story line and AC #1**

In `.bmad/planning-artifacts/epics.md`, replace:

```
### Story 6.7: Open a paper in the annotator with its annotations

As a reader,
I want to double-click a paper to read and annotate it, with my past marks intact,
So that the Library is a real entry point to reading, not just a list.

**Acceptance Criteria:**

**Given** a table row
**When** I double-click it (or focus it and press Enter)
**Then** the app navigates to `/reader/:docId` for that paper (LFR-18, AL-3, L-UX-DR10)
```

with:

```
### Story 6.7: Open a paper in the annotator with its annotations

As a reader,
I want to open a paper from the Library to read and annotate it, with my past marks intact,
So that the Library is a real entry point to reading, not just a list.

**Acceptance Criteria:**

**Given** a table row
**When** I hover it and click the Open button it reveals (or Tab to the button and press Enter/Space)
**Then** the app navigates to `/reader/:docId` for that paper (LFR-18, AL-3, L-UX-DR10). Delivered ahead of this story's formal planning by the 2026-07-05 "Library hover Open button" fix (`docs/superpowers/specs/2026-07-05-library-hover-open-button-design.md`); this AC now describes existing, shipped behavior in `CollectionTable.tsx`.
```

Leave the remaining three ACs (PDF/annotation hydration, autosave, `last_opened` update) untouched: they describe reader-side behavior this fix does not build.

- [ ] **Step 2: Commit**

```bash
git add .bmad/planning-artifacts/epics.md
git commit -m "Update Story 6.7 AC to match the shipped hover-Open gesture

Delivered ahead of 6.7's own formal planning by the Library hover-Open
button fix; the double-click wording no longer matches CollectionTable."
```

---

### Task 4: Live smoke (own fresh servers, trusted input)

**Files:** none (manual verification only).

**Interfaces:** none.

- [ ] **Step 1: Launch your OWN backend and frontend dev servers on alternate ports**

Never reuse a server the user already has running (CLAUDE.md convention: a running server may predate this change or lack HMR).

```bash
cd server && export UV_CACHE_DIR=/tmp/uv-cache && PAPER_MATE_DATA=/tmp/pm-smoke-hover-open PYTHONPATH= uv run uvicorn app.main:app --port 8020
```

In a second shell:

```bash
cd client && PAPER_MATE_API_TARGET=http://127.0.0.1:8020 npm run dev -- --port 5193 --strictPort
```

- [ ] **Step 2: Seed at least one paper (upload any PDF through the running app, or reuse an isolated data dir with a hand-seeded `meta.json` as Story 6.6's own smoke test did)**

- [ ] **Step 3: Verify hover reveal**

Open `http://127.0.0.1:5193/` in a browser, hover a row: confirm the Open button fades in inline in the Title cell, to the right of the (possibly further-truncated) title text.

- [ ] **Step 4: Verify click-to-open**

Click the Open button: confirm the app navigates to `/reader/:docId` for that paper.

- [ ] **Step 5: Verify the Title/Authors arm-then-edit gate**

Click the title TEXT (not the button) on an unarmed row: confirm it only highlights the row (arms it), no editor appears. Click the title text again: confirm it NOW enters inline edit (Story 6.6 mechanics: seeded text, Enter/blur commit, Esc cancels, unaffected by this change). Repeat for an Authors cell.

- [ ] **Step 6: Verify keyboard access, including the arm-gate**

Tab to a Title cell and press Enter: confirm it only arms the row (no editor). Press Enter again: confirm it now enters edit. Separately, Tab to the Open button (fades in on focus even without hovering) and press Enter: confirm it opens the reader, regardless of arm state, and does NOT instead arm/edit the row (this exact failure was caught live once: the button needs its own `onKeyDown` stopping propagation, or a bubbled Enter reaches the Title `<td>`'s handler first).

- [ ] **Step 7: Verify row arm/select still works, decoupled from opening**

Click a non-title cell (e.g. Added): confirm the row highlights (`aria-selected`); click it again: confirm it un-highlights and does NOT open.

- [ ] **Step 8: Verify an `extracting` row's Open button still works**

Upload a fresh PDF and, while its row still shows the muted "Extracting" chip, hover it and click Open: confirm it still navigates (matches the spec's "extracting row stays openable" edge case).

- [ ] **Step 9: Tear down your smoke servers**

```bash
kill %1 %2  # or: pkill -f "uvicorn app.main:app --port 8020"; pkill -f "vite.*5193"
```

## Self-Review Notes

- **Spec coverage:** Row-click-no-longer-opens (Task 1 Steps 4, 8), Open button in Title cell only revealed on hover/focus (Task 1 Steps 6-7), click isolation via `stopPropagation` (Task 1 Step 6), works on `extracting` rows (Task 1 Step 1's rewritten test + Task 4 Step 8), keyboard operability via native button semantics (Task 1 Step 1's new test + Task 4 Step 6), Title/Authors edit gated on arm state for both click and Enter (Task 1 Steps 2, 5-6 + Task 4 Steps 5-6), `epics.md` companion update (Task 3), live verification of hover/focus/arm-gate CSS and interaction jsdom cannot see (Task 4). All spec sections (including the addendum) have a corresponding task/step.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact command with expected output.
- **Type consistency:** `onOpenRow: (docId: string) => void` used identically in Task 1 (button's `onClick`) and Task 2 (unchanged `LibraryPage.tsx` wiring), no signature drift. `EditableCell`'s new `armed: boolean`/`onArm: () => void` props are defined in Task 1 Step 5 and consumed identically at both call sites in Task 1 Step 6 (`armed={selectedId === row.doc_id}`, `onArm={() => setSelectedId(row.doc_id)}`). `children: React.ReactNode` already accepts the Title cell's new multi-element children (span + button) with no type change needed.
