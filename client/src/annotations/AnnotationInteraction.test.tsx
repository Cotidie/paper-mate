import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import AnnotationInteraction from "./AnnotationInteraction";
import { useAnnotationStore } from "../store";
import type { PageCardRef } from "../anchor";
import type { PageBox } from "../render";

const box: PageBox = { width: 600, height: 800 };

/** A page card whose getBoundingClientRect is fixed (jsdom zeroes the real one). */
function fakeCard(pageIndex: number, top: number): PageCardRef {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left: 0, top, right: 600, bottom: top + 800, width: 600, height: 800, x: 0, y: top }) as DOMRect;
  return { pageIndex, cardEl: el, box };
}

/** Stub a non-collapsed selection whose client rects fall on the given y bands. */
function stubSelection(rects: { left: number; top: number; right: number; bottom: number }[]) {
  const domRects = rects.map((r) => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }));
  const range = { getClientRects: () => domRects } as unknown as Range;
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    toString: () => "selected text",
    removeAllRanges: vi.fn(),
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(selection);
}

beforeEach(() => useAnnotationStore.setState({ annotations: new Map() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AnnotationInteraction proof path (AC-3, AC-4, AC-5, AC-7)", () => {
  it("a single-page text drag pops the quick-box, whose action stores a highlight", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled />);

    // No quick-box until a selection releases.
    expect(screen.queryByTestId("quick-box")).toBeNull();
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    const action = await screen.findByTestId("quick-box-highlight");
    fireEvent.click(action);

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("highlight");
    expect(all[0].group_id).toBeNull();
    expect(all[0].anchor.page_index).toBe(0);
    // Quick-box dismissed after commit.
    expect(screen.queryByTestId("quick-box")).toBeNull();
  });

  it("a two-page selection stores two highlights sharing one group_id (AC-5)", async () => {
    // One rect on card 0 (y~100), one on card 1 (y~900).
    stubSelection([
      { left: 10, top: 100, right: 200, bottom: 120 },
      { left: 10, top: 900, right: 200, bottom: 920 },
    ]);
    const pages = [fakeCard(0, 0), fakeCard(1, 820)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.click(await screen.findByTestId("quick-box-highlight"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(2);
    expect(all[0].group_id).not.toBeNull();
    expect(all[0].group_id).toBe(all[1].group_id);
    expect(all.map((a) => a.anchor.page_index).sort()).toEqual([0, 1]);
  });

  it("Escape dismisses the quick-box without storing anything (AC-7)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("quick-box")).toBeNull());
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("does nothing when disabled (phase not ready)", () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled={false} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    expect(screen.queryByTestId("quick-box")).toBeNull();
  });
});
