import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import AnnotationInteraction from "./AnnotationInteraction";
import { useAnnotationStore } from "../store";
import type { PageCardRef, PageBox } from "../anchor";
import type { Annotation } from "../api/client";

const box: PageBox = { width: 600, height: 800 };

/** A page card whose getBoundingClientRect is fixed (jsdom zeroes the real one). */
function fakeCard(pageIndex: number, top: number): PageCardRef {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left: 0, top, right: 600, bottom: top + 800, width: 600, height: 800, x: 0, y: top }) as DOMRect;
  return { pageIndex, cardEl: el, box };
}

// The injected rect reader the component uses (no real layout in jsdom). Each
// stubSelection sets the bands; `reader` is a stable fn passed as the
// `rectReader` prop that always delegates to the latest.
let currentBands: DOMRect[] = [];
const reader = (): DOMRect[] => currentBands;
const stubNodes: HTMLElement[] = [];

/** Stub a non-collapsed selection whose TEXT-node rects fall on the given y
 *  bands. Built on a REAL text node (the anchor layer measures text nodes, not
 *  the whole range — collectTextRects); the injected `reader` supplies the bands
 *  for the node's sub-range. Stateful: `removeAllRanges()` collapses it, so a
 *  follow-up pointerup reads an empty selection (proves no re-pop / no re-create). */
function stubSelection(rects: { left: number; top: number; right: number; bottom: number }[]) {
  currentBands = rects.map(
    (r) =>
      ({
        ...r,
        width: r.right - r.left,
        height: r.bottom - r.top,
        x: r.left,
        y: r.top,
      }) as DOMRect,
  );
  const span = document.createElement("span");
  span.appendChild(document.createTextNode("selected text"));
  document.body.appendChild(span);
  stubNodes.push(span);
  const range = document.createRange();
  range.selectNodeContents(span.firstChild as Text);
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

beforeEach(() =>
  useAnnotationStore.setState({
    annotations: new Map(),
    selectedId: null,
    hoveredId: null,
    activeColor: "annotation-default",
  }),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  stubNodes.splice(0).forEach((n) => n.remove());
  currentBands = [];
});

/** A stored text highlight (the selection target). */
function textMark(id: string, color = "annotation-default", groupId: string | null = null): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: groupId,
    anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" },
    style: { color, stroke_width: null },
    body: null,
    created_at: "2026-06-29T00:00:01+00:00",
    updated_at: "2026-06-29T00:00:01+00:00",
  };
}

describe("AnnotationInteraction proof path (AC-3, AC-4, AC-5, AC-7)", () => {
  it("a single-page text drag pops the quick-box, whose action stores a highlight", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

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
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

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
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

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
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
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

describe("AnnotationInteraction highlight tool (Story 2.3 + 2.5 unification — AC-1,2,4,5)", () => {
  it("with highlight armed, a drag-release LANDS a default highlight and SELECTS it (unified selection box)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    // The mark landed on release at the default color.
    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("highlight");
    expect(all[0].style.color).toBe("annotation-default");
    // It is now the SELECTED mark, and the unified selection quick-box (swatch
    // row armed to its color + Delete) takes over — no separate create box.
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("color-swatch-annotation-default").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
    expect(screen.queryByTestId("quick-box-highlight")).toBeNull();
  });

  it("Story 2.6: a drag-release lands the mark in the ACTIVE color (create reads activeColor, not a hardcode)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("annotation-blue");
    render(
      <AnnotationInteraction
        docId="doc-1"
        getPages={() => pages}
        scale={1}
        enabled
        rectReader={reader}
        armedTool="highlight"
      />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    // The new mark used the chosen active color, not the default yellow.
    expect(all[0].style.color).toBe("annotation-blue");
    // The selection box opens armed to that same color.
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("color-swatch-annotation-blue").getAttribute("aria-checked")).toBe("true");
  });

  it("picking a swatch recolors the just-landed highlight and dismisses the box (selection stays)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.click(await screen.findByTestId("color-swatch-annotation-green"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].style.color).toBe("annotation-green");
    // Pick dismisses the box; the mark stays selected (ring persists).
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
  });

  it("a two-page highlight lands two marks sharing a group_id and recolors both", async () => {
    stubSelection([
      { left: 10, top: 100, right: 200, bottom: 120 },
      { left: 10, top: 900, right: 200, bottom: 920 },
    ]);
    const pages = [fakeCard(0, 0), fakeCard(1, 820)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
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
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
    );
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.keyDown(document, { key: "Escape" }); // clear the selection (keep default)
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());

    rerender(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
    );
    stubSelection([{ left: 10, top: 300, right: 200, bottom: 320 }]);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 310 });
    expect(useAnnotationStore.getState().all()).toHaveLength(2);
  });

  it("highlight create clears the live text selection so it cannot re-create on the next pointerup", () => {
    const { removeAllRanges } = stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    // One mark landed + selected; the live text selection was cleared.
    expect(useAnnotationStore.getState().all()).toHaveLength(1);
    expect(removeAllRanges).toHaveBeenCalled();
    // The cleared (now-collapsed) selection must NOT create a second mark.
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    expect(useAnnotationStore.getState().all()).toHaveLength(1);
  });

  it("disarming the tool (V) does NOT clear the current selection (selection is orthogonal, AD-12)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    const id = useAnnotationStore.getState().selectedId;
    expect(id).not.toBeNull();
    await screen.findByTestId("selection-quick-box");
    // V disarms in App → armedTool null. The selected mark stays selected.
    rerender(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool={null} />);
    expect(useAnnotationStore.getState().selectedId).toBe(id);
  });

  it("cursor mode (no armed tool) keeps the 2.2 proof button, not the swatch row", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool={null} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box-highlight");
    expect(screen.queryByTestId("color-swatch-annotation-default")).toBeNull();
    // No mark until the proof action is clicked (cursor mode is create-on-pick).
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });
});

describe("AnnotationInteraction underline tool (Story 2.7 — AC1,2,3)", () => {
  it("with underline armed, a drag-release LANDS a type=underline mark in the active color and SELECTS it", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("annotation-green");
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="underline" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    // The create path read the armed tool's type, not a hardcoded "highlight".
    expect(all[0].type).toBe("underline");
    expect(all[0].anchor.kind).toBe("text");
    expect(all[0].style.color).toBe("annotation-green");
    // It is selected → the same selection quick-box (swatch row + delete, AC2).
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("color-swatch-annotation-green").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
  });

  it("a two-page underline lands two type=underline marks sharing one group_id (AR-4)", () => {
    stubSelection([
      { left: 10, top: 100, right: 200, bottom: 120 },
      { left: 10, top: 900, right: 200, bottom: 920 },
    ]);
    const pages = [fakeCard(0, 0), fakeCard(1, 820)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="underline" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(2);
    expect(all.every((a) => a.type === "underline")).toBe(true);
    expect(all[0].group_id).not.toBeNull();
    expect(all[0].group_id).toBe(all[1].group_id);
  });
});

describe("AnnotationInteraction selection quick-box (Story 2.5 — AC2,3,4)", () => {
  /** Render the interaction layer with one page card and select a stored mark. */
  function setup(marks: Annotation[], selectId: string) {
    marks.forEach((m) => useAnnotationStore.getState().addAnnotation(m));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select(selectId));
  }

  it("renders the selection quick-box (swatch row armed to the mark color + Delete) when a mark is selected", async () => {
    setup([textMark("m1", "annotation-green")], "m1");
    await screen.findByTestId("selection-quick-box");
    // The row shows the mark's CURRENT color armed.
    const armed = screen.getByTestId("color-swatch-annotation-green");
    expect(armed.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
  });

  it("moves focus INTO the box on open and RESTORES it on close", async () => {
    // Focus a sentinel before selecting, so we can assert focus returns to it.
    const sentinel = document.createElement("button");
    document.body.appendChild(sentinel);
    sentinel.focus();
    expect(document.activeElement).toBe(sentinel);

    setup([textMark("m1", "annotation-green")], "m1");
    const box = await screen.findByTestId("selection-quick-box");
    // Focus moved into the box (its first control).
    expect(box.contains(document.activeElement)).toBe(true);

    // Closing (Esc clears the selection) restores focus to the prior element.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
    expect(document.activeElement).toBe(sentinel);
    sentinel.remove();
  });

  it("does NOT open the box for a selected mark whose text anchor has no rects (guard)", () => {
    const empty = textMark("m1");
    empty.anchor = { kind: "text", page_index: 0, rects: [], text: "x" };
    setup([empty], "m1");
    // Selected, but no rects → no box (would crash denormalizeRect otherwise).
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
  });

  it("picking a swatch recolors the selected mark and dismisses the box; the selection stays", async () => {
    setup([textMark("m1", "annotation-default")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-pink"));
    expect(useAnnotationStore.getState().annotations.get("m1")!.style.color).toBe("annotation-pink");
    // Pick dismisses the box but the mark stays selected (ring persists).
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
  });

  it("Story 2.6 req3: recoloring an existing mark also updates the active/default color (remember last choice)", async () => {
    setup([textMark("m1", "annotation-default")], "m1");
    await screen.findByTestId("selection-quick-box");
    expect(useAnnotationStore.getState().activeColor).toBe("annotation-default");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-purple"));
    // Editing a highlight's color carries into the session default for new marks.
    expect(useAnnotationStore.getState().activeColor).toBe("annotation-purple");
  });

  it("recolors the whole group together (two-page highlight)", async () => {
    setup([textMark("m1", "annotation-default", "g1"), textMark("m2", "annotation-default", "g1")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    const map = useAnnotationStore.getState().annotations;
    expect(map.get("m1")!.style.color).toBe("annotation-blue");
    expect(map.get("m2")!.style.color).toBe("annotation-blue");
  });

  it("the Delete button removes the mark and clears the selection", async () => {
    setup([textMark("m1")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("quick-box-delete"));
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
  });

  it("Del deletes the selected mark (and its group siblings, AR-4)", () => {
    setup([textMark("m1", "annotation-default", "g1"), textMark("m2", "annotation-default", "g1")], "m1");
    fireEvent.keyDown(document, { key: "Delete" });
    const map = useAnnotationStore.getState().annotations;
    expect(map.has("m1")).toBe(false);
    expect(map.has("m2")).toBe(false);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("Backspace also deletes the selected mark", () => {
    setup([textMark("m1")], "m1");
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
  });

  it("Esc clears the selection without deleting", async () => {
    setup([textMark("m1")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
  });

  it("a pointerdown on empty space (not a mark, not the box) clears the selection", async () => {
    setup([textMark("m1")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.pointerDown(document.body);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("a pointerdown inside the selection box does NOT clear the selection", async () => {
    setup([textMark("m1")], "m1");
    const box = await screen.findByTestId("selection-quick-box");
    fireEvent.pointerDown(box);
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
  });

  it("scroll (incl. zoom recenter) CLOSES the box but keeps the selection ringed", async () => {
    setup([textMark("m1")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.scroll(document, {});
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
    // The selection (ring) stays — it rides the denormalized rect (NFR-3).
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
  });

  it("does not delete on Del while typing in an input (editable exempt)", () => {
    setup([textMark("m1")], "m1");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(true);
    input.remove();
  });

  it("Esc inside an editable field does NOT clear the selection (exempt order)", () => {
    setup([textMark("m1")], "m1");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
    input.remove();
  });

  it("a Ctrl-chord Delete does NOT delete the selected mark", () => {
    setup([textMark("m1")], "m1");
    fireEvent.keyDown(document, { key: "Delete", ctrlKey: true });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(true);
  });

  it("a stale selection from another doc renders no box and cannot be deleted here", () => {
    // Mark belongs to doc-1; this reader is doc-2. The global store survives a
    // doc switch, so the cross-doc selectedId must be inert here.
    useAnnotationStore.getState().addAnnotation(textMark("other"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-2" getPages={() => pages} scale={1} enabled />);
    act(() => useAnnotationStore.getState().select("other"));
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
    fireEvent.keyDown(document, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("other")).toBe(true);
  });

  it("switching the reader's doc clears any prior selection", () => {
    useAnnotationStore.getState().addAnnotation(textMark("m1"));
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().select("m1"));
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
    rerender(<AnnotationInteraction docId="doc-2" getPages={() => pages} scale={1} enabled />);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("with a mark selected, an empty-space drag still CREATES a highlight (2.3 path unbroken)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().addAnnotation(textMark("m1"));
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="highlight" />,
    );
    act(() => useAnnotationStore.getState().select("m1"));
    // A drag over EMPTY text: pointerdown on empty space deselects (AC1), then
    // release runs the 2.3 create-on-release path and lands a new mark.
    fireEvent.pointerDown(document.body);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    expect(useAnnotationStore.getState().all().length).toBe(2);
    // The create swatch row pops (selection box is gone), proving create still works.
    await screen.findByTestId("color-swatch-annotation-default");
  });
});
