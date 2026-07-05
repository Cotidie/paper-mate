import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CollectionTable, { formatAdded } from "@/library/CollectionTable";
import type { CollectionRow } from "@/api/client";

afterEach(cleanup);

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
});

describe("formatAdded", () => {
  it("returns the raw string for an unparseable date", () => {
    expect(formatAdded("not-a-date")).toBe("not-a-date");
  });
});
