import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
  },
];

describe("CollectionTable (Story 6.3)", () => {
  it("renders the four column headers and the count line", () => {
    render(<CollectionTable rows={rows} />);
    for (const label of ["Title", "Authors", "Added", "File type"]) {
      expect(screen.getByRole("columnheader", { name: label })).toBeTruthy();
    }
    expect(screen.getByText("2 files in library")).toBeTruthy();
  });

  it("renders a human date, not the raw ISO string", () => {
    render(<CollectionTable rows={rows} />);
    expect(screen.getByText(formatAdded(rows[0].added))).toBeTruthy();
    expect(screen.queryByText(rows[0].added)).toBeNull();
  });

  it("renders the PDF and Note badge labels", () => {
    render(<CollectionTable rows={rows} />);
    expect(screen.getByText("PDF")).toBeTruthy();
    expect(screen.getByText("Note")).toBeTruthy();
  });

  it("truncates Title/Authors cells with ellipsis styling", () => {
    render(<CollectionTable rows={rows} />);
    const titleCell = screen.getByText("Attention Is All You Need");
    expect(titleCell.className).toContain("collection-table__title");
  });

  it("falls back to Untitled for a null title", () => {
    render(<CollectionTable rows={rows} />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("shows skeleton rows and no real data while loading", () => {
    render(<CollectionTable loading />);
    expect(document.querySelectorAll(".collection-table__skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByText("Attention Is All You Need")).toBeNull();
    expect(screen.queryByText(/files in library/)).toBeNull();
  });
});

describe("formatAdded", () => {
  it("returns the raw string for an unparseable date", () => {
    expect(formatAdded("not-a-date")).toBe("not-a-date");
  });
});
