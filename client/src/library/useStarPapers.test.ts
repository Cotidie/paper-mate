import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useStarPapers } from "@/library/useStarPapers";
import { starPapers as apiStarPapers, unstarPapers as apiUnstarPapers } from "@/api/client";
import type { CollectionRow, Library } from "@/api/client";

vi.mock("@/api/client", () => ({
  starPapers: vi.fn(),
  unstarPapers: vi.fn(),
}));

function row(overrides: Partial<CollectionRow>): CollectionRow {
  return {
    doc_id: "d",
    title: "T",
    authors: null,
    authors_list: [],
    added: "2026-07-06T00:00:00Z",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 0,
    ...overrides,
  };
}

function makeLibrary(papers: CollectionRow[]): Library {
  return { papers, folders: [] };
}

describe("useStarPapers", () => {
  let library: Library;
  let setLibrary: Dispatch<SetStateAction<Library | null>>;
  const onToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    library = makeLibrary([row({ doc_id: "a", starred: false })]);
    setLibrary = vi.fn((updater: SetStateAction<Library | null>) => {
      library = (typeof updater === "function" ? updater(library) : updater) as Library;
    });
  });

  describe("starPapers", () => {
    it("optimistically flips starred before the request resolves", () => {
      vi.mocked(apiStarPapers).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

      act(() => result.current.starPapers(["a"]));

      expect(library.papers[0].starred).toBe(true);
    });

    it("reconciles from the returned Library on resolve", async () => {
      const resolved = makeLibrary([row({ doc_id: "a", starred: true }), row({ doc_id: "b" })]);
      vi.mocked(apiStarPapers).mockResolvedValue(resolved);
      const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.starPapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library).toEqual(resolved);
    });

    it("reverts the optimistic flip and toasts an error on failure", async () => {
      vi.mocked(apiStarPapers).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.starPapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library.papers[0].starred).toBe(false);
      expect(onToast).toHaveBeenCalledWith("Couldn't star that paper.", "error");
    });

    it("does not fire a success toast (silent, self-evident from the marker)", async () => {
      const resolved = makeLibrary([row({ doc_id: "a", starred: true })]);
      vi.mocked(apiStarPapers).mockResolvedValue(resolved);
      const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.starPapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onToast).not.toHaveBeenCalled();
    });
  });

  describe("unstarPapers", () => {
    beforeEach(() => {
      library = makeLibrary([row({ doc_id: "a", starred: true })]);
    });

    it("optimistically clears starred before the request resolves", () => {
      vi.mocked(apiUnstarPapers).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

      act(() => result.current.unstarPapers(["a"]));

      expect(library.papers[0].starred).toBe(false);
    });

    it("reconciles from the returned Library on resolve", async () => {
      const resolved = makeLibrary([row({ doc_id: "a", starred: false })]);
      vi.mocked(apiUnstarPapers).mockResolvedValue(resolved);
      const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.unstarPapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library).toEqual(resolved);
    });

    it("reverts the optimistic clear and toasts an error on failure", async () => {
      vi.mocked(apiUnstarPapers).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.unstarPapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library.papers[0].starred).toBe(true);
      expect(onToast).toHaveBeenCalledWith("Couldn't unstar that paper.", "error");
    });
  });

  it("a stale response cannot clobber a newer op (shared monotonic seq guard)", async () => {
    let resolveStar!: (library: Library) => void;
    vi.mocked(apiStarPapers).mockReturnValue(new Promise((resolve) => (resolveStar = resolve)));
    vi.mocked(apiUnstarPapers).mockResolvedValue(makeLibrary([row({ doc_id: "a", starred: false })]));

    const { result } = renderHook(() => useStarPapers({ setLibrary, onToast }));

    act(() => result.current.starPapers(["a"])); // slow, stale
    await act(async () => {
      result.current.unstarPapers(["a"]); // fast, newer
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].starred).toBe(false);

    await act(async () => {
      resolveStar(makeLibrary([row({ doc_id: "a", starred: true })])); // stale resolves late
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale star response must not overwrite the newer unstar.
    expect(library.papers[0].starred).toBe(false);
  });

  it("does not apply a resolved op after unmount", async () => {
    let resolveStar!: (library: Library) => void;
    vi.mocked(apiStarPapers).mockReturnValue(new Promise((resolve) => (resolveStar = resolve)));
    const { result, unmount } = renderHook(() => useStarPapers({ setLibrary, onToast }));

    act(() => result.current.starPapers(["a"]));
    unmount();
    await act(async () => {
      resolveStar(makeLibrary([row({ doc_id: "a", starred: true })]));
      await Promise.resolve();
      await Promise.resolve();
    });

    // setLibrary was called once for the optimistic set, never again post-unmount.
    expect(setLibrary).toHaveBeenCalledTimes(1);
  });
});
