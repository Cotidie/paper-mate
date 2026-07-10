import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useAuthorsEdit } from "@/library/useAuthorsEdit";
import { patchDoc as apiPatchDoc } from "@/api/client";
import type { CollectionRow, Doc, Library } from "@/api/client";

vi.mock("@/api/client", () => ({
  patchDoc: vi.fn(),
}));

function row(overrides: Partial<CollectionRow>): CollectionRow {
  return {
    doc_id: "d",
    title: "T",
    authors: "Ada Lovelace",
    authors_list: ["Ada Lovelace"],
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

function fakeDoc(overrides: Partial<Doc>): Doc {
  return {
    doc_id: "d",
    filename: "d.pdf",
    title: "T",
    page_count: 1,
    added: "2026-07-06T00:00:00Z",
    last_opened: "2026-07-06T00:00:00Z",
    authors: null,
    authors_list: [],
    file_type: "pdf",
    status: "ready",
    schema_version: 1,
    ...overrides,
  };
}

describe("useAuthorsEdit (Story 7.11, AC-4)", () => {
  let library: Library;
  let setLibrary: Dispatch<SetStateAction<Library | null>>;
  const onToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    library = makeLibrary([row({ doc_id: "d" })]);
    setLibrary = vi.fn((updater: SetStateAction<Library | null>) => {
      library = (typeof updater === "function" ? updater(library) : updater) as Library;
    });
  });

  it("optimistically writes authors_list AND the derived join, then PATCHes { authors_list }", () => {
    vi.mocked(apiPatchDoc).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuthorsEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", ["Ada Lovelace", "Alan Turing"]));

    expect(library.papers[0].authors_list).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(library.papers[0].authors).toBe("Ada Lovelace, Alan Turing");
    expect(apiPatchDoc).toHaveBeenCalledWith("d", { authors_list: ["Ada Lovelace", "Alan Turing"] });
  });

  it("committing an empty list optimistically clears authors to null", () => {
    vi.mocked(apiPatchDoc).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuthorsEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", []));

    expect(library.papers[0].authors_list).toEqual([]);
    expect(library.papers[0].authors).toBeNull();
    expect(apiPatchDoc).toHaveBeenCalledWith("d", { authors_list: [] });
  });

  it("an unchanged list (same order, same values) is a no-op: no PATCH call", () => {
    const { result } = renderHook(() => useAuthorsEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", ["Ada Lovelace"]));

    expect(apiPatchDoc).not.toHaveBeenCalled();
  });

  it("reconciles authors_list/authors from the resolved Doc on success", async () => {
    vi.mocked(apiPatchDoc).mockResolvedValue(
      fakeDoc({ doc_id: "d", authors_list: ["Grace Hopper"], authors: "Grace Hopper" }),
    );
    const { result } = renderHook(() => useAuthorsEdit({ library, setLibrary, onToast }));

    await act(async () => {
      result.current("d", ["Grace Hopper"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].authors_list).toEqual(["Grace Hopper"]);
    expect(library.papers[0].authors).toBe("Grace Hopper");
  });

  it("reverts to the prior list and toasts an error on PATCH failure", async () => {
    vi.mocked(apiPatchDoc).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAuthorsEdit({ library, setLibrary, onToast }));

    await act(async () => {
      result.current("d", ["Someone Else"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].authors_list).toEqual(["Ada Lovelace"]); // reverted
    expect(library.papers[0].authors).toBe("Ada Lovelace");
    expect(onToast).toHaveBeenCalledWith("Couldn't save that change.", "error");
  });

  it("an older PATCH resolving after a newer one does not clobber the newer result", async () => {
    let resolveFirst: (doc: Doc) => void = () => {};
    const first = new Promise<Doc>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(apiPatchDoc)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(fakeDoc({ doc_id: "d", authors_list: ["Newer"], authors: "Newer" }));
    const { result } = renderHook(() => useAuthorsEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", ["Older"]));
    await act(async () => {
      result.current("d", ["Newer"]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(library.papers[0].authors_list).toEqual(["Newer"]);

    await act(async () => {
      resolveFirst(fakeDoc({ doc_id: "d", authors_list: ["Older"], authors: "Older" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].authors_list).toEqual(["Newer"]); // the stale resolve is ignored
  });
});
