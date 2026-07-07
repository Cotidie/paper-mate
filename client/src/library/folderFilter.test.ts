import { describe, it, expect } from "vitest";
import {
  filterPapers,
  isSelected,
  msUntilNextUtcMidnight,
  recentBucket,
  recentGroupLabels,
  type FolderSelection,
} from "@/library/folderFilter";
import type { CollectionRow } from "@/api/client";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A fixed reference instant (post-review scope tests use this instead of the
 * real clock, so a bucket/cutoff boundary is never flaky). */
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

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

describe("filterPapers: recent", () => {
  it("orders by last_opened descending", () => {
    const papers: CollectionRow[] = [
      row({ doc_id: "oldest", last_opened: new Date(NOW - 6 * DAY_MS).toISOString() }),
      row({ doc_id: "newest", last_opened: new Date(NOW).toISOString() }),
      row({ doc_id: "middle", last_opened: new Date(NOW - 3 * DAY_MS).toISOString() }),
    ];
    const result = filterPapers(papers, { kind: "recent" }, NOW);
    expect(result.map((p) => p.doc_id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("has no numeric cap: every paper within the last month passes, however many", () => {
    const papers: CollectionRow[] = Array.from({ length: 60 }, (_, i) =>
      row({ doc_id: `d${i}`, last_opened: new Date(NOW - i * 1000).toISOString() }),
    );
    const result = filterPapers(papers, { kind: "recent" }, NOW);
    expect(result).toHaveLength(60);
    expect(result.map((p) => p.doc_id)).toEqual(Array.from({ length: 60 }, (_, i) => `d${i}`));
  });

  it("excludes a paper last opened more than a month ago (rolling window, post-review scope)", () => {
    const papers: CollectionRow[] = [
      row({ doc_id: "recent", last_opened: new Date(NOW).toISOString() }),
      row({ doc_id: "too-old", last_opened: new Date(NOW - 40 * DAY_MS).toISOString() }),
    ];
    const result = filterPapers(papers, { kind: "recent" }, NOW);
    expect(result.map((p) => p.doc_id)).toEqual(["recent"]);
  });

  it("excludes trashed papers", () => {
    const papers: CollectionRow[] = [
      row({ doc_id: "kept", last_opened: new Date(NOW - 1 * DAY_MS).toISOString() }),
      row({ doc_id: "trashed", last_opened: new Date(NOW).toISOString(), trashed: true }),
    ];
    const result = filterPapers(papers, { kind: "recent" }, NOW);
    expect(result.map((p) => p.doc_id)).toEqual(["kept"]);
  });

  it("falls back to added when last_opened is null (legacy row)", () => {
    const papers: CollectionRow[] = [
      row({ doc_id: "legacy-newer-add", last_opened: null, added: new Date(NOW - 1 * DAY_MS).toISOString() }),
      row({
        doc_id: "reconciled-older-add",
        last_opened: new Date(NOW - 4 * DAY_MS).toISOString(),
        added: new Date(NOW - 5 * DAY_MS).toISOString(),
      }),
    ];
    const result = filterPapers(papers, { kind: "recent" }, NOW);
    expect(result.map((p) => p.doc_id)).toEqual(["legacy-newer-add", "reconciled-older-add"]);
  });
});

describe("recentBucket", () => {
  it("buckets a paper opened today", () => {
    expect(recentBucket(new Date(NOW).toISOString(), NOW)).toBe("Today");
  });

  it("buckets a paper opened yesterday", () => {
    expect(recentBucket(new Date(NOW - 1 * DAY_MS).toISOString(), NOW)).toBe("Yesterday");
  });

  it("buckets a paper opened 4 days ago as last week", () => {
    expect(recentBucket(new Date(NOW - 4 * DAY_MS).toISOString(), NOW)).toBe("Last week");
  });

  it("buckets a paper opened 15 days ago as last month", () => {
    expect(recentBucket(new Date(NOW - 15 * DAY_MS).toISOString(), NOW)).toBe("Last month");
  });

  it("returns null past the last-month cutoff (31+ days ago)", () => {
    expect(recentBucket(new Date(NOW - 31 * DAY_MS).toISOString(), NOW)).toBeNull();
  });
});

describe("recentGroupLabels", () => {
  it("labels only the first row of each new bucket, in the rows' given order", () => {
    const papers: CollectionRow[] = [
      row({ doc_id: "today-1", last_opened: new Date(NOW).toISOString() }),
      row({ doc_id: "today-2", last_opened: new Date(NOW - 1000).toISOString() }),
      row({ doc_id: "yesterday-1", last_opened: new Date(NOW - 1 * DAY_MS).toISOString() }),
      row({ doc_id: "last-week-1", last_opened: new Date(NOW - 4 * DAY_MS).toISOString() }),
    ];
    const labels = recentGroupLabels(papers, NOW);
    expect(labels.get("today-1")).toBe("Today");
    expect(labels.has("today-2")).toBe(false);
    expect(labels.get("yesterday-1")).toBe("Yesterday");
    expect(labels.get("last-week-1")).toBe("Last week");
  });

  it("returns an empty map when every row is past the cutoff", () => {
    const papers: CollectionRow[] = [row({ doc_id: "ancient", last_opened: new Date(NOW - 60 * DAY_MS).toISOString() })];
    expect(recentGroupLabels(papers, NOW).size).toBe(0);
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

  it("matches recent by kind alone", () => {
    expect(isSelected({ kind: "recent" }, { kind: "recent" })).toBe(true);
    expect(isSelected({ kind: "recent" }, { kind: "all" })).toBe(false);
  });
});

describe("msUntilNextUtcMidnight", () => {
  it("returns the exact gap to the next UTC midnight", () => {
    const noon = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(msUntilNextUtcMidnight(noon)).toBe(12 * 60 * 60 * 1000);
  });

  it("returns a full day when already exactly at UTC midnight", () => {
    const midnight = Date.UTC(2026, 6, 15, 0, 0, 0);
    expect(msUntilNextUtcMidnight(midnight)).toBe(DAY_MS);
  });

  it("returns a short gap just before midnight", () => {
    const almostMidnight = Date.UTC(2026, 6, 15, 23, 59, 0);
    expect(msUntilNextUtcMidnight(almostMidnight)).toBe(60 * 1000);
  });
});
