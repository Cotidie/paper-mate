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
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    for (const label of ["Title", "Authors", "Added", "File type"]) {
      expect(screen.getByRole("columnheader", { name: label })).toBeTruthy();
    }
  });

  it("never renders a count line itself (Library layout redesign: LibraryPage owns it)", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    expect(screen.queryByText(/files in library/)).toBeNull();
  });

  it("renders a human date, not the raw ISO string", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    expect(screen.getByText(formatAdded(rows[0].added))).toBeTruthy();
    expect(screen.queryByText(rows[0].added)).toBeNull();
  });

  it("renders the PDF and Note badge labels", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    expect(screen.getAllByText("PDF").length).toBe(2);
    expect(screen.getByText("Note")).toBeTruthy();
  });

  it("truncates Title/Authors cells with ellipsis styling", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    const titleCell = screen.getByText("Attention Is All You Need");
    expect(titleCell.className).toContain("collection-table__title");
  });

  it("falls back to the filename, minus the .pdf extension, for a null title", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    expect(screen.getByText("no-title-paper")).toBeTruthy();
    expect(screen.queryByText("no-title-paper.pdf")).toBeNull();
  });

  it("falls back to Untitled when neither title nor filename is known", () => {
    render(<CollectionTable rows={rows} onOpenRow={noop} />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("selects a row on first click without opening it", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row);
    expect(onOpenRow).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  it("opens a row on a second click while it is selected", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} />);
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row);
    fireEvent.click(row);
    expect(onOpenRow).toHaveBeenCalledWith(rows[0].doc_id);
  });

  it("moves selection to a newly clicked row instead of opening it", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={rows} onOpenRow={onOpenRow} />);
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
        onOpenRow={noop}
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
        onOpenRow={onOpenRow}
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
    render(<CollectionTable rows={[rowWith("extracting")]} onOpenRow={noop} />);
    expect(screen.getByText("Extracting")).toBeTruthy();
    const row = screen.getByText("A Title").closest("tr")!;
    expect(row.className).toContain("collection-table__row--extracting");
  });

  it("keeps a real extracting row selectable and openable (only pending rows are inert)", () => {
    const onOpenRow = vi.fn();
    render(<CollectionTable rows={[rowWith("extracting")]} onOpenRow={onOpenRow} />);
    const row = screen.getByText("A Title").closest("tr")!;
    expect(row.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(row); // select
    expect(row.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(row); // open
    expect(onOpenRow).toHaveBeenCalledWith("s".repeat(64));
  });

  it("renders enrich-skipped as a normal row (no status chip, shows PDF badge)", () => {
    render(<CollectionTable rows={[rowWith("enrich-skipped")]} onOpenRow={noop} />);
    expect(screen.queryByText("Extracting")).toBeNull();
    expect(screen.queryByText("No metadata")).toBeNull();
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("marks a parse-failed row with a subtle No metadata chip and the filename fallback, still interactive", () => {
    const onOpenRow = vi.fn();
    render(
      <CollectionTable rows={[rowWith("parse-failed", { title: null })]} onOpenRow={onOpenRow} />,
    );
    const chip = screen.getByText("No metadata");
    expect(chip.className).toContain("badge-pill--muted");
    // Filename fallback (extension stripped) stands in for the missing title.
    expect(screen.getByText("a-title")).toBeTruthy();
    const row = screen.getByText("a-title").closest("tr")!;
    fireEvent.click(row);
    fireEvent.click(row);
    expect(onOpenRow).toHaveBeenCalledWith("s".repeat(64));
  });
});

describe("formatAdded", () => {
  it("returns the raw string for an unparseable date", () => {
    expect(formatAdded("not-a-date")).toBe("not-a-date");
  });
});
