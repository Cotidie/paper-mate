import { describe, it, expect, afterEach, vi } from "vitest";
import { getAnnotations } from "./client";
import type { Annotation } from "./client";

function mark(id: string): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: 0, rects: [], text: "x" },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-07-01T00:00:01Z",
    updated_at: "2026-07-01T00:00:01Z",
  };
}

afterEach(() => vi.restoreAllMocks());

describe("getAnnotations (Story 3.5)", () => {
  it("GETs the annotations route and parses the bare array", async () => {
    const body = [mark("a"), mark("b")];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const got = await getAnnotations("doc-1");
    expect(fetchSpy).toHaveBeenCalledWith("/api/docs/doc-1/annotations");
    expect(got.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("returns [] for an imported-but-unannotated doc (200 + [])", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    expect(await getAnnotations("doc-1")).toEqual([]);
  });

  it("throws the { detail } envelope error on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Could not read annotations" }), { status: 500 }),
    );
    await expect(getAnnotations("doc-1")).rejects.toThrow("Could not read annotations");
  });

  it("encodes the doc id in the path", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("[]", { status: 200 }));
    await getAnnotations("a/b");
    expect(fetchSpy).toHaveBeenCalledWith("/api/docs/a%2Fb/annotations");
  });
});
