import { describe, it, expect } from "vitest";
import { filterPapers, isSelected, type FolderSelection } from "@/library/folderFilter";
import type { CollectionRow } from "@/api/client";

function row(overrides: Partial<CollectionRow>): CollectionRow {
  return {
    doc_id: "d",
    title: "T",
    authors: null,
    added: "2026-07-06T00:00:00Z",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    order: 0,
    ...overrides,
  };
}

describe("filterPapers", () => {
  const papers: CollectionRow[] = [
    row({ doc_id: "uncategorized", folder_id: null }),
    row({ doc_id: "in-folder-a", folder_id: "folder-a" }),
    row({ doc_id: "in-folder-b", folder_id: "folder-b" }),
    row({ doc_id: "trashed-uncategorized", folder_id: null, trashed: true }),
    row({ doc_id: "trashed-in-folder-a", folder_id: "folder-a", trashed: true }),
  ];

  it("all: every non-trashed paper regardless of folder", () => {
    const result = filterPapers(papers, { kind: "all" });
    expect(result.map((p) => p.doc_id)).toEqual(["uncategorized", "in-folder-a", "in-folder-b"]);
  });

  it("uncategorized: only non-trashed papers with no folder", () => {
    const result = filterPapers(papers, { kind: "uncategorized" });
    expect(result.map((p) => p.doc_id)).toEqual(["uncategorized"]);
  });

  it("folder: only non-trashed papers in that folder", () => {
    const result = filterPapers(papers, { kind: "folder", id: "folder-a" });
    expect(result.map((p) => p.doc_id)).toEqual(["in-folder-a"]);
  });

  it("excludes trashed papers in every non-trash selection kind", () => {
    for (const selection of [
      { kind: "all" } as const,
      { kind: "uncategorized" } as const,
      { kind: "folder", id: "folder-a" } as const,
    ]) {
      const result = filterPapers(papers, selection);
      expect(result.some((p) => p.trashed)).toBe(false);
    }
  });

  it("trash: only trashed papers, regardless of folder", () => {
    const result = filterPapers(papers, { kind: "trash" });
    expect(result.map((p) => p.doc_id)).toEqual(["trashed-uncategorized", "trashed-in-folder-a"]);
  });
});

describe("isSelected", () => {
  it("matches all/uncategorized by kind alone", () => {
    expect(isSelected({ kind: "all" }, { kind: "all" })).toBe(true);
    expect(isSelected({ kind: "uncategorized" }, { kind: "uncategorized" })).toBe(true);
    expect(isSelected({ kind: "all" }, { kind: "uncategorized" })).toBe(false);
  });

  it("matches folder by id", () => {
    const a: FolderSelection = { kind: "folder", id: "x" };
    const b: FolderSelection = { kind: "folder", id: "x" };
    const c: FolderSelection = { kind: "folder", id: "y" };
    expect(isSelected(a, b)).toBe(true);
    expect(isSelected(a, c)).toBe(false);
  });

  it("does not match folder against all/uncategorized", () => {
    expect(isSelected({ kind: "folder", id: "x" }, { kind: "all" })).toBe(false);
  });

  it("matches trash by kind alone", () => {
    expect(isSelected({ kind: "trash" }, { kind: "trash" })).toBe(true);
    expect(isSelected({ kind: "trash" }, { kind: "all" })).toBe(false);
  });
});
