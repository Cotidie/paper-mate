import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, createEvent } from "@testing-library/react";
import CollectionTable from "./CollectionTable";
import { formatAdded } from "@/library/row";
import { COLUMNS } from "@/library/tableView";
import type { CollectionRow } from "@/api/client";

afterEach(cleanup);
// The drag-preview node is appended directly to document.body (outside
// React's tree, so RTL's cleanup() above doesn't remove it) and only
// scheduled for removal via setTimeout(0) - sweep up any that a test's own
// dragStart didn't wait a tick for, so it can't leak into the next test.
afterEach(() => {
  document.querySelectorAll(".collection-table__drag-preview").forEach((el) => el.remove());
});
afterEach(() => {
  vi.restoreAllMocks();
});

const rows: CollectionRow[] = [
  {
    doc_id: "a".repeat(64),
    title: "Attention Is All You Need",
    authors: "Vaswani et al.",
    authors_list: ["Vaswani et al."],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 0,
    structure_status: "ready",
  },
  {
    doc_id: "b".repeat(64),
    title: null,
    authors: null,
    authors_list: [],
    added: "2026-07-01T12:00:00+00:00",
    file_type: "note",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 1,
    structure_status: "ready",
    filename: "no-title-paper.pdf",
  },
  {
    doc_id: "c".repeat(64),
    title: null,
    authors: null,
    authors_list: [],
    added: "2026-07-01T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 2,
    structure_status: "ready",
    filename: null,
  },
];

function noop() {}

describe("CollectionTable (Story 6.3)", () => {
  it("renders the four column headers", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    for (const label of ["Title", "Authors", "Added", "File type"]) {
      expect(screen.getByRole("columnheader", { name: label })).toBeTruthy();
    }
  });

  it("never renders a count line itself (Library layout redesign: LibraryPage owns it)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    expect(screen.queryByText(/files in library/)).toBeNull();
  });

  it("renders a human date, not the raw ISO string", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    expect(screen.getByText(formatAdded(rows[0].added))).toBeTruthy();
    expect(screen.queryByText(rows[0].added)).toBeNull();
  });

  it("renders the PDF and Note badge labels", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    expect(screen.getAllByText("PDF").length).toBe(2);
    expect(screen.getByText("Note")).toBeTruthy();
  });

  it("truncates Title/Authors cells with ellipsis styling", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const titleCell = screen.getByText("Attention Is All You Need");
    expect(titleCell.className).toContain("collection-table__title");
  });

  it("falls back to the filename, minus the .pdf extension, for a null title", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    expect(screen.getByText("no-title-paper")).toBeTruthy();
    expect(screen.queryByText("no-title-paper.pdf")).toBeNull();
  });

  it("falls back to Untitled when neither title nor filename is known", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("selects a row on first click without opening it", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row);
    expect(onOpenRow).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

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

  it("moves selection to a newly clicked row instead of opening it", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    const first = screen.getByText("Attention Is All You Need").closest("tr")!;
    const second = screen.getByText("no-title-paper").closest("tr")!;
    fireEvent.click(first);
    fireEvent.click(second);
    expect(onOpenRow).not.toHaveBeenCalled();
    expect(first.getAttribute("aria-selected")).toBe("false");
    expect(second.getAttribute("aria-selected")).toBe("true");
  });

  it("shows skeleton rows and no real data while loading", () => {
    render(<CollectionTable loading />);
    expect(document.querySelectorAll(".collection-table__skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByText("Attention Is All You Need")).toBeNull();
    expect(screen.queryByText(/files in library/)).toBeNull();
  });
});

describe("CollectionTable pending rows (Story 6.4)", () => {
  it("renders pending rows above real rows with the muted extracting treatment", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop} onEditField={noop}
        pendingRows={[{ tempId: "t1", filename: "brand-new.pdf" }]}
      />,
    );
    expect(screen.getByText("brand-new")).toBeTruthy();
    expect(screen.getByText("Extracting")).toBeTruthy();
    const pendingRow = screen.getByText("brand-new").closest("tr")!;
    expect(pendingRow.className).toContain("collection-table__row--extracting");
    expect(pendingRow.getAttribute("aria-disabled")).toBe("true");

    const allRows = document.querySelectorAll("tbody tr");
    expect(allRows[0]).toBe(pendingRow);
  });

  it("never opens or selects a pending row on click", () => {
    const onOpenRow = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={onOpenRow} onEditField={noop}
        pendingRows={[{ tempId: "t1", filename: "brand-new.pdf" }]}
      />,
    );
    const pendingRow = screen.getByText("brand-new").closest("tr")!;
    fireEvent.click(pendingRow);
    fireEvent.click(pendingRow);
    expect(onOpenRow).not.toHaveBeenCalled();
    expect(pendingRow.getAttribute("aria-selected")).toBeNull();
  });

  it("a pending row's cell count matches the header's column count (regression: PendingRow lacked venue/year/doi cells, desyncing it from the colgroup once those columns shipped)", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        pendingRows={[{ tempId: "t1", filename: "brand-new.pdf" }]}
      />,
    );
    const headerCellCount = document.querySelectorAll("thead th").length;
    const pendingRow = screen.getByText("brand-new").closest("tr")!;
    expect(pendingRow.querySelectorAll("td").length).toBe(headerCellCount);
  });
});

describe("CollectionTable status visuals (Story 6.5)", () => {
  function rowWith(status: CollectionRow["status"], overrides: Partial<CollectionRow> = {}): CollectionRow {
    return {
      doc_id: "s".repeat(64),
      title: "A Title",
      authors: null,
      authors_list: [],
      added: "2026-07-05T12:00:00+00:00",
      file_type: "pdf",
      status,
      folder_id: null,
      trashed: false,
      starred: false,
      order: 0,
      filename: "a-title.pdf",
      structure_status: "ready",
      ...overrides,
    };
  }

  it("shows the muted Extracting chip for a real extracting row", () => {
    render(<CollectionTable rows={[rowWith("extracting")]} onOpenRow={noop} onEditField={noop} />);
    expect(screen.getByText("Extracting")).toBeTruthy();
    const row = screen.getByText("A Title").closest("tr")!;
    expect(row.className).toContain("collection-table__row--extracting");
  });

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

  it("renders enrich-skipped as a normal row (no status chip, shows PDF badge)", () => {
    render(<CollectionTable rows={[rowWith("enrich-skipped")]} onOpenRow={noop} onEditField={noop} />);
    expect(screen.queryByText("Extracting")).toBeNull();
    expect(screen.queryByText("-")).toBeNull();
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("marks a parse-failed row with a subtle '-' chip (fix request: 'No metadata' wrapped to two lines and grew the row) and the filename fallback; its Open button still works", () => {
    const onOpenRow = vi.fn();
    render(
      <CollectionTable rows={[rowWith("parse-failed", { title: null })]} onOpenRow={onOpenRow} onEditField={noop} />,
    );
    const chip = screen.getByText("-");
    expect(chip.className).toContain("badge-pill--muted");
    // Filename fallback (extension stripped) stands in for the missing title.
    expect(screen.getByText("a-title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenRow).toHaveBeenCalledWith("s".repeat(64));
  });

  it("always shows a structure-state dot in the title, colored by structure_status", () => {
    const { rerender } = render(
      <CollectionTable
        rows={[rowWith("ready", { structure_status: "analyzing" })]}
        onOpenRow={noop}
        onEditField={noop}
      />,
    );
    expect(screen.getByTestId("structure-status-dot").getAttribute("data-status")).toBe("analyzing");

    rerender(
      <CollectionTable
        rows={[rowWith("ready", { structure_status: "ready" })]}
        onOpenRow={noop}
        onEditField={noop}
      />,
    );
    expect(screen.getByTestId("structure-status-dot").getAttribute("data-status")).toBe("ready");

    rerender(
      <CollectionTable
        rows={[rowWith("ready", { structure_status: "absent" })]}
        onOpenRow={noop}
        onEditField={noop}
      />,
    );
    expect(screen.getByTestId("structure-status-dot").getAttribute("data-status")).toBe("absent");
  });
});

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

  it("arming then clicking the Authors cell opens the tag editor, same lifecycle as Title (Story 7.11)", () => {
    const onCommitAuthors = vi.fn();
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onCommitAuthors={onCommitAuthors} />,
    );
    // A chip is plain, non-interactive text - the cell BACKGROUND click is
    // what arms/opens the editor, so target the outer <td>.
    const cell = screen.getByText("Vaswani et al.").closest("td")!;
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // opens the tag editor
    const input = screen.getByPlaceholderText("Add author") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Author" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onCommitAuthors).toHaveBeenCalledWith(rows[0].doc_id, ["Vaswani et al.", "New Author"]);
  });

  it("the click that blurs the tag editor closed does not also toggle row selection (Codex review: blur-commit must suppress its own click)", () => {
    const onCommitAuthors = vi.fn();
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onCommitAuthors={onCommitAuthors} />,
    );
    const cell = screen.getByText("Vaswani et al.").closest("td")!;
    const row = cell.closest("tr")!;
    fireEvent.click(row); // arm
    expect(row.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(cell); // opens the tag editor
    const input = screen.getByPlaceholderText("Add author");

    const addedCell = row.querySelector(".collection-table__added")!;
    fireEvent.blur(input);
    fireEvent.click(addedCell);

    expect(screen.queryByPlaceholderText("Add author")).toBeNull(); // editor closed
    // The click that closed the editor is consumed by the suppression
    // guard, not treated as a fresh arm-toggle click - same class of bug
    // already fixed for Title/Venue/Year (`commitEdit`'s `viaBlur` guard).
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  it("an extracting row is not editable regardless of arm state (click leaves no input)", () => {
    function rowWith(status: CollectionRow["status"]): CollectionRow {
      return {
        doc_id: "e".repeat(64),
        title: "Extracting Row",
        authors: null,
        authors_list: [],
        added: "2026-07-05T12:00:00+00:00",
        file_type: "pdf",
        status,
        folder_id: null,
        trashed: false,
        starred: false,
        order: 0,
        structure_status: "ready",
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

  it("clicking Authors while Title is being edited only finishes the Title edit, does not immediately start editing Authors (fix request)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const titleCell = screen.getByText("Attention Is All You Need");
    fireEvent.click(titleCell.closest("tr")!); // arm
    fireEvent.click(titleCell); // edit title
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;

    const authorsCell = screen.getByText("Vaswani et al.");
    // The blur that auto-commits Title fires before the click that caused
    // it reaches React; the guard is set inside that commit, not on any
    // mousedown, so a bare blur+click reproduces the real sequence.
    fireEvent.blur(input);
    fireEvent.click(authorsCell);

    expect(screen.queryByDisplayValue("Attention Is All You Need")).toBeNull(); // title edit closed
    expect(screen.queryByRole("textbox")).toBeNull(); // authors did NOT open an editor
  });

  it("clicking a non-editable cell while editing only finishes the edit, does not also toggle row selection (fix request)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const titleCell = screen.getByText("Attention Is All You Need");
    const row = titleCell.closest("tr")!;
    fireEvent.click(row); // arm
    expect(row.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(titleCell); // edit title
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;

    const addedCell = row.querySelector(".collection-table__added")!;
    fireEvent.blur(input);
    fireEvent.click(addedCell);

    expect(screen.queryByDisplayValue("Attention Is All You Need")).toBeNull(); // edit closed
    // The click is consumed by the suppression guard, not treated as a
    // fresh arm-toggle click, so the row's prior armed state is unchanged.
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  it("a mousedown inside the still-focused input (e.g. repositioning the caret) does not poison a later, unrelated keyboard Open activation (Codex review: stale suppressClickRef)", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    const titleCell = screen.getByText("Attention Is All You Need");
    fireEvent.click(titleCell.closest("tr")!); // arm
    fireEvent.click(titleCell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;

    // Click INSIDE the input itself (repositioning the caret) — no blur,
    // no commit, editing stays open. This must not set the suppression
    // guard (it previously did, via a mousedown-based ref).
    fireEvent.mouseDown(input);
    fireEvent.click(input);
    expect(screen.getByDisplayValue("Attention Is All You Need")).toBeTruthy();

    // Commit via Enter (a deliberate keyboard action, not a click-away).
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("textbox")).toBeNull();

    // A later, independent keyboard activation of the Open button (e.g.
    // after Tab) must not be swallowed by a stale guard.
    const openButton = screen.getAllByRole("button", { name: "Open" })[0];
    fireEvent.click(openButton); // simulates the browser's Enter/Space -> click translation
    expect(onOpenRow).toHaveBeenCalledWith(rows[0].doc_id);
  });
});

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

  it("the Trash lens hides the Open button entirely (fix request: Restore/Purge moved to the toolbar, not a per-row replacement)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} trashLens />);
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
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

  it("a keydown on the Open button does not bubble to the cell's own Enter handler (regression: live-smoke-caught bug)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const button = screen.getAllByRole("button", { name: "Open" })[0];
    const row = button.closest("tr")!;
    fireEvent.keyDown(button, { key: "Enter" });
    // Without the button's own keydown stopPropagation, this Enter would
    // bubble to the Title <td>'s onKeyDown and incorrectly arm/edit the row
    // instead of letting the browser's native button-activation handle it.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(row.getAttribute("aria-selected")).toBe("false");
  });
});

describe("CollectionTable multi-select via Ctrl/Cmd+click (Story 7.2 fix request)", () => {
  it("does not render a per-row Move to folder control", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    expect(screen.queryByRole("button", { name: "Move to folder" })).toBeNull();
  });

  it("Ctrl+click toggles a row into selectedIds without arming it", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row, { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([rows[0].doc_id]));
    expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("Cmd (meta)+click also toggles selection", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!, { metaKey: true });
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([rows[0].doc_id]));
  });

  it("Ctrl+click on the Title cell does not enter edit mode", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    fireEvent.click(screen.getByText("Attention Is All You Need"), { ctrlKey: true });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Ctrl+click blurs a stray focus the browser's native mousedown left on the Title cell (bug fix: a lingering focus ring, and a later bare Enter would call onArm and collapse the selection)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const titleCell = screen.getByText("Attention Is All You Need").closest("td")!;
    titleCell.focus(); // simulate the browser's native focus-on-mousedown
    expect(document.activeElement).toBe(titleCell);
    fireEvent.click(titleCell, { ctrlKey: true });
    expect(document.activeElement).not.toBe(titleCell);
  });

  it("a plain click still arms the row (Ctrl/Cmd+click did not break normal selection)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row);
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  it("a checked row carries data-checked (same highlight treatment as an armed row, no check-mark)", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        selectedIds={new Set([rows[0].doc_id])}
      />,
    );
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    expect(row.hasAttribute("data-checked")).toBe(true);
  });

  it("an unchecked row carries no data-checked", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    expect(row.hasAttribute("data-checked")).toBe(false);
  });

  it("a plain click on another row REPLACES a multi-selection (fix: was leaving stale rows highlighted)", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        selectedIds={new Set([rows[0].doc_id, rows[1].doc_id])}
        onSelectionChange={onSelectionChange}
      />,
    );
    const thirdRow = screen.getByText("Untitled").closest("tr")!;
    fireEvent.click(thirdRow);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([rows[2].doc_id]));
  });

  it("a plain click on the sole already-selected row clears the selection (toggle-off)", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        selectedIds={new Set([rows[0].doc_id])}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });

  it("a single selected row is armed (size===1), enabling the same highlight a multi-selection uses", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        selectedIds={new Set([rows[0].doc_id])}
      />,
    );
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    expect(row.getAttribute("aria-selected")).toBe("true");
  });
});

describe("CollectionTable Shift+click range selection (Story 7.3)", () => {
  it("Shift+click selects the contiguous range from the anchor", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSelectionChange={onSelectionChange} />,
    );
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!); // anchor = row A
    fireEvent.click(screen.getByText("Untitled").closest("tr")!, { shiftKey: true }); // target = row C
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      new Set([rows[0].doc_id, rows[1].doc_id, rows[2].doc_id]),
    );
  });

  it("Shift+click upward (anchor below target) also yields the inclusive range", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSelectionChange={onSelectionChange} />,
    );
    fireEvent.click(screen.getByText("no-title-paper").closest("tr")!); // anchor = row B
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!, { shiftKey: true }); // target = row A
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([rows[0].doc_id, rows[1].doc_id]));
  });

  it("the anchor is stable across successive Shift+clicks (re-ranges from the same pivot)", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSelectionChange={onSelectionChange} />,
    );
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!); // anchor = A
    fireEvent.click(screen.getByText("Untitled").closest("tr")!, { shiftKey: true }); // range A..C
    fireEvent.click(screen.getByText("no-title-paper").closest("tr")!, { shiftKey: true }); // re-ranges from A, not C
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([rows[0].doc_id, rows[1].doc_id]));
  });

  it("a Shift+click with no prior anchor selects just that row and does not throw", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSelectionChange={onSelectionChange} />,
    );
    expect(() =>
      fireEvent.click(screen.getByText("no-title-paper").closest("tr")!, { shiftKey: true }),
    ).not.toThrow();
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([rows[1].doc_id]));
  });

  it("a Shift+click degrades to a plain single-select when the anchor row is filtered out of the current view", () => {
    const onSelectionChange = vi.fn();
    const { rerender } = render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSelectionChange={onSelectionChange} />,
    );
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!); // anchor = A
    rerender(
      <CollectionTable
        rows={rows.slice(1)}
        onOpenRow={noop}
        onEditField={noop}
        onSelectionChange={onSelectionChange}
      />,
    ); // row A no longer rendered - the pivot fell out of the current view
    fireEvent.click(screen.getByText("Untitled").closest("tr")!, { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([rows[2].doc_id]));
  });

  it("Shift+click never opens the reader or enters inline edit", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} onEditField={noop} />);
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!); // anchor
    fireEvent.click(screen.getByText("no-title-paper").closest("tr")!, { shiftKey: true });
    expect(onOpenRow).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Shift+click on the Title cell does not enter edit mode", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!); // anchor = A, arms A
    fireEvent.click(screen.getByText("Attention Is All You Need"), { shiftKey: true });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Shift+click blurs a stray focus the browser's native mousedown left on the Title cell (bug fix: a lingering focus ring, and a later bare Enter would call onArm and collapse the selection)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!); // anchor = A
    const titleCell = screen.getByText("no-title-paper").closest("td")!;
    titleCell.focus(); // simulate the browser's native focus-on-mousedown
    expect(document.activeElement).toBe(titleCell);
    fireEvent.click(titleCell, { shiftKey: true });
    expect(document.activeElement).not.toBe(titleCell);
  });

});

describe("CollectionTable drag-to-folder payload (Story 7.2 fix request)", () => {
  function dataTransferStub() {
    const store = new Map<string, string>();
    return {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? "",
      get effectAllowed() {
        return store.get("__effectAllowed") ?? "";
      },
      set effectAllowed(value: string) {
        store.set("__effectAllowed", value);
      },
      types: [] as string[],
      setDragImage: () => {},
    };
  }

  it("a drag starting on the Open button is rejected, not treated as a row move (code-review fix: the whole <tr> is draggable, so a native button/input descendant doesn't block it by itself)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const openButton = screen.getAllByRole("button", { name: "Open" })[0];
    const dataTransfer = dataTransferStub();
    const event = fireEvent.dragStart(openButton, { dataTransfer, cancelable: true });
    expect(event).toBe(false); // false return means preventDefault() was called
    expect(dataTransfer.getData("application/x-papermate-move")).toBe("");
  });

  it("dragging an unchecked row carries just that row's doc_id", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    expect(JSON.parse(dataTransfer.getData("application/x-papermate-move"))).toEqual([rows[0].doc_id]);
  });

  it("dragging a CHECKED row carries the whole checked set", () => {
    const selectedIds = new Set([rows[0].doc_id, rows[1].doc_id]);
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} selectedIds={selectedIds} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    const ids = JSON.parse(dataTransfer.getData("application/x-papermate-move"));
    expect(new Set(ids)).toEqual(selectedIds);
  });

  it("uses a compact custom drag image instead of the browser default full-row snapshot", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    const setDragImage = vi.fn();
    fireEvent.dragStart(row, { dataTransfer: { ...dataTransferStub(), setDragImage } });
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const [previewEl] = setDragImage.mock.calls[0];
    expect(previewEl.className).toBe("collection-table__drag-preview");
    expect(previewEl.textContent).toBe("Attention Is All You Need");
  });

  it("a Trash-lens row is not draggable (Story 7.5 scope: moving a trashed paper into a folder is out of scope, code-review fix)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} trashLens />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    expect(row.getAttribute("draggable")).toBe("false");
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    expect(dataTransfer.getData("application/x-papermate-move")).toBe("");
  });

  it("the drag preview shows a count badge when dragging multiple checked rows", () => {
    const selectedIds = new Set([rows[0].doc_id, rows[1].doc_id]);
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} selectedIds={selectedIds} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    const setDragImage = vi.fn();
    fireEvent.dragStart(row, { dataTransfer: { ...dataTransferStub(), setDragImage } });
    const [previewEl] = setDragImage.mock.calls[0];
    const badge = previewEl.querySelector(".collection-table__drag-preview-badge");
    expect(badge?.textContent).toBe("2");
  });

  it("removes the drag preview node from the DOM (does not leak elements)", async () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.dragStart(row, { dataTransfer: dataTransferStub() });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".collection-table__drag-preview")).toBeNull();
  });
});

describe("formatAdded", () => {
  it("returns the raw string for an unparseable date", () => {
    expect(formatAdded("not-a-date")).toBe("not-a-date");
  });
});

describe("CollectionTable column visibility (Story 7.4, AC-1)", () => {
  const visibleColumns = COLUMNS.filter((c) => c.key !== "authors");

  it("omits a hidden column's header", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} visibleColumns={visibleColumns} />);
    expect(screen.queryByRole("columnheader", { name: "Authors" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Title" })).toBeTruthy();
  });

  it("omits a hidden column's cell in every row", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} visibleColumns={visibleColumns} />);
    expect(screen.queryByText("Vaswani et al.")).toBeNull();
    // Title still renders - it is never hideable.
    expect(screen.getByText("Attention Is All You Need")).toBeTruthy();
  });

  it("honors the same visible-column set in the loading skeleton", () => {
    render(<CollectionTable loading visibleColumns={visibleColumns} />);
    expect(screen.queryByRole("columnheader", { name: "Authors" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Title" })).toBeTruthy();
  });

  it("defaults to every column when visibleColumns is omitted", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    for (const label of ["Title", "Authors", "Added", "File type"]) {
      expect(screen.getByRole("columnheader", { name: label })).toBeTruthy();
    }
  });
});

describe("CollectionTable sort indicator (Story 7.4, AC-2)", () => {
  it("shows no caret on any header when sort is null", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} sort={null} />);
    expect(document.querySelector(".collection-table__sort-caret")).toBeNull();
  });

  it("shows an ascending caret on the active sort column's header", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        sort={{ column: "added", direction: "asc" }}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /Added/ });
    expect(header.querySelector(".collection-table__sort-caret")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Title" }).querySelector(".collection-table__sort-caret")).toBeNull();
  });

  it("shows a different caret when the direction is descending", () => {
    const { container: ascContainer } = render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} sort={{ column: "added", direction: "asc" }} />,
    );
    const ascIcon = ascContainer.querySelector(".collection-table__sort-caret")!.outerHTML;
    cleanup();
    const { container: descContainer } = render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} sort={{ column: "added", direction: "desc" }} />,
    );
    const descIcon = descContainer.querySelector(".collection-table__sort-caret")!.outerHTML;
    expect(ascIcon).not.toBe(descIcon);
  });
});

describe("CollectionTable column header dropdown (fix request: clickable headers)", () => {
  it("is not clickable (plain <th>, no popover) when onSortChange/onToggleColumn are omitted", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    expect(screen.queryByRole("button", { name: "Title" })).toBeNull();
  });

  it("opens a menu listing Sort ASC, Sort DESC, and Hide", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Authors" }));
    expect(screen.getByRole("menuitem", { name: "Sort ASC" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sort DESC" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Hide" })).toBeTruthy();
  });

  it("omits Hide for the Title column (never hideable)", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    expect(screen.queryByRole("menuitem", { name: "Hide" })).toBeNull();
  });

  it("Sort ASC calls onSortChange with the column and asc direction, then closes", () => {
    const onSortChange = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={onSortChange}
        onToggleColumn={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Added" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ASC" }));
    expect(onSortChange).toHaveBeenCalledWith({ column: "added", direction: "asc" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Sort DESC calls onSortChange with the column and desc direction", () => {
    const onSortChange = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={onSortChange}
        onToggleColumn={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Added" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort DESC" }));
    expect(onSortChange).toHaveBeenCalledWith({ column: "added", direction: "desc" });
  });

  it("Hide calls onToggleColumn with the column key", () => {
    const onToggleColumn = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={onToggleColumn}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Authors" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(onToggleColumn).toHaveBeenCalledWith("authors");
  });

  it("Escape closes the menu and returns focus to the header trigger", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    const button = screen.getByRole("button", { name: "Authors" });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("opening a different header's menu closes the previous one (document-level outside-pointerdown dismiss)", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    const titleButton = screen.getByRole("button", { name: "Title" });
    const authorsButton = screen.getByRole("button", { name: "Authors" });
    fireEvent.click(titleButton);
    expect(screen.getByRole("menu")).toBeTruthy();
    // A real click is preceded by a pointerdown; usePopover's outside-dismiss
    // listens for that, so simulate both (RTL's fireEvent.click alone does
    // not synthesize a pointerdown).
    fireEvent.pointerDown(authorsButton);
    fireEvent.click(authorsButton);
    expect(screen.getAllByRole("menu").length).toBe(1);
  });
});

describe("CollectionTable column resize (fix request: adjustable column widths)", () => {
  it("renders no resize handle when the resize callbacks are omitted", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    expect(document.querySelector(".collection-table__col-resize-handle")).toBeNull();
  });

  it("renders a resize handle per column when both resize callbacks are supplied", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onResizeColumnStart={noop}
        onResizeColumnKeyDown={noop}
      />,
    );
    expect(document.querySelectorAll(".collection-table__col-resize-handle").length).toBe(9);
  });

  it("pointerdown on a column's handle calls onResizeColumnStart with that column's key", () => {
    const onResizeColumnStart = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onResizeColumnStart={onResizeColumnStart}
        onResizeColumnKeyDown={noop}
      />,
    );
    const authorsHandle = screen
      .getByRole("button", { name: "Authors" })
      .closest("th")!
      .querySelector(".collection-table__col-resize-handle")!;
    fireEvent.pointerDown(authorsHandle);
    expect(onResizeColumnStart).toHaveBeenCalledWith("authors", expect.anything());
  });

  it("ArrowRight on a column's handle calls onResizeColumnKeyDown with that column's key", () => {
    const onResizeColumnKeyDown = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onResizeColumnStart={noop}
        onResizeColumnKeyDown={onResizeColumnKeyDown}
      />,
    );
    const addedHandle = screen
      .getByRole("button", { name: "Added" })
      .closest("th")!
      .querySelector(".collection-table__col-resize-handle")!;
    fireEvent.keyDown(addedHandle, { key: "ArrowRight" });
    expect(onResizeColumnKeyDown).toHaveBeenCalledWith("added", expect.anything());
  });

  it("applies columnWidths as inline widths on the <col> elements", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        columnWidths={{
          title: 400,
          authors: 150,
          added: 100,
          file_type: 80,
          location: 120,
          venue_short: 90,
          venue: 60,
          year: 40,
          doi: 60,
        }}
      />,
    );
    // Column order (Story 8.5): title, authors, venue_short, venue, year, doi, location, added, file_type.
    const cols = document.querySelectorAll("colgroup col");
    expect((cols[0] as HTMLElement).style.width).toBe("400px"); // title
    expect((cols[1] as HTMLElement).style.width).toBe("150px"); // authors
    expect((cols[2] as HTMLElement).style.width).toBe("90px"); // venue_short
    expect((cols[3] as HTMLElement).style.width).toBe("60px"); // venue
    expect((cols[4] as HTMLElement).style.width).toBe("40px"); // year
    expect((cols[5] as HTMLElement).style.width).toBe("60px"); // doi
    expect((cols[6] as HTMLElement).style.width).toBe("120px"); // location
  });

  it("sizes the <table> itself to the exact sum of columnWidths (fix request: table-layout:fixed + width:100% rescaled every <col> proportionally when they didn't sum to 100%, so narrowing one column visibly widened another even though its own width state never changed)", () => {
    const { container } = render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        columnWidths={{
          title: 400,
          authors: 150,
          added: 100,
          file_type: 80,
          location: 120,
          venue_short: 90,
          venue: 60,
          year: 40,
          doi: 60,
        }}
      />,
    );
    const table = container.querySelector("table.collection-table") as HTMLElement;
    expect(table.style.width).toBe("1100px");
  });

  it("falls back to the CSS width:100% default when columnWidths is omitted", () => {
    const { container } = render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const table = container.querySelector("table.collection-table") as HTMLElement;
    expect(table.style.width).toBe("");
  });

  it("clicking a resize handle does not also open the header's Sort/Hide dropdown", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onResizeColumnStart={noop}
        onResizeColumnKeyDown={noop}
      />,
    );
    const authorsHandle = screen
      .getByRole("button", { name: "Authors" })
      .closest("th")!
      .querySelector(".collection-table__col-resize-handle")!;
    fireEvent.pointerDown(authorsHandle);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("CollectionTable column reorder (Story 7.10, AC-1/AC-2/AC-4/AC-6)", () => {
  function dataTransferStub() {
    const store = new Map<string, string>();
    const types: string[] = [];
    return {
      setData: (type: string, value: string) => {
        store.set(type, value);
        if (!types.includes(type)) types.push(type);
      },
      getData: (type: string) => store.get(type) ?? "",
      get effectAllowed() {
        return store.get("__effectAllowed") ?? "";
      },
      set effectAllowed(value: string) {
        store.set("__effectAllowed", value);
      },
      get dropEffect() {
        return store.get("__dropEffect") ?? "";
      },
      set dropEffect(value: string) {
        store.set("__dropEffect", value);
      },
      types,
      setDragImage: () => {},
    };
  }

  // jsdom never computes real layout, so `getBoundingClientRect()` returns
  // all-zero rects - the live preview's frozen-geometry hit-testing (fix
  // request) needs each header's rect to actually differ. Stubs a fixed
  // 100px-wide slot per column, in `COLUMNS` order, keyed off the
  // `data-column-key` attribute the real component sets.
  const COLUMN_ORDER_KEYS = [
    "title",
    "authors",
    "venue_short",
    "venue",
    "year",
    "doi",
    "location",
    "added",
    "file_type",
  ];
  const SLOT_WIDTH = 100;

  function mockColumnRects() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const key = this instanceof HTMLElement ? this.dataset.columnKey : undefined;
      const idx = key ? COLUMN_ORDER_KEYS.indexOf(key) : -1;
      const left = idx >= 0 ? idx * SLOT_WIDTH : 0;
      return {
        left,
        right: left + SLOT_WIDTH,
        top: 0,
        bottom: 0,
        width: SLOT_WIDTH,
        height: 0,
        x: left,
        y: 0,
        toJSON() {
          return this;
        },
      } as DOMRect;
    });
  }

  /** The clientX at the MIDPOINT of `key`'s mocked slot. */
  function clientXFor(key: string): number {
    return COLUMN_ORDER_KEYS.indexOf(key) * SLOT_WIDTH + SLOT_WIDTH / 2;
  }

  function fireColumnDragOver(
    target: HTMLElement,
    dataTransfer: ReturnType<typeof dataTransferStub>,
    clientX: number,
  ) {
    const event = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(event, "clientX", { value: clientX });
    fireEvent(target, event);
  }

  it("the cell order matches the header order under a non-default column order (the cell-order trap, AC-6)", () => {
    const reordered = [
      COLUMNS.find((c) => c.key === "title")!,
      COLUMNS.find((c) => c.key === "venue")!,
      COLUMNS.find((c) => c.key === "authors")!,
      COLUMNS.find((c) => c.key === "year")!,
    ];
    render(
      <CollectionTable rows={[rows[0]]} onOpenRow={noop} onEditField={noop} visibleColumns={reordered} />,
    );
    const headerTexts = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headerTexts).toEqual(["Title", "Venue (Full)", "Authors", "Year"]);
    const cellClasses = Array.from(document.querySelectorAll("tbody tr td")).map((td) => td.className);
    expect(cellClasses).toEqual([
      "collection-table__title",
      "collection-table__venue",
      "collection-table__authors",
      "collection-table__year",
    ]);
  });

  it("a pending row's cells also follow a non-default column order", () => {
    const reordered = [
      COLUMNS.find((c) => c.key === "title")!,
      COLUMNS.find((c) => c.key === "venue")!,
      COLUMNS.find((c) => c.key === "authors")!,
    ];
    render(
      <CollectionTable
        rows={[]}
        onOpenRow={noop}
        onEditField={noop}
        visibleColumns={reordered}
        pendingRows={[{ tempId: "t1", filename: "brand-new.pdf" }]}
      />,
    );
    const headerTexts = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    const pendingRow = screen.getByText("brand-new").closest("tr")!;
    const cellClasses = Array.from(pendingRow.querySelectorAll("td")).map((td) => td.className);
    expect(headerTexts).toEqual(["Title", "Venue (Full)", "Authors"]);
    expect(cellClasses).toEqual([
      "collection-table__title",
      "collection-table__venue",
      "collection-table__authors",
    ]);
  });

  it("Title's header is never draggable, even when onReorderColumn is supplied", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const titleHeader = screen.getByRole("button", { name: "Title" }).closest("th")!;
    expect(titleHeader.getAttribute("draggable")).toBe("false");
  });

  it("a non-Title header is draggable when onReorderColumn is supplied", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    expect(authorsHeader.getAttribute("draggable")).toBe("true");
  });

  it("a header is not draggable when onReorderColumn is omitted (isolated tests unaffected)", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    expect(authorsHeader.getAttribute("draggable")).toBe("false");
  });

  it("dragging one header onto another calls onReorderColumn with (fromKey, toKey)", () => {
    mockColumnRects();
    const onReorderColumn = vi.fn();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={onReorderColumn}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const venueHeader = screen.getByRole("button", { name: "Venue (Full)" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(authorsHeader, { dataTransfer });
    fireColumnDragOver(venueHeader, dataTransfer, clientXFor("venue"));
    fireEvent.drop(venueHeader, { dataTransfer });
    expect(onReorderColumn).toHaveBeenCalledWith("authors", "venue");
  });

  it("uses a compact custom drag image for the header drag (reuses the row drag-preview shape)", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const setDragImage = vi.fn();
    fireEvent.dragStart(authorsHeader, { dataTransfer: { ...dataTransferStub(), setDragImage } });
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const [previewEl] = setDragImage.mock.calls[0];
    expect(previewEl.className).toBe("collection-table__drag-preview");
    expect(previewEl.textContent).toBe("Authors");
  });

  it("shows the drop-target indicator on the AFTER (right) edge for a forward drag, matching where the column actually lands (fix request: it used to always render 'before', which pointed at the wrong side once reorderColumns switched to array-move semantics)", () => {
    mockColumnRects();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const venueHeader = screen.getByRole("button", { name: "Venue (Full)" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    // Forward: Authors (idx1) dragged onto Venue (idx2) lands AFTER Venue.
    fireEvent.dragStart(authorsHeader, { dataTransfer });
    fireColumnDragOver(venueHeader, dataTransfer, clientXFor("venue"));
    expect(venueHeader.getAttribute("data-drop-target")).toBe("after");
    fireEvent.drop(venueHeader, { dataTransfer });
    expect(venueHeader.getAttribute("data-drop-target")).toBeNull();
  });

  it("shows the drop-target indicator on the BEFORE (left) edge for a backward drag", () => {
    mockColumnRects();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const venueHeader = screen.getByRole("button", { name: "Venue (Full)" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    // Backward: Venue (idx2) dragged onto Authors (idx1) lands BEFORE Authors.
    fireEvent.dragStart(venueHeader, { dataTransfer });
    fireColumnDragOver(authorsHeader, dataTransfer, clientXFor("authors"));
    expect(authorsHeader.getAttribute("data-drop-target")).toBe("before");
  });

  it("live-previews the reordered headers WHILE dragging, before any drop (fix request)", () => {
    mockColumnRects();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const venueHeader = screen.getByRole("button", { name: "Venue (Full)" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(authorsHeader, { dataTransfer });
    fireColumnDragOver(venueHeader, dataTransfer, clientXFor("venue"));

    const headerTexts = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headerTexts).toEqual([
      "Title",
      "Venue (Short)",
      "Venue (Full)",
      "Authors",
      "Year",
      "DOI",
      "Location",
      "Added",
      "File type",
    ]);
  });

  it("live-previews row cells in the same swapped order as the headers, not just on drop (fix request)", () => {
    mockColumnRects();
    render(
      <CollectionTable
        rows={[rows[0]]}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const venueHeader = screen.getByRole("button", { name: "Venue (Full)" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(authorsHeader, { dataTransfer });
    fireColumnDragOver(venueHeader, dataTransfer, clientXFor("venue"));

    const firstRowCells = document.querySelectorAll("tbody tr")[0].querySelectorAll("td");
    expect(firstRowCells[1].className).toBe("collection-table__venue-short");
    expect(firstRowCells[2].className).toBe("collection-table__venue");
    expect(firstRowCells[3].className).toBe("collection-table__authors");
  });

  it("reverts the live preview to the committed order on dragend without a drop (drag cancelled, fix request)", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const venueHeader = screen.getByRole("button", { name: "Venue (Full)" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(authorsHeader, { dataTransfer });
    fireEvent.dragOver(venueHeader, { dataTransfer });
    fireEvent.dragEnd(authorsHeader, { dataTransfer });

    const headerTexts = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headerTexts).toEqual([
      "Title",
      "Authors",
      "Venue (Short)",
      "Venue (Full)",
      "Year",
      "DOI",
      "Location",
      "Added",
      "File type",
    ]);
  });

  it("the live preview never touches Title's position (never a drag source or target)", () => {
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const titleHeader = screen.getByRole("button", { name: "Title" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(authorsHeader, { dataTransfer });
    fireEvent.dragOver(titleHeader, { dataTransfer });

    const headerTexts = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headerTexts[0]).toBe("Title");
  });

  it("hit-testing is driven by frozen geometry + pointer clientX, not by which live DOM element the event fires on (fix request: a stationary-cursor 'ignore self' guard alone did not stop a REAL, continuously moving mouse from oscillating severely)", () => {
    mockColumnRects();
    render(
      <CollectionTable
        rows={rows}
        onOpenRow={noop}
        onEditField={noop}
        onSortChange={noop}
        onToggleColumn={noop}
        onReorderColumn={noop}
      />,
    );
    const authorsHeader = screen.getByRole("button", { name: "Authors" }).closest("th")!;
    const venueHeader = screen.getByRole("button", { name: "Venue (Full)" }).closest("th")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(authorsHeader, { dataTransfer });

    function headerOrder() {
      return Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    }
    const swapped = [
      "Title",
      "Venue (Short)",
      "Venue (Full)",
      "Authors",
      "Year",
      "DOI",
      "Location",
      "Added",
      "File type",
    ];

    // Fire the SAME clientX (Venue's slot) on ALTERNATING elements - in a
    // real browser, once a swap happens, native hit-testing routes the next
    // dragover to whichever header the layout NOW puts under that screen
    // position (not necessarily the same element as before). The resolved
    // target must depend on clientX alone and stay put, not thrash.
    fireColumnDragOver(venueHeader, dataTransfer, clientXFor("venue"));
    expect(headerOrder()).toEqual(swapped);
    fireColumnDragOver(authorsHeader, dataTransfer, clientXFor("venue"));
    expect(headerOrder()).toEqual(swapped);
    fireColumnDragOver(venueHeader, dataTransfer, clientXFor("venue"));
    expect(headerOrder()).toEqual(swapped);

    // The pointer genuinely moves further right, past Year - the target
    // updates accordingly, with no back-and-forth along the way.
    fireColumnDragOver(authorsHeader, dataTransfer, clientXFor("year"));
    expect(headerOrder()).toEqual([
      "Title",
      "Venue (Short)",
      "Venue (Full)",
      "Year",
      "Authors",
      "DOI",
      "Location",
      "Added",
      "File type",
    ]);
  });

});

describe("CollectionTable Location column (post-review scope, Story 7.7 AC-8)", () => {
  const foldered: CollectionRow = {
    doc_id: "f".repeat(64),
    title: "Foldered Paper",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: "folder-a",
    trashed: false,
    starred: false,
    order: 0,
    structure_status: "ready",
  };
  const uncategorized: CollectionRow = {
    doc_id: "u".repeat(64),
    title: "Uncategorized Paper",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 1,
    structure_status: "ready",
  };
  const folders = [{ id: "folder-a", name: "Folder A", parent_id: null }];

  it("shows the owning folder's name for a foldered paper, resolved from folders", () => {
    render(
      <CollectionTable rows={[foldered]} onOpenRow={noop} onEditField={noop} folders={folders} />,
    );
    expect(screen.getByText("Folder A")).toBeTruthy();
  });

  it("shows an empty location cell when folder_id is null (fix request: no 'Uncategorized' text)", () => {
    render(
      <CollectionTable rows={[uncategorized]} onOpenRow={noop} onEditField={noop} folders={folders} />,
    );
    expect(screen.queryByText("Uncategorized")).toBeNull();
    const cell = document.querySelector(".collection-table__location")!;
    expect(cell.querySelector(".collection-table__location-text")!.textContent).toBe("");
  });

  it("falls back to an empty location cell when folders is omitted entirely (isolated tests)", () => {
    render(<CollectionTable rows={[uncategorized]} onOpenRow={noop} onEditField={noop} />);
    const cell = document.querySelector(".collection-table__location")!;
    expect(cell.querySelector(".collection-table__location-text")!.textContent).toBe("");
  });

  it("renders a folder icon only for a paper assigned to a real folder, not an uncategorized one", () => {
    render(
      <CollectionTable rows={[foldered, uncategorized]} onOpenRow={noop} onEditField={noop} folders={folders} />,
    );
    const [folderedCell, uncategorizedCell] = document.querySelectorAll(".collection-table__location");
    expect(folderedCell.querySelector(".collection-table__location-icon")).toBeTruthy();
    expect(uncategorizedCell.querySelector(".collection-table__location-icon")).toBeNull();
  });
});

describe("CollectionTable star marker (Story 7.8, AC-2)", () => {
  const starred: CollectionRow = {
    doc_id: "s".repeat(64),
    title: "Starred Paper",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: true,
    order: 0,
    structure_status: "ready",
  };
  const unstarred: CollectionRow = {
    doc_id: "u".repeat(64),
    title: "Unstarred Paper",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 1,
    structure_status: "ready",
  };

  it("renders the star marker for a starred row", () => {
    render(<CollectionTable rows={[starred]} onOpenRow={noop} onEditField={noop} />);
    const titleCell = screen.getByText("Starred Paper").closest("td")!;
    expect(titleCell.querySelector('[aria-label="Starred"]')).toBeTruthy();
  });

  it("renders no marker for an unstarred row", () => {
    render(<CollectionTable rows={[unstarred]} onOpenRow={noop} onEditField={noop} />);
    const titleCell = screen.getByText("Unstarred Paper").closest("td")!;
    expect(titleCell.querySelector('[aria-label="Starred"]')).toBeNull();
  });
});

describe("CollectionTable Venue/Year/DOI columns (Story 7.9)", () => {
  const withMeta: CollectionRow = {
    doc_id: "m".repeat(64),
    title: "Paper With Meta",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 0,
    doi: "10.1234/abcd",
    venue: "Journal of Foo",
    venue_short: "JoF",
    year: 2017,
    structure_status: "ready",
  };
  const withoutMeta: CollectionRow = {
    doc_id: "n".repeat(64),
    title: "Paper Without Meta",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 1,
    doi: null,
    venue: null,
    year: null,
    structure_status: "ready",
  };

  it("renders venue, year, and a DOI link for a row with metadata", () => {
    render(<CollectionTable rows={[withMeta]} onOpenRow={noop} onEditField={noop} />);
    expect(screen.getByText("Journal of Foo")).toBeTruthy();
    expect(screen.getByText("2017")).toBeTruthy();
    const link = screen.getByRole("link", { name: "10.1234/abcd" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://doi.org/10.1234/abcd");
  });

  it("renders blank venue/year/doi cells for a row with no metadata", () => {
    render(<CollectionTable rows={[withoutMeta]} onOpenRow={noop} onEditField={noop} />);
    expect(screen.queryByRole("link", { name: /10\./ })).toBeNull();
  });

  it("clicking the DOI link does not arm/select the row (stopPropagation)", () => {
    render(<CollectionTable rows={[withMeta]} onOpenRow={noop} onEditField={noop} />);
    const link = screen.getByRole("link", { name: "10.1234/abcd" });
    const row = link.closest("tr")!;
    fireEvent.click(link);
    expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("a keydown on the DOI link does not bubble to the row's own handling", () => {
    render(<CollectionTable rows={[withMeta]} onOpenRow={noop} onEditField={noop} />);
    const link = screen.getByRole("link", { name: "10.1234/abcd" });
    const row = link.closest("tr")!;
    fireEvent.keyDown(link, { key: "Enter" });
    expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("Ctrl+click on the DOI link does not toggle row multi-select (regression: capture-phase row handler ran before the link's own stopPropagation)", () => {
    const onSelectionChange = vi.fn();
    render(
      <CollectionTable
        rows={[withMeta]}
        onOpenRow={noop}
        onEditField={noop}
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    const link = screen.getByRole("link", { name: "10.1234/abcd" });
    fireEvent.click(link, { ctrlKey: true });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("dragging from the DOI link does not start a row-move drag (regression: row drag guard only excluded input/textarea/button)", () => {
    render(<CollectionTable rows={[withMeta]} onOpenRow={noop} onEditField={noop} />);
    const link = screen.getByRole("link", { name: "10.1234/abcd" });
    // React's onDragStart is bound on the <tr>; the native event bubbles up
    // from the link, so e.target inside the handler is the link. fireEvent's
    // return value is false when the (cancelable) event's preventDefault was
    // called, which the row's drag guard does for an excluded target.
    const notPrevented = fireEvent.dragStart(link);
    expect(notPrevented).toBe(false);
  });

  it("hiding the Venue/Year/DOI columns omits their headers and cells", () => {
    const visibleColumns = COLUMNS.filter((c) => !["venue", "year", "doi"].includes(c.key));
    render(
      <CollectionTable rows={[withMeta]} onOpenRow={noop} onEditField={noop} visibleColumns={visibleColumns} />,
    );
    expect(screen.queryByRole("columnheader", { name: "Venue (Full)" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Year" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "DOI" })).toBeNull();
    expect(screen.queryByText("Journal of Foo")).toBeNull();
    expect(screen.queryByRole("link", { name: "10.1234/abcd" })).toBeNull();
  });
});

describe("CollectionTable Venue (Short)/Venue (Full) columns (Story 8.5)", () => {
  const withShortVenue: CollectionRow = {
    doc_id: "s".repeat(64),
    title: "Paper With Short Venue",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 0,
    venue: "Proceedings of the 2025 CHI Conference",
    venue_short: "CHI",
    structure_status: "ready",
  };
  const withoutShortVenue: CollectionRow = {
    doc_id: "t".repeat(64),
    title: "Paper Without Short Venue",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 1,
    venue: "Journal of Bar",
    venue_short: null,
    structure_status: "ready",
  };

  it("renders the short venue and exposes the full venue via title on hover/focus", () => {
    render(<CollectionTable rows={[withShortVenue]} onOpenRow={noop} onEditField={noop} />);
    const shortCell = screen.getByText("CHI").closest("td")!;
    expect(shortCell.className).toBe("collection-table__venue-short");
    expect(shortCell.getAttribute("title")).toBe("Proceedings of the 2025 CHI Conference");
  });

  it("is keyboard-focusable when there is a full venue to reveal (code-review fix: a plain <td> is not in the tab order)", () => {
    render(<CollectionTable rows={[withShortVenue]} onOpenRow={noop} onEditField={noop} />);
    const shortCell = screen.getByText("CHI").closest("td")!;
    expect(shortCell.getAttribute("tabindex")).toBe("0");
  });

  it("renders blank (no fallback to the full venue) when venue_short is absent (user decision 2026-07-12)", () => {
    render(<CollectionTable rows={[withoutShortVenue]} onOpenRow={noop} onEditField={noop} />);
    const shortCell = document.querySelector(".collection-table__venue-short")!;
    expect(shortCell.textContent).toBe("");
    // The full venue still renders once, in the Full column only.
    expect(screen.getAllByText("Journal of Bar")).toHaveLength(1);
    expect(screen.getByText("Journal of Bar").closest("td")!.className).toBe("collection-table__venue");
  });

  it("is not focusable when the row has no venue at all (nothing to reveal)", () => {
    const noVenueRow: CollectionRow = { ...withoutShortVenue, venue: null };
    render(<CollectionTable rows={[noVenueRow]} onOpenRow={noop} onEditField={noop} />);
    const shortCell = document.querySelector(".collection-table__venue-short")!;
    expect(shortCell.hasAttribute("tabindex")).toBe(false);
  });

  it("the Full column still renders the full venue and stays inline-editable", () => {
    render(<CollectionTable rows={[withShortVenue]} onOpenRow={noop} onEditField={noop} />);
    const fullCell = screen.getByText("Proceedings of the 2025 CHI Conference").closest("td")!;
    expect(fullCell.className).toBe("collection-table__venue");
  });
});

describe("CollectionTable inline edit Venue/Year (Story 7.9 fix request)", () => {
  const row: CollectionRow = {
    doc_id: "v".repeat(64),
    title: "Editable Meta Paper",
    authors: null,
    authors_list: [],
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 0,
    doi: "10.1234/abcd",
    venue: "Journal of Foo",
    venue_short: "JoF",
    year: 2017,
    structure_status: "ready",
  };

  it("click on an armed row's Venue cell enters edit seeded with the current text", () => {
    render(<CollectionTable rows={[row]} onOpenRow={noop} onEditField={noop} />);
    const cell = screen.getByText("Journal of Foo");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    expect(screen.getByDisplayValue("Journal of Foo")).toBeTruthy();
  });

  it("Enter commits the new venue via onEditField", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={[row]} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Journal of Foo");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Journal of Foo") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Venue" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditField).toHaveBeenCalledWith(row.doc_id, "venue", "New Venue");
  });

  it("a blank Venue commit clears it to null", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={[row]} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("Journal of Foo");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Journal of Foo") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditField).toHaveBeenCalledWith(row.doc_id, "venue", null);
  });

  it("click on an armed row's Year cell enters edit seeded with the current value", () => {
    render(<CollectionTable rows={[row]} onOpenRow={noop} onEditField={noop} />);
    const cell = screen.getByText("2017");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    expect(screen.getByDisplayValue("2017")).toBeTruthy();
  });

  it("Enter commits the new year via onEditField as a string (the hook parses it)", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={[row]} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("2017");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("2017") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2019" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditField).toHaveBeenCalledWith(row.doc_id, "year", "2019");
  });

  it("a blank Year commit clears it to null", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={[row]} onOpenRow={noop} onEditField={onEditField} />);
    const cell = screen.getByText("2017");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("2017") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditField).toHaveBeenCalledWith(row.doc_id, "year", null);
  });

  it("a no-op Venue/Year commit (unchanged value) does not call onEditField", () => {
    const onEditField = vi.fn();
    render(<CollectionTable rows={[row]} onOpenRow={noop} onEditField={onEditField} />);
    const venueCell = screen.getByText("Journal of Foo");
    fireEvent.click(venueCell.closest("tr")!); // arm
    fireEvent.click(venueCell); // edit
    fireEvent.keyDown(screen.getByDisplayValue("Journal of Foo"), { key: "Enter" });
    expect(onEditField).not.toHaveBeenCalled();
  });

  it("an extracting row's Venue/Year cells are not editable", () => {
    const extracting: CollectionRow = { ...row, status: "extracting" };
    render(<CollectionTable rows={[extracting]} onOpenRow={noop} onEditField={noop} />);
    const venueCell = screen.getByText("Journal of Foo");
    fireEvent.click(venueCell); // arms the row; not editable, no interception
    fireEvent.click(venueCell);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
