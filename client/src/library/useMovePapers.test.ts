import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useMovePapers } from "@/library/useMovePapers";
import { movePapers as apiMovePapers } from "@/api/client";
import type { CollectionRow, Library } from "@/api/client";

vi.mock("@/api/client", () => ({ movePapers: vi.fn() }));

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
    structure_status: "ready",
    ...overrides,
  };
}

function makeLibrary(papers: CollectionRow[]): Library {
  return { papers, folders: [] };
}

describe("useMovePapers", () => {
  let library: Library;
  let setLibrary: Dispatch<SetStateAction<Library | null>>;
  const onToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    library = makeLibrary([row({ doc_id: "a", folder_id: null })]);
    setLibrary = vi.fn((updater: SetStateAction<Library | null>) => {
      library = (typeof updater === "function" ? updater(library) : updater) as Library;
    });
  });

  it("optimistically sets folder_id before the request resolves", () => {
    vi.mocked(apiMovePapers).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMovePapers({ setLibrary, onToast }));

    act(() => result.current.movePapers(["a"], "folder-1"));

    expect(library.papers[0].folder_id).toBe("folder-1");
  });

  it("reconciles from the returned Library on resolve", async () => {
    const resolved = makeLibrary([row({ doc_id: "a", folder_id: "folder-1" }), row({ doc_id: "b" })]);
    vi.mocked(apiMovePapers).mockResolvedValue(resolved);
    const { result } = renderHook(() => useMovePapers({ setLibrary, onToast }));

    await act(async () => {
      result.current.movePapers(["a"], "folder-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library).toEqual(resolved);
  });

  it("reverts the optimistic set and toasts an error on failure", async () => {
    vi.mocked(apiMovePapers).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useMovePapers({ setLibrary, onToast }));

    await act(async () => {
      result.current.movePapers(["a"], "folder-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].folder_id).toBeNull();
    expect(onToast).toHaveBeenCalledWith("Couldn't move that paper.", "error");
  });

  it("a stale response cannot clobber a newer move (monotonic seq guard)", async () => {
    let resolveFirst!: (library: Library) => void;
    vi.mocked(apiMovePapers)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(makeLibrary([row({ doc_id: "a", folder_id: "folder-2" })]));

    const { result } = renderHook(() => useMovePapers({ setLibrary, onToast }));

    act(() => result.current.movePapers(["a"], "folder-1")); // slow, stale
    await act(async () => {
      result.current.movePapers(["a"], "folder-2"); // fast, newer
      await Promise.resolve();
      await Promise.resolve();
    });

    // The newer move's response already reconciled to folder-2.
    expect(library.papers[0].folder_id).toBe("folder-2");

    await act(async () => {
      resolveFirst(makeLibrary([row({ doc_id: "a", folder_id: "folder-1" })])); // stale resolves late
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale first response must not overwrite the newer state.
    expect(library.papers[0].folder_id).toBe("folder-2");
  });

  it("does not apply a resolved move after unmount", async () => {
    let resolveMove!: (library: Library) => void;
    vi.mocked(apiMovePapers).mockReturnValue(new Promise((resolve) => (resolveMove = resolve)));
    const { result, unmount } = renderHook(() => useMovePapers({ setLibrary, onToast }));

    act(() => result.current.movePapers(["a"], "folder-1"));
    unmount();
    await act(async () => {
      resolveMove(makeLibrary([row({ doc_id: "a", folder_id: "folder-1" })]));
      await Promise.resolve();
      await Promise.resolve();
    });

    // setLibrary was called once for the optimistic set, never again post-unmount.
    expect(setLibrary).toHaveBeenCalledTimes(1);
  });
});
