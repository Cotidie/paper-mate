import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useInlineEdit } from "@/library/useInlineEdit";
import { patchDoc as apiPatchDoc } from "@/api/client";
import type { CollectionRow, Doc, Library } from "@/api/client";

vi.mock("@/api/client", () => ({
  patchDoc: vi.fn(),
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
    venue: "Old Venue",
    year: 2017,
    structure_status: "ready",
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
    structure_status: "ready",
    ...overrides,
  };
}

describe("useInlineEdit (Story 7.9 fix request: venue/year editing)", () => {
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

  it("optimistically writes a string venue and PATCHes { venue }", () => {
    vi.mocked(apiPatchDoc).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useInlineEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", "venue", "New Venue"));

    expect(library.papers[0].venue).toBe("New Venue");
    expect(apiPatchDoc).toHaveBeenCalledWith("d", { venue: "New Venue" });
  });

  it("parses a numeric year string to a number before writing the row and PATCHing", () => {
    vi.mocked(apiPatchDoc).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useInlineEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", "year", "2019"));

    expect(library.papers[0].year).toBe(2019);
    expect(typeof library.papers[0].year).toBe("number");
    expect(apiPatchDoc).toHaveBeenCalledWith("d", { year: 2019 });
  });

  it("a blank year commit clears it to null", () => {
    vi.mocked(apiPatchDoc).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useInlineEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", "year", null));

    expect(library.papers[0].year).toBeNull();
    expect(apiPatchDoc).toHaveBeenCalledWith("d", { year: null });
  });

  it("an unparseable year is silently ignored: no row write, no PATCH call", () => {
    const { result } = renderHook(() => useInlineEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", "year", "not a year"));

    expect(library.papers[0].year).toBe(2017); // unchanged
    expect(apiPatchDoc).not.toHaveBeenCalled();
  });

  it("a non-integer year (e.g. a decimal) is silently ignored", () => {
    const { result } = renderHook(() => useInlineEdit({ library, setLibrary, onToast }));

    act(() => result.current("d", "year", "2019.5"));

    expect(library.papers[0].year).toBe(2017); // unchanged
    expect(apiPatchDoc).not.toHaveBeenCalled();
  });

  it("reconciles year from the resolved Doc on success", async () => {
    vi.mocked(apiPatchDoc).mockResolvedValue(fakeDoc({ doc_id: "d", year: 2019 }));
    const { result } = renderHook(() => useInlineEdit({ library, setLibrary, onToast }));

    await act(async () => {
      result.current("d", "year", "2019");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].year).toBe(2019);
  });

  it("reverts year to its prior value and toasts an error on PATCH failure", async () => {
    vi.mocked(apiPatchDoc).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useInlineEdit({ library, setLibrary, onToast }));

    await act(async () => {
      result.current("d", "year", "2019");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(library.papers[0].year).toBe(2017); // reverted
    expect(onToast).toHaveBeenCalledWith("Couldn't save that change.", "error");
  });
});
