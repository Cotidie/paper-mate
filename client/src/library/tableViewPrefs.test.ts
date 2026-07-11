import { describe, it, expect, beforeEach } from "vitest";
import { useTableViewPrefs } from "./tableViewPrefs";
import { COLUMNS, type ColumnKey } from "./tableView";

const DEFAULT_ORDER: ColumnKey[] = COLUMNS.map((c) => c.key);

// Gotcha (Dev Notes): the `persist` middleware writes localStorage, which
// leaks across tests. Reset the store AND clear localStorage so a mutation
// in one test can't poison the next (mirrors `settings/store.test.ts`).
beforeEach(() => {
  localStorage.clear();
  useTableViewPrefs.getState().reset();
});

describe("useTableViewPrefs defaults (Story 7.10, AC-3/AC-5)", () => {
  it("defaults to the COLUMNS order, hidden: [file_type], and empty widths", () => {
    const state = useTableViewPrefs.getState();
    expect(state.order).toEqual(DEFAULT_ORDER);
    expect(state.hidden).toEqual(["file_type"]);
    expect(state.widths).toEqual({});
  });
});

describe("useTableViewPrefs actions", () => {
  it("reorderColumns delegates to the pure helper and updates order", () => {
    useTableViewPrefs.getState().reorderColumns("doi", "authors");
    expect(useTableViewPrefs.getState().order).toEqual([
      "title",
      "doi",
      "authors",
      "venue_short",
      "venue",
      "year",
      "location",
      "added",
      "file_type",
    ]);
  });

  it("toggleHidden hides and unhides a column", () => {
    useTableViewPrefs.getState().toggleHidden("authors");
    expect(useTableViewPrefs.getState().hidden).toContain("authors");
    useTableViewPrefs.getState().toggleHidden("authors");
    expect(useTableViewPrefs.getState().hidden).not.toContain("authors");
  });

  it("toggleHidden('title') is a no-op (Title is never hideable)", () => {
    useTableViewPrefs.getState().toggleHidden("title");
    expect(useTableViewPrefs.getState().hidden).not.toContain("title");
  });

  it("setWidth persists a column's width", () => {
    useTableViewPrefs.getState().setWidth("venue", 260);
    expect(useTableViewPrefs.getState().widths.venue).toBe(260);
  });

  it("reset restores every default", () => {
    useTableViewPrefs.getState().reorderColumns("venue", "authors");
    useTableViewPrefs.getState().toggleHidden("authors");
    useTableViewPrefs.getState().setWidth("venue", 260);
    useTableViewPrefs.getState().reset();
    const state = useTableViewPrefs.getState();
    expect(state.order).toEqual(DEFAULT_ORDER);
    expect(state.hidden).toEqual(["file_type"]);
    expect(state.widths).toEqual({});
  });

  it("persists order/hidden/widths to localStorage under the versioned key", () => {
    useTableViewPrefs.getState().reorderColumns("venue", "authors");
    const raw = localStorage.getItem("paper-mate:table-view");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(1);
    expect(parsed.state.order[1]).toBe("venue");
  });
});

describe("useTableViewPrefs reconcile-on-load (AC-5, forward-compat)", () => {
  function rehydrateWith(persistedState: unknown) {
    localStorage.setItem(
      "paper-mate:table-view",
      JSON.stringify({ state: persistedState, version: 1 }),
    );
    return useTableViewPrefs.persist.rehydrate();
  }

  it("drops an unknown/removed column key from a persisted order", async () => {
    await rehydrateWith({
      order: [
        "title",
        "authors",
        "venue_short",
        "removed-column",
        "venue",
        "year",
        "doi",
        "location",
        "added",
        "file_type",
      ],
      hidden: [],
      widths: {},
    });
    expect(useTableViewPrefs.getState().order).toEqual(DEFAULT_ORDER);
  });

  it("appends a known column missing from a persisted order, at the end (not spliced into the middle)", async () => {
    await rehydrateWith({
      order: ["title", "venue_short", "venue", "year", "doi", "location", "added", "file_type"], // authors missing
      hidden: [],
      widths: {},
    });
    expect(useTableViewPrefs.getState().order).toEqual([
      "title",
      "venue_short",
      "venue",
      "year",
      "doi",
      "location",
      "added",
      "file_type",
      "authors",
    ]);
  });

  it("appends MULTIPLE missing columns in DEFAULT_ORDER's own relative sequence", async () => {
    await rehydrateWith({
      order: ["title", "location", "doi"], // authors, venue_short, venue, year, added, file_type all missing
      hidden: [],
      widths: {},
    });
    expect(useTableViewPrefs.getState().order).toEqual([
      "title",
      "location",
      "doi",
      "authors",
      "venue_short",
      "venue",
      "year",
      "added",
      "file_type",
    ]);
  });

  it("appends venue_short (Story 8.5) at the end when absent from an otherwise-complete persisted order", async () => {
    await rehydrateWith({
      order: ["title", "authors", "venue", "year", "doi", "location", "added", "file_type"], // venue_short missing
      hidden: [],
      widths: {},
    });
    expect(useTableViewPrefs.getState().order).toEqual([
      "title",
      "authors",
      "venue",
      "year",
      "doi",
      "location",
      "added",
      "file_type",
      "venue_short",
    ]);
  });

  it("force-pins Title to index 0 regardless of a stored order", async () => {
    await rehydrateWith({
      order: ["authors", "title", "venue_short", "venue", "year", "doi", "location", "added", "file_type"],
      hidden: [],
      widths: {},
    });
    expect(useTableViewPrefs.getState().order[0]).toBe("title");
  });

  it("collapses a duplicate column key to its first occurrence (corrupt order, code-review fix)", async () => {
    await rehydrateWith({
      order: [
        "title",
        "authors",
        "authors",
        "venue_short",
        "venue",
        "year",
        "doi",
        "location",
        "added",
        "file_type",
      ],
      hidden: [],
      widths: {},
    });
    const order = useTableViewPrefs.getState().order;
    expect(order).toEqual(DEFAULT_ORDER);
    expect(order.filter((k) => k === "authors").length).toBe(1);
  });

  it("drops an unknown key from a persisted hidden set", async () => {
    await rehydrateWith({
      order: DEFAULT_ORDER,
      hidden: ["authors", "removed-column"],
      widths: {},
    });
    expect(useTableViewPrefs.getState().hidden).toEqual(["authors"]);
  });

  it("drops an unknown key and a non-numeric value from persisted widths", async () => {
    await rehydrateWith({
      order: DEFAULT_ORDER,
      hidden: [],
      widths: { authors: 250, "removed-column": 100, venue: "not-a-number" },
    });
    expect(useTableViewPrefs.getState().widths).toEqual({ authors: 250 });
  });

  it("drops a persisted width outside the resize clamp range (code-review fix: a hand-edited -500 or 1000000 would otherwise render before any resize interaction re-clamps it)", async () => {
    await rehydrateWith({
      order: DEFAULT_ORDER,
      hidden: [],
      widths: { title: 250, authors: -500, venue: 1000000 },
    });
    expect(useTableViewPrefs.getState().widths).toEqual({ title: 250 });
  });

  it("a non-array persisted order falls back to the default order", async () => {
    await rehydrateWith({ order: "corrupt", hidden: [], widths: {} });
    expect(useTableViewPrefs.getState().order).toEqual(DEFAULT_ORDER);
  });

  it("a missing localStorage value keeps the default state (no merge invoked)", async () => {
    localStorage.removeItem("paper-mate:table-view");
    await useTableViewPrefs.persist.rehydrate();
    const state = useTableViewPrefs.getState();
    expect(state.order).toEqual(DEFAULT_ORDER);
    expect(state.hidden).toEqual(["file_type"]);
  });

  it("corrupt JSON in localStorage keeps the default state", async () => {
    localStorage.setItem("paper-mate:table-view", "{not valid json");
    await useTableViewPrefs.persist.rehydrate();
    const state = useTableViewPrefs.getState();
    expect(state.order).toEqual(DEFAULT_ORDER);
    expect(state.hidden).toEqual(["file_type"]);
  });
});
