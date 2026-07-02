import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useAutosave, DEBOUNCE_MS } from "./useAutosave";
import { useAnnotationStore, DEFAULT_MEMO_SIZE } from "./store";
import * as api from "./api/client";
import type { Annotation } from "./api/client";

function mark(id: string, docId = "doc-1"): Annotation {
  return {
    id,
    doc_id: docId,
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: 0, rects: [], text: "x" },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-07-01T00:00:01Z",
    updated_at: "2026-07-01T00:00:01Z",
  };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Advance fake timers AND let React flush any state updates that result. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  useAnnotationStore.setState({
    annotations: new Map(),
    selectedId: null,
    hoveredId: null,
    dragPreview: null,
    activeColors: {
      highlight: "annotation-default",
      underline: "annotation-default",
      pen: "annotation-default",
      memo: "annotation-default",
      comment: "annotation-default",
    },
    activeStrokeWidth: 8,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    activeAlpha: 0.4,
  });
  useAnnotationStore.temporal.getState().clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutosave (Story 3.4)", () => {
  it("the initial mount fires no PUT, even with a pre-existing annotation set (AC-1)", async () => {
    useAnnotationStore.getState().addAnnotation(mark("preexisting"));
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);

    renderHook(() => useAutosave("doc-1"));
    await tick(DEBOUNCE_MS * 2);

    expect(spy).not.toHaveBeenCalled();
  });

  it("one store change fires exactly one PUT with the full set after the debounce (AC-2)", async () => {
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave("doc-1"));

    act(() => useAnnotationStore.getState().addAnnotation(mark("a")));
    // Nothing fires before the debounce elapses.
    expect(result.current.status).toBe("idle");
    expect(spy).not.toHaveBeenCalled();

    await tick(DEBOUNCE_MS);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("doc-1", useAnnotationStore.getState().all());
  });

  it("single-flight: two rapid changes during an in-flight PUT collapse to one follow-up PUT (AC-2, H6)", async () => {
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const spy = vi
      .spyOn(api, "putAnnotations")
      .mockImplementationOnce(() => d1.promise)
      .mockImplementationOnce(() => d2.promise);

    renderHook(() => useAutosave("doc-1"));

    act(() => useAnnotationStore.getState().addAnnotation(mark("a")));
    await tick(DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1); // first PUT now in flight, unresolved

    // Two rapid changes while the first PUT is still in flight.
    act(() => useAnnotationStore.getState().addAnnotation(mark("b")));
    await tick(100);
    act(() => useAnnotationStore.getState().addAnnotation(mark("c")));
    await tick(DEBOUNCE_MS);
    // The debounce fired while in-flight: coalesced, no new call yet (H6).
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      d1.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Exactly one follow-up PUT after the in-flight one resolves.
    expect(spy).toHaveBeenCalledTimes(2);

    await act(async () => {
      d2.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it("a failed PUT sets status to error and keeps dirty so only the next change retries (AC-5)", async () => {
    const spy = vi
      .spyOn(api, "putAnnotations")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAutosave("doc-1"));

    act(() => useAnnotationStore.getState().addAnnotation(mark("a")));
    await tick(DEBOUNCE_MS);
    await tick(0); // let the rejection's catch/finally settle

    expect(result.current.status).toBe("error");
    expect(spy).toHaveBeenCalledTimes(1);

    // No further change: a failure does NOT self-retry.
    await tick(DEBOUNCE_MS * 3);
    expect(spy).toHaveBeenCalledTimes(1);

    // The next change retries the save.
    act(() => useAnnotationStore.getState().addAnnotation(mark("b")));
    await tick(DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
  });

  it("switching docId resets the baseline: the first annotations value under a new doc is not dirty", async () => {
    act(() => useAnnotationStore.getState().addAnnotation(mark("a", "doc-1")));
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);

    const { rerender } = renderHook(({ docId }) => useAutosave(docId), {
      initialProps: { docId: "doc-1" },
    });
    await tick(DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();

    rerender({ docId: "doc-2" });
    await tick(DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
  });

  it("an empty docId never PUTs even if annotations change", async () => {
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    renderHook(() => useAutosave(""));
    act(() => useAnnotationStore.getState().addAnnotation(mark("a")));
    await tick(DEBOUNCE_MS * 2);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a stale in-flight PUT from a previous doc cannot corrupt the new doc's single-flight state (Codex High, H6 across doc switches)", async () => {
    const dA = deferred<void>();
    const dB = deferred<void>();
    const spy = vi
      .spyOn(api, "putAnnotations")
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise)
      .mockImplementationOnce(() => Promise.resolve());

    const { rerender } = renderHook(({ docId }) => useAutosave(docId), {
      initialProps: { docId: "doc-A" },
    });

    act(() => useAnnotationStore.getState().addAnnotation(mark("a1", "doc-A")));
    await tick(DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenNthCalledWith(1, "doc-A", expect.anything());

    // Switch docs while A's PUT is still unresolved (in flight).
    rerender({ docId: "doc-B" });

    act(() => useAnnotationStore.getState().addAnnotation(mark("b1", "doc-B")));
    await tick(DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(2, "doc-B", expect.anything());

    // The stale doc-A PUT resolves now. It must not fire a new call and must
    // not clear the single-flight flag doc-B's own PUT (dB) is relying on.
    await act(async () => {
      dA.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spy).toHaveBeenCalledTimes(2);

    // A further doc-B change while dB is still genuinely in flight must be
    // coalesced, not start an overlapping third PUT (single-flight, H6).
    act(() => useAnnotationStore.getState().addAnnotation(mark("b2", "doc-B")));
    await tick(DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(2);

    // Once dB resolves, the coalesced doc-B change flushes for real.
    await act(async () => {
      dB.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenNthCalledWith(3, "doc-B", expect.anything());
  });
});
