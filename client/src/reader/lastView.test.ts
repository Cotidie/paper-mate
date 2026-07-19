import { describe, it, expect, beforeEach } from "vitest";
import { useLastViewStore, reconcile, viewOffsetFraction } from "./lastView";

// Gotcha (mirrors tableViewPrefs.test.ts): `persist` writes localStorage,
// which leaks across tests. Reset the store AND clear localStorage so a
// mutation in one test can't poison the next.
beforeEach(() => {
  localStorage.clear();
  useLastViewStore.setState({ positions: {} });
});

describe("reconcile (AC #3)", () => {
  it("returns {} for a non-object", () => {
    expect(reconcile(undefined)).toEqual({});
    expect(reconcile(null)).toEqual({});
    expect(reconcile("corrupt")).toEqual({});
    expect(reconcile(["a", "b"])).toEqual({});
  });

  it("keeps a valid entry", () => {
    expect(reconcile({ "doc-1": { page: 3, frac: 0.5 } })).toEqual({
      "doc-1": { page: 3, frac: 0.5 },
    });
  });

  it("clamps an out-of-range frac into [0,1]", () => {
    expect(reconcile({ "doc-1": { page: 1, frac: -0.5 } })).toEqual({
      "doc-1": { page: 1, frac: 0 },
    });
    expect(reconcile({ "doc-1": { page: 1, frac: 1.5 } })).toEqual({
      "doc-1": { page: 1, frac: 1 },
    });
  });

  it("drops an entry with page < 1, keeping siblings", () => {
    expect(
      reconcile({ "doc-1": { page: 0, frac: 0.5 }, "doc-2": { page: 2, frac: 0.5 } }),
    ).toEqual({ "doc-2": { page: 2, frac: 0.5 } });
  });

  it("drops an entry with a non-integer page, keeping siblings", () => {
    expect(
      reconcile({ "doc-1": { page: 2.5, frac: 0.5 }, "doc-2": { page: 2, frac: 0.5 } }),
    ).toEqual({ "doc-2": { page: 2, frac: 0.5 } });
  });

  it("drops an entry with a non-finite frac, keeping siblings", () => {
    expect(
      reconcile({ "doc-1": { page: 2, frac: NaN }, "doc-2": { page: 2, frac: 0.5 } }),
    ).toEqual({ "doc-2": { page: 2, frac: 0.5 } });
    expect(reconcile({ "doc-1": { page: 2, frac: Infinity } })).toEqual({});
  });

  it("drops an entry missing a key, keeping siblings", () => {
    expect(
      reconcile({ "doc-1": { page: 2 }, "doc-2": { page: 2, frac: 0.5 } }),
    ).toEqual({ "doc-2": { page: 2, frac: 0.5 } });
    expect(
      reconcile({ "doc-1": { frac: 0.5 }, "doc-2": { page: 2, frac: 0.5 } }),
    ).toEqual({ "doc-2": { page: 2, frac: 0.5 } });
  });

  it("does not clamp page to a max (no page_count knowledge here)", () => {
    expect(reconcile({ "doc-1": { page: 9999, frac: 0.5 } })).toEqual({
      "doc-1": { page: 9999, frac: 0.5 },
    });
  });
});

describe("viewOffsetFraction (AC #1)", () => {
  it("returns a mid-page fraction", () => {
    expect(viewOffsetFraction(150, 100, 200)).toBeCloseTo(0.25);
  });

  it("returns 0 at the top of the page", () => {
    expect(viewOffsetFraction(100, 100, 200)).toBe(0);
  });

  it("clamps below 0", () => {
    expect(viewOffsetFraction(0, 100, 200)).toBe(0);
  });

  it("clamps above 1", () => {
    expect(viewOffsetFraction(400, 100, 200)).toBe(1);
  });

  it("returns 0 when clientHeight <= 0", () => {
    expect(viewOffsetFraction(150, 100, 0)).toBe(0);
    expect(viewOffsetFraction(150, 100, -10)).toBe(0);
  });

  it("is scale-independent: scaling scrollTop/offsetTop/clientHeight by a common factor yields the same fraction", () => {
    const a = viewOffsetFraction(150, 100, 200);
    const b = viewOffsetFraction(300, 200, 400);
    expect(b).toBeCloseTo(a);
  });
});

describe("useLastViewStore actions", () => {
  it("remember writes positions[docId]", () => {
    useLastViewStore.getState().remember("doc-1", { page: 4, frac: 0.3 });
    expect(useLastViewStore.getState().positions["doc-1"]).toEqual({ page: 4, frac: 0.3 });
  });

  it("forget deletes the entry", () => {
    useLastViewStore.getState().remember("doc-1", { page: 4, frac: 0.3 });
    useLastViewStore.getState().forget("doc-1");
    expect(useLastViewStore.getState().positions["doc-1"]).toBeUndefined();
  });

  it("remember does not clobber a sibling doc's entry", () => {
    useLastViewStore.getState().remember("doc-1", { page: 1, frac: 0 });
    useLastViewStore.getState().remember("doc-2", { page: 5, frac: 0.9 });
    expect(useLastViewStore.getState().positions).toEqual({
      "doc-1": { page: 1, frac: 0 },
      "doc-2": { page: 5, frac: 0.9 },
    });
  });

  it("persists positions to localStorage under the versioned key", () => {
    useLastViewStore.getState().remember("doc-1", { page: 4, frac: 0.3 });
    const raw = localStorage.getItem("paper-mate:last-view");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(1);
    expect(parsed.state.positions["doc-1"]).toEqual({ page: 4, frac: 0.3 });
  });
});

describe("useLastViewStore reconcile-on-load", () => {
  function rehydrateWith(persistedState: unknown) {
    localStorage.setItem(
      "paper-mate:last-view",
      JSON.stringify({ state: persistedState, version: 1 }),
    );
    return useLastViewStore.persist.rehydrate();
  }

  it("drops a corrupt entry on rehydrate, keeping a valid sibling", async () => {
    await rehydrateWith({
      positions: { "doc-1": { page: -1, frac: 0.5 }, "doc-2": { page: 2, frac: 0.5 } },
    });
    expect(useLastViewStore.getState().positions).toEqual({ "doc-2": { page: 2, frac: 0.5 } });
  });

  it("a missing localStorage value keeps the default empty state", async () => {
    localStorage.removeItem("paper-mate:last-view");
    await useLastViewStore.persist.rehydrate();
    expect(useLastViewStore.getState().positions).toEqual({});
  });

  it("corrupt JSON in localStorage keeps the default empty state", async () => {
    localStorage.setItem("paper-mate:last-view", "{not valid json");
    await useLastViewStore.persist.rehydrate();
    expect(useLastViewStore.getState().positions).toEqual({});
  });
});
