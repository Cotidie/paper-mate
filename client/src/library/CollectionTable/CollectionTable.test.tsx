import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

const rows: CollectionRow[] = [
  {
    doc_id: "a".repeat(64),
    title: "Attention Is All You Need",
    authors: "Vaswani et al.",
    added: "2026-07-05T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    order: 0,
  },
  {
    doc_id: "b".repeat(64),
    title: null,
    authors: null,
    added: "2026-07-01T12:00:00+00:00",
    file_type: "note",
    status: "ready",
    folder_id: null,
    trashed: false,
    order: 1,
    filename: "no-title-paper.pdf",
  },
  {
    doc_id: "c".repeat(64),
    title: null,
    authors: null,
    added: "2026-07-01T12:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    order: 2,
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
});

describe("CollectionTable status visuals (Story 6.5)", () => {
  function rowWith(status: CollectionRow["status"], overrides: Partial<CollectionRow> = {}): CollectionRow {
    return {
      doc_id: "s".repeat(64),
      title: "A Title",
      authors: null,
      added: "2026-07-05T12:00:00+00:00",
      file_type: "pdf",
      status,
      folder_id: null,
      trashed: false,
      order: 0,
      filename: "a-title.pdf",
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
    expect(screen.queryByText("No metadata")).toBeNull();
    expect(screen.getByText("PDF")).toBeTruthy();
  });

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

  it("a BARE Shift/Ctrl/Cmd keydown (no click at all) blurs a stale native focus already sitting on the Title/Authors cell (fix request: Chromium's :focus-visible heuristic re-evaluates on any keydown while an element already holds focus, not only at focus-time, so a plain click that armed a row - leaving this cell natively focused, ring hidden since that focus came from a mouse click - could flip the ring visible again on a LATER, separate modifier keydown with no new click)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!); // arm, native focus lands here
    const titleCell = screen.getByText("Attention Is All You Need").closest("td")!;
    titleCell.focus(); // simulate the browser's native focus-on-mousedown left by the plain click above
    expect(document.activeElement).toBe(titleCell);
    fireEvent.keyDown(document, { key: "Shift" });
    expect(document.activeElement).not.toBe(titleCell);
  });

  it("the bare-modifier-keydown blur guard does not fire for an unrelated key", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    fireEvent.click(screen.getByText("Attention Is All You Need").closest("tr")!);
    const titleCell = screen.getByText("Attention Is All You Need").closest("td")!;
    titleCell.focus();
    fireEvent.keyDown(document, { key: "a" });
    expect(document.activeElement).toBe(titleCell);
  });

  it("the bare-modifier-keydown blur guard leaves the row's own selection state untouched (only the native DOM focus is cleared)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row);
    screen.getByText("Attention Is All You Need").closest("td")!.focus();
    fireEvent.keyDown(document, { key: "Shift" });
    expect(row.getAttribute("aria-selected")).toBe("true");
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

  it("opens a menu listing Sort ascending, Sort descending, and Hide", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Authors" }));
    expect(screen.getByRole("menuitem", { name: "Sort ascending" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sort descending" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Hide" })).toBeTruthy();
  });

  it("omits Hide for the Title column (never hideable)", () => {
    render(
      <CollectionTable rows={rows} onOpenRow={noop} onEditField={noop} onSortChange={noop} onToggleColumn={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    expect(screen.queryByRole("menuitem", { name: "Hide" })).toBeNull();
  });

  it("Sort ascending calls onSortChange with the column and asc direction, then closes", () => {
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ascending" }));
    expect(onSortChange).toHaveBeenCalledWith({ column: "added", direction: "asc" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Sort descending calls onSortChange with the column and desc direction", () => {
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort descending" }));
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
