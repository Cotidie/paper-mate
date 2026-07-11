import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useAutosave, DEBOUNCE_MS } from "./useAutosave";
import { useAnnotationStore, openDoc, DEFAULT_MEMO_SIZE } from "@/store";
import * as api from "@/api/client";
import type { Annotation } from "@/api/client";

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
    docId: null,
    annotations: new Map(),
    selectedId: null,
    multiSelectedIds: [],
    hoveredId: null,
    dragPreview: null,
    groupDragPreview: null,
    activeColors: {
      highlight: "annotation-default",
      underline: "annotation-default",
      pen: "annotation-default",
      memo: "annotation-default",
      comment: "annotation-default",
    },
    activeStrokeWidth: 8,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    activeAlpha: { pen: 0.4, memo: 0.4 },
  });
  useAnnotationStore.temporal.getState().clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutosave (Story 3.4, doc-scoped per Story 5.8)", () => {
  it("the initial mount fires no PUT, even with a pre-existing annotation set (AC-1)", async () => {
    act(() => openDoc("doc-1", [mark("preexisting")]));
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);

    renderHook(() => useAutosave());
    await tick(DEBOUNCE_MS * 2);

    expect(spy).not.toHaveBeenCalled();
  });

  it("one store change fires exactly one PUT with the full set after the debounce (AC-2)", async () => {
    act(() => openDoc("doc-1", []));
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave());

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

    act(() => openDoc("doc-1", []));
    renderHook(() => useAutosave());

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

    act(() => openDoc("doc-1", []));
    const { result } = renderHook(() => useAutosave());

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

  it("unmounting with a pending debounce timer flushes it instead of dropping the edit (Story 6.1, Codex High)", async () => {
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    act(() => openDoc("doc-1", []));
    const { unmount } = renderHook(() => useAutosave());

    act(() => useAnnotationStore.getState().addAnnotation(mark("a")));
    // Unmount BEFORE the debounce elapses (e.g. back-to-Library, Story 6.1's
    // reader now unmounts for real on navigation): the pending save must
    // still happen, not be silently discarded by the effect cleanup.
    unmount();
    await tick(0);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("doc-1", [expect.objectContaining({ id: "a" })]);
  });

  it("unmounting with no pending change fires no PUT (nothing dirty to flush)", async () => {
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    act(() => openDoc("doc-1", []));
    const { unmount } = renderHook(() => useAutosave());

    unmount();
    await tick(DEBOUNCE_MS * 2);

    expect(spy).not.toHaveBeenCalled();
  });

  it("switching docs (openDoc) resets the baseline: the first annotations value under the new doc is not dirty", async () => {
    act(() => openDoc("doc-1", [mark("a", "doc-1")]));
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    renderHook(() => useAutosave());

    await tick(DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();

    act(() => openDoc("doc-2", []));
    await tick(DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
  });

  it("no open doc (store.docId stays null) never PUTs even if annotations change directly", async () => {
    const spy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    renderHook(() => useAutosave());
    act(() => useAnnotationStore.getState().addAnnotation(mark("a")));
    await tick(DEBOUNCE_MS * 2);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a stale in-flight PUT from a previous doc cannot corrupt the new doc's continuous single-flight state (Codex High, H6 across doc switches)", async () => {
    const dA = deferred<void>();
    const dB = deferred<void>();
    const spy = vi
      .spyOn(api, "putAnnotations")
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise)
      .mockImplementationOnce(() => Promise.resolve());

    act(() => openDoc("doc-A", []));
    renderHook(() => useAutosave());

    act(() => useAnnotationStore.getState().addAnnotation(mark("a1", "doc-A")));
    await tick(DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenNthCalledWith(1, "doc-A", [expect.objectContaining({ id: "a1" })]);

    // Switch docs while A's PUT is still unresolved (in flight).
    act(() => openDoc("doc-B", []));

    act(() => useAnnotationStore.getState().addAnnotation(mark("b1", "doc-B")));
    await tick(DEBOUNCE_MS);
    // B's edit is dirty but coalesces behind A's still-in-flight PUT
    // (continuous single-flight): no second, CONCURRENT PUT starts yet.
    expect(spy).toHaveBeenCalledTimes(1);

    // The stale doc-A PUT resolves now. It must not fire an extra/stray PUT
    // of its own; it only clears the flag, letting the coalesced doc-B change
    // flush for real as the ONE legitimate follow-up. Assert the PAYLOAD, not
    // just the call count/target: a regression that PUTs doc-A's stale
    // snapshot to doc-B would still satisfy a `toHaveBeenCalledTimes`-only
    // check, so pin the actual ids — doc-B's own mark only, never doc-A's.
    await act(async () => {
      dA.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(2, "doc-B", [expect.objectContaining({ id: "b1" })]);

    // A further doc-B change while doc-B's OWN PUT (dB) is genuinely in
    // flight must coalesce, not start an overlapping third PUT (H6).
    act(() => useAnnotationStore.getState().addAnnotation(mark("b2", "doc-B")));
    await tick(DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(2);

    // Once dB resolves, the coalesced doc-B change flushes for real — exactly
    // ONE follow-up PUT, not two, carrying BOTH of doc-B's own marks and
    // NEITHER of doc-A's.
    await act(async () => {
      dB.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenNthCalledWith(3, "doc-B", [
      expect.objectContaining({ id: "b1" }),
      expect.objectContaining({ id: "b2" }),
    ]);
  });
});
