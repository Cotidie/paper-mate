import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, type RenderHookResult } from "@testing-library/react";

import { getStructure } from "@/api/client";
import type { DocStructure } from "@/api/client";
import { useDocStructure, type DocStructureState } from "@/structure/useDocStructure";

vi.mock("@/api/client", () => ({ getStructure: vi.fn() }));

const mockGet = vi.mocked(getStructure);

const sample: DocStructure = {
  elements: [
    { id: "1", type: "heading", page_index: 0, rect: { x0: 0, y0: 0, x1: 1, y1: 0.1 }, text: "H", heading_level: 1 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default to a never-settling fetch (mirrors the library hooks' recipe): a
  // test opting into resolve/reject overrides it, and a stray call can never
  // leave a floating settled promise for vitest's tracker to flag.
  mockGet.mockReturnValue(new Promise<DocStructure>(() => {}));
});

/** Mount the hook and flush its mount-effect fetch inside a single act, so the
 *  effect's promise settles in one controlled scope (the library-hook idiom). */
async function mountAndFlush(
  docId: string | null,
): Promise<RenderHookResult<DocStructureState, unknown>> {
  let hook!: RenderHookResult<DocStructureState, unknown>;
  await act(async () => {
    hook = renderHook(() => useDocStructure(docId));
    await Promise.resolve();
    await Promise.resolve();
  });
  return hook;
}

describe("useDocStructure", () => {
  it("fetches + holds the structure for a doc", async () => {
    mockGet.mockResolvedValue(sample);
    const { result } = await mountAndFlush("doc-a");
    expect(result.current.loading).toBe(false);
    expect(result.current.structure).toEqual(sample);
    expect(mockGet).toHaveBeenCalledWith("doc-a");
  });

  it("holds the empty structure for a null docId, with no request", async () => {
    const { result } = await mountAndFlush(null);
    expect(result.current.structure).toEqual({ elements: [] });
    expect(result.current.loading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("degrades to the empty structure on a fetch failure (best-effort)", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    const { result } = await mountAndFlush("doc-b");
    expect(result.current.loading).toBe(false);
    expect(result.current.structure).toEqual({ elements: [] });
  });

  it("clears the previous doc's structure immediately on a doc switch", async () => {
    // A resolves to a non-empty structure; switching to B (fetch still pending)
    // must NOT keep showing A's elements while B loads.
    mockGet.mockResolvedValueOnce(sample);
    const { result, rerender } = renderHook(({ id }) => useDocStructure(id), {
      initialProps: { id: "doc-a" as string | null },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.structure).toEqual(sample); // A loaded

    let releaseB!: (s: DocStructure) => void;
    mockGet.mockReturnValueOnce(new Promise<DocStructure>((r) => (releaseB = r)));
    await act(async () => {
      rerender({ id: "doc-b" });
    });
    // B's fetch is in flight: A's structure is gone (empty), not stale.
    expect(result.current.structure).toEqual({ elements: [] });
    // settle B to avoid a dangling promise.
    await act(async () => {
      releaseB({ elements: [] });
      await Promise.resolve();
    });
  });
});
