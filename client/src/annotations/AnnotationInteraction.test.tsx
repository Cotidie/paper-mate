import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import AnnotationInteraction from "./AnnotationInteraction";
import { useAnnotationStore } from "../store";
import type { PageCardRef, PageBox } from "../anchor";

const box: PageBox = { width: 600, height: 800 };

/** A page card whose getBoundingClientRect is fixed (jsdom zeroes the real one). */
function fakeCard(pageIndex: number, top: number): PageCardRef {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left: 0, top, right: 600, bottom: top + 800, width: 600, height: 800, x: 0, y: top }) as DOMRect;
  return { pageIndex, cardEl: el, box };
}

/** Stub a non-collapsed selection whose client rects fall on the given y bands.
 *  Stateful: `removeAllRanges()` actually collapses it, so a follow-up pointerup
 *  reads an empty selection (proves dismiss can't re-pop the quick-box). */
function stubSelection(rects: { left: number; top: number; right: number; bottom: number }[]) {
  const domRects = rects.map((r) => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }));
  const range = { getClientRects: () => domRects } as unknown as Range;
  const removeAllRanges = vi.fn();
  const selection = {
    get rangeCount() {
      return removeAllRanges.mock.calls.length > 0 ? 0 : 1;
    },
    get isCollapsed() {
      return removeAllRanges.mock.calls.length > 0;
    },
    getRangeAt: () => range,
    toString: () => "selected text",
    removeAllRanges,
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(selection);
  return { removeAllRanges };
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

  it("Escape dismisses, clears the selection, and cannot re-pop from it (AC-4/AC-7)", async () => {
    const { removeAllRanges } = stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("quick-box")).toBeNull());
    expect(removeAllRanges).toHaveBeenCalled();
    expect(useAnnotationStore.getState().all()).toHaveLength(0);

    // The cleared selection must NOT re-pop the quick-box on the next pointerup.
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    expect(screen.queryByTestId("quick-box")).toBeNull();
  });

  it("dismisses the quick-box on scroll (transient overlay, #1)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");
    // Scrolling the canvas pins-detaches the popup, so it dismisses.
    fireEvent.scroll(document, {});
    await waitFor(() => expect(screen.queryByTestId("quick-box")).toBeNull());
  });

  it("does nothing when disabled (phase not ready)", () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled={false} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    expect(screen.queryByTestId("quick-box")).toBeNull();
  });
});

describe("AnnotationInteraction highlight tool (Story 2.3 — AC-1,2,4,5)", () => {
  it("with highlight armed, a drag-release LANDS a default highlight and pops the swatch row", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    // The mark landed on release (before any swatch pick).
    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("highlight");
    expect(all[0].style.color).toBe("annotation-default");
    // The quick-box shows the swatch row, not the cursor-mode proof button.
    await screen.findByTestId("color-swatch-annotation-default");
    expect(screen.queryByTestId("quick-box-highlight")).toBeNull();
  });

  it("picking a swatch recolors the just-landed highlight and dismisses", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.click(await screen.findByTestId("color-swatch-annotation-green"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].style.color).toBe("annotation-green");
    // Pick dismisses the quick-box.
    await waitFor(() => expect(screen.queryByTestId("quick-box")).toBeNull());
  });

  it("a two-page highlight lands two marks sharing a group_id and recolors both", async () => {
    stubSelection([
      { left: 10, top: 100, right: 200, bottom: 120 },
      { left: 10, top: 900, right: 200, bottom: 920 },
    ]);
    const pages = [fakeCard(0, 0), fakeCard(1, 820)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    let all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(2);
    expect(all[0].group_id).not.toBeNull();
    expect(all[0].group_id).toBe(all[1].group_id);

    fireEvent.click(await screen.findByTestId("color-swatch-annotation-pink"));
    all = useAnnotationStore.getState().all();
    expect(all.every((a) => a.style.color === "annotation-pink")).toBe(true);
  });

  it("is sticky: a second drag lands another highlight (tool stays armed)", async () => {
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />,
    );
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.keyDown(document, { key: "Escape" }); // dismiss the swatch row (keep default)
    await waitFor(() => expect(screen.queryByTestId("quick-box")).toBeNull());

    rerender(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />,
    );
    stubSelection([{ left: 10, top: 300, right: 200, bottom: 320 }]);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 310 });
    expect(useAnnotationStore.getState().all()).toHaveLength(2);
  });

  it("disarming (V) while the quick-box is open clears the selection and cannot re-pop (review fix)", async () => {
    const { removeAllRanges } = stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");

    // V disarms in App → armedTool becomes null while a quick-box is pending.
    rerender(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool={null} />,
    );
    await waitFor(() => expect(screen.queryByTestId("quick-box")).toBeNull());
    expect(removeAllRanges).toHaveBeenCalled();

    // The cleared selection must NOT re-pop the quick-box on the next pointerup.
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    expect(screen.queryByTestId("quick-box")).toBeNull();
  });

  it("cursor mode (no armed tool) keeps the 2.2 proof button, not the swatch row", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool={null} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box-highlight");
    expect(screen.queryByTestId("color-swatch-annotation-default")).toBeNull();
    // No mark until the proof action is clicked (cursor mode is create-on-pick).
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });
});
