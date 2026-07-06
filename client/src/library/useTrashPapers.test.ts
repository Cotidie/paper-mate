import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useTrashPapers } from "@/library/useTrashPapers";
import { trashPapers as apiTrashPapers, restorePapers as apiRestorePapers, purgeDoc as apiPurgeDoc } from "@/api/client";
import type { CollectionRow, Library } from "@/api/client";

vi.mock("@/api/client", () => ({
  trashPapers: vi.fn(),
  restorePapers: vi.fn(),
  purgeDoc: vi.fn(),
}));

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

function makeLibrary(papers: CollectionRow[]): Library {
  return { papers, folders: [] };
}

describe("useTrashPapers", () => {
  let library: Library;
  let setLibrary: Dispatch<SetStateAction<Library | null>>;
  const onToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    library = makeLibrary([row({ doc_id: "a", trashed: false })]);
    setLibrary = vi.fn((updater: SetStateAction<Library | null>) => {
      library = (typeof updater === "function" ? updater(library) : updater) as Library;
    });
  });

  describe("trashPapers", () => {
    it("optimistically flips trashed before the request resolves", () => {
      vi.mocked(apiTrashPapers).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      act(() => result.current.trashPapers(["a"]));

      expect(library.papers[0].trashed).toBe(true);
    });

    it("reconciles from the returned Library on resolve", async () => {
      const resolved = makeLibrary([row({ doc_id: "a", trashed: true }), row({ doc_id: "b" })]);
      vi.mocked(apiTrashPapers).mockResolvedValue(resolved);
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.trashPapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library).toEqual(resolved);
    });

    it("reverts the optimistic flip and toasts an error on failure", async () => {
      vi.mocked(apiTrashPapers).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.trashPapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library.papers[0].trashed).toBe(false);
      expect(onToast).toHaveBeenCalledWith("Couldn't delete that paper.", "error");
    });
  });

  describe("restorePapers", () => {
    beforeEach(() => {
      library = makeLibrary([row({ doc_id: "a", trashed: true })]);
    });

    it("optimistically clears trashed before the request resolves", () => {
      vi.mocked(apiRestorePapers).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      act(() => result.current.restorePapers(["a"]));

      expect(library.papers[0].trashed).toBe(false);
    });

    it("reconciles from the returned Library and fires the restored-from-Trash notice on success", async () => {
      const resolved = makeLibrary([row({ doc_id: "a", trashed: false })]);
      vi.mocked(apiRestorePapers).mockResolvedValue(resolved);
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.restorePapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library).toEqual(resolved);
      expect(onToast).toHaveBeenCalledWith("restored from Trash", "info");
    });

    it("reverts the optimistic clear and toasts an error on failure", async () => {
      vi.mocked(apiRestorePapers).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.restorePapers(["a"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library.papers[0].trashed).toBe(true);
      expect(onToast).toHaveBeenCalledWith("Couldn't restore that paper.", "error");
    });
  });

  describe("purge", () => {
    it("optimistically removes the row before the request resolves", () => {
      vi.mocked(apiPurgeDoc).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      act(() => result.current.purge("a"));

      expect(library.papers).toHaveLength(0);
    });

    it("reconciles from the returned Library on resolve", async () => {
      const resolved = makeLibrary([row({ doc_id: "b" })]);
      vi.mocked(apiPurgeDoc).mockResolvedValue(resolved);
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.purge("a");
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library).toEqual(resolved);
    });

    it("reverts (re-inserts the row) and toasts an error on failure", async () => {
      vi.mocked(apiPurgeDoc).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

      await act(async () => {
        result.current.purge("a");
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(library.papers.map((p) => p.doc_id)).toEqual(["a"]);
      expect(onToast).toHaveBeenCalledWith("Couldn't purge that paper.", "error");
    });
  });

  it("a stale response cannot clobber a newer op (shared monotonic seq guard)", async () => {
    let resolveTrash!: (library: Library) => void;
    vi.mocked(apiTrashPapers).mockReturnValue(new Promise((resolve) => (resolveTrash = resolve)));
    vi.mocked(apiRestorePapers).mockResolvedValue(makeLibrary([row({ doc_id: "a", trashed: false })]));

    const { result } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

    act(() => result.current.trashPapers(["a"])); // slow, stale
    await act(async () => {
      result.current.restorePapers(["a"]); // fast, newer
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].trashed).toBe(false);

    await act(async () => {
      resolveTrash(makeLibrary([row({ doc_id: "a", trashed: true })])); // stale resolves late
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale trash response must not overwrite the newer restore.
    expect(library.papers[0].trashed).toBe(false);
  });

  it("does not apply a resolved op after unmount", async () => {
    let resolveTrash!: (library: Library) => void;
    vi.mocked(apiTrashPapers).mockReturnValue(new Promise((resolve) => (resolveTrash = resolve)));
    const { result, unmount } = renderHook(() => useTrashPapers({ setLibrary, onToast }));

    act(() => result.current.trashPapers(["a"]));
    unmount();
    await act(async () => {
      resolveTrash(makeLibrary([row({ doc_id: "a", trashed: true })]));
      await Promise.resolve();
      await Promise.resolve();
    });

    // setLibrary was called once for the optimistic set, never again post-unmount.
    expect(setLibrary).toHaveBeenCalledTimes(1);
  });
});
