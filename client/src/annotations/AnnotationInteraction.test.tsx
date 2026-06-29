import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import AnnotationInteraction from "./AnnotationInteraction";
import { useAnnotationStore, DEFAULT_MEMO_SIZE, MEMO_SIZES } from "../store";
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
    activeStrokeWidth: 4,
    activeMemoSize: DEFAULT_MEMO_SIZE,
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
    style: { color, stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-06-29T00:00:01+00:00",
    updated_at: "2026-06-29T00:00:01+00:00",
  };
}

/** Creates a .page-surface wrapper around a card and mounts it in the body. */
function setupPageSurface(card: PageCardRef): HTMLElement {
  const surface = document.createElement("div");
  surface.className = "page-surface";
  surface.appendChild(card.cardEl);
  document.body.appendChild(surface);
  return surface;
}

describe("AnnotationInteraction cursor-mode tool-type picker (Story 2.12 — AC1,2,3,4,5)", () => {
  it("a text drag in cursor mode pops a three-tool picker (highlight/underline/comment, no memo)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    expect(screen.queryByTestId("quick-box")).toBeNull();
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    await screen.findByTestId("quick-box");
    expect(screen.getByTestId("quick-box-highlight")).toBeTruthy();
    expect(screen.getByTestId("quick-box-underline")).toBeTruthy();
    expect(screen.getByTestId("quick-box-comment")).toBeTruthy();
    // Memo not in the text-drag picker.
    expect(screen.queryByTestId("quick-box-memo")).toBeNull();
    // No mark until a tool is picked (create-on-pick).
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("text-drag picker buttons are icon-only (no text children)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    const btn = await screen.findByTestId("quick-box-highlight");
    expect(btn.textContent?.trim()).toBe("");
    expect(btn.getAttribute("aria-label")).toBe("Highlight");
  });

  it("picking Highlight creates a type=highlight text-anchor mark and dismisses the picker", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.click(await screen.findByTestId("quick-box-highlight"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("highlight");
    expect(all[0].anchor.kind).toBe("text");
    expect(all[0].group_id).toBeNull();
    expect(all[0].anchor.page_index).toBe(0);
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    expect(screen.queryByTestId("quick-box")).toBeNull();
    await screen.findByTestId("selection-quick-box");
  });

  it("picking Underline creates a type=underline text-anchor mark and selects it", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.click(await screen.findByTestId("quick-box-underline"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("underline");
    expect(all[0].anchor.kind).toBe("text");
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    expect(screen.queryByTestId("quick-box")).toBeNull();
    await screen.findByTestId("selection-quick-box");
  });

  it("picking Comment creates a type=comment with body='' and does NOT open the selection quick-box (bubble instead)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    fireEvent.click(await screen.findByTestId("quick-box-comment"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("comment");
    expect(all[0].anchor.kind).toBe("text");
    expect(all[0].body).toBe("");
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    expect(screen.queryByTestId("quick-box")).toBeNull();
    // Comment shows bubble (AnnotationLayer), NOT the generic selection quick-box.
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
  });

  it("a two-page selection: picking Highlight creates two marks sharing a group_id", async () => {
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

  it("double-click on empty page area pops a Comment+Memo picker (no highlight/underline)", async () => {
    const card = fakeCard(0, 0);
    const surface = setupPageSurface(card);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [card]} scale={1} enabled rectReader={reader} />);

    // Fire dblclick against the surface (so .closest('.page-surface') matches).
    fireEvent.dblClick(surface, { button: 0, clientX: 100, clientY: 100 });

    await screen.findByTestId("quick-box");
    expect(screen.getByTestId("quick-box-comment")).toBeTruthy();
    expect(screen.getByTestId("quick-box-memo")).toBeTruthy();
    expect(screen.queryByTestId("quick-box-highlight")).toBeNull();
    expect(screen.queryByTestId("quick-box-underline")).toBeNull();
    surface.remove();
  });

  it("double-click mode: picking Comment creates a comment pin at the click point", async () => {
    const card = fakeCard(0, 0);
    const surface = setupPageSurface(card);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [card]} scale={1} enabled rectReader={reader} />);

    // clientX=120, clientY=200 → card-local x0=120, y0=200 → normalized x0=120/600, y0=200/800
    fireEvent.dblClick(surface, { button: 0, clientX: 120, clientY: 200 });
    fireEvent.click(await screen.findByTestId("quick-box-comment"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("comment");
    expect(all[0].anchor.kind).toBe("rect");
    if (all[0].anchor.kind === "rect") {
      expect(all[0].anchor.rect.x0).toBeCloseTo(120 / 600, 5);
      expect(all[0].anchor.rect.y0).toBeCloseTo(200 / 800, 5);
    }
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    expect(screen.queryByTestId("quick-box")).toBeNull();
    surface.remove();
  });

  it("double-click mode: picking Memo creates a memo at the click point", async () => {
    const card = fakeCard(0, 0);
    const surface = setupPageSurface(card);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [card]} scale={1} enabled rectReader={reader} />);

    // clientX=60, clientY=160 → card-local x0=60, y0=160
    fireEvent.dblClick(surface, { button: 0, clientX: 60, clientY: 160 });
    fireEvent.click(await screen.findByTestId("quick-box-memo"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("memo");
    expect(all[0].anchor.kind).toBe("rect");
    if (all[0].anchor.kind === "rect") {
      expect(all[0].anchor.rect.x0).toBeCloseTo(60 / 600, 5);
      expect(all[0].anchor.rect.y0).toBeCloseTo(160 / 800, 5);
      expect(all[0].anchor.rect.x1).toBeCloseTo((60 + 220) / 600, 5);
      expect(all[0].anchor.rect.y1).toBeCloseTo((160 + 88) / 800, 5);
    }
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    expect(screen.queryByTestId("quick-box")).toBeNull();
    surface.remove();
  });

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

  it("cursor mode (no armed tool) shows the three-tool picker for text drag, not the swatch row (AC1)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool={null} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box-highlight");
    expect(screen.getByTestId("quick-box-underline")).toBeTruthy();
    expect(screen.getByTestId("quick-box-comment")).toBeTruthy();
    expect(screen.queryByTestId("quick-box-memo")).toBeNull();
    expect(screen.queryByTestId("color-swatch-annotation-default")).toBeNull();
    // No mark until a tool is picked (cursor mode is create-on-pick).
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

  it("a non-text armed tool (e.g. pen) does NOT create and does NOT fall through to the cursor proof box", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool={"pen" as never} />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    // Pen has no text-drag create yet (Story 2.8); it must not land a mark, and it
    // must not pop the cursor-mode highlight proof box (the inverse-path guard).
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
    expect(screen.queryByTestId("quick-box")).toBeNull();
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

describe("AnnotationInteraction pen gesture (Story 2.8 — AC1,2)", () => {
  /** A .page-surface element (inside a .pdf-canvas) so the pen pointerdown's
   *  closest(".page-surface") check passes — the draw gesture only starts over an
   *  actual page CARD, not the gutter/chrome. */
  function canvasTarget(): HTMLElement {
    const canvas = document.createElement("div");
    canvas.className = "pdf-canvas";
    const surf = document.createElement("div");
    surf.className = "page-surface";
    canvas.appendChild(surf);
    document.body.appendChild(canvas);
    stubNodes.push(canvas);
    return surf;
  }

  it("with pen armed, a pointer drag stores ONE kind=path mark and selects it", async () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("annotation-blue");
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);

    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerMove(document, { clientX: 180, clientY: 240 });
    fireEvent.pointerUp(document, { button: 0, clientX: 180, clientY: 240 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("pen");
    expect(all[0].anchor.kind).toBe("path");
    expect(all[0].group_id).toBeNull();
    expect(all[0].style.color).toBe("annotation-blue");
    expect(all[0].style.stroke_width).toBe(4); // the default activeStrokeWidth
    if (all[0].anchor.kind === "path") {
      expect(all[0].anchor.points.length).toBe(3);
      // normalized: (60,80)/(600,800) = (0.1, 0.1)
      expect(all[0].anchor.points[0].x).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.points[0].y).toBeCloseTo(0.1, 5);
    }
    // The mark is selected → the pen selection quick-box (color + width + delete).
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("stroke-width-4")).toBeTruthy();
  });

  it("uses the active stroke width for a new stroke", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveStrokeWidth(8);
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(useAnnotationStore.getState().all()[0].style.stroke_width).toBe(8);
  });

  it("a click with no drag (< 2 points) creates nothing", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerUp(document, { button: 0, clientX: 60, clientY: 80 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("shows the live preview while drawing and clears it on release", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    expect(screen.queryByTestId("pen-preview")).toBeTruthy();
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(screen.queryByTestId("pen-preview")).toBeNull();
  });

  it("Escape mid-draft aborts the stroke (no mark, no preview)", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("pen-preview")).toBeNull();
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("does NOT draw when the pointerdown is not over a page (chrome click)", () => {
    canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    // Target is document.body (no .pdf-canvas ancestor) → no draft starts.
    fireEvent.pointerDown(document.body, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("disarming pen mid-draft aborts the stroke: no mark + preview cleared on release (Codex HIGH)", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />,
    );
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    expect(screen.queryByTestId("pen-preview")).toBeTruthy();
    // Tool switches away (V/Esc in App) → armedTool null mid-draft.
    rerender(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool={null} />);
    expect(screen.queryByTestId("pen-preview")).toBeNull(); // draft aborted, preview gone
    // A late pointerup must NOT persist a stroke after disarm.
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(useAnnotationStore.getState().all().filter((a) => a.type === "pen")).toHaveLength(0);
  });

  it("does not draw with a non-pen tool armed (the gesture is pen-gated)", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    // No pen mark; the highlight create path needs a text selection (none here).
    expect(useAnnotationStore.getState().all().filter((a) => a.type === "pen")).toHaveLength(0);
  });
});

describe("AnnotationInteraction pen selection quick-box (Story 2.8 — AC2,6)", () => {
  function penMark(id: string, color = "annotation-blue", width = 4): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "pen",
      group_id: null,
      anchor: {
        kind: "path",
        page_index: 0,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.2 },
        ],
      },
      style: { color, stroke_width: width, alpha: null },
      body: null,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }

  function setup(mark: Annotation) {
    useAnnotationStore.getState().addAnnotation(mark);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select(mark.id));
  }

  it("a selected pen mark opens the box with the color row, stroke-width row, alpha row + delete (Story 2.13)", async () => {
    const mark: Annotation = { ...penMark("p1", "annotation-green", 8), style: { color: "annotation-green", stroke_width: 8, alpha: 0.6 } };
    setup(mark);
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("color-swatch-annotation-green").getAttribute("aria-checked")).toBe("true");
    // Stroke-width row is present and armed.
    expect(screen.getByTestId("stroke-width-8").className).toContain("stroke-width-step--armed");
    // Alpha row is present and armed to the mark's alpha.
    expect(screen.getByTestId("alpha-0.6").className).toContain("alpha-step--armed");
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
  });

  it("picking a stroke width restrokes the pen mark + updates the default, dismisses the box", async () => {
    setup(penMark("p1", "annotation-blue", 4));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("stroke-width-8"));
    expect(useAnnotationStore.getState().annotations.get("p1")!.style.stroke_width).toBe(8);
    expect(useAnnotationStore.getState().activeStrokeWidth).toBe(8);
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
    expect(useAnnotationStore.getState().selectedId).toBe("p1");
  });

  it("picking a color recolors the pen mark (reuses the recolor seam)", async () => {
    setup(penMark("p1", "annotation-blue", 4));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-pink"));
    expect(useAnnotationStore.getState().annotations.get("p1")!.style.color).toBe("annotation-pink");
  });

  it("picking an alpha re-alphas the pen mark + updates the default + dismisses the box (Story 2.13)", async () => {
    setup(penMark("p1", "annotation-blue", 4));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("alpha-0.6"));
    expect(useAnnotationStore.getState().annotations.get("p1")!.style.alpha).toBe(0.6);
    expect(useAnnotationStore.getState().activeAlpha).toBe(0.6);
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
    expect(useAnnotationStore.getState().selectedId).toBe("p1");
  });

  it("the alpha row is NOT shown for a selected text highlight (isPenSelected guard)", async () => {
    const highlight: Annotation = {
      id: "h1",
      doc_id: "doc-1",
      type: "highlight",
      group_id: null,
      anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: null,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().addAnnotation(highlight);
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("h1"));
    await screen.findByTestId("selection-quick-box");
    expect(screen.queryByRole("group", { name: "Pen opacity" })).toBeNull();
  });

  it("Del deletes the selected pen mark", () => {
    setup(penMark("p1"));
    fireEvent.keyDown(document, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("p1")).toBe(false);
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

describe("AnnotationInteraction memo gesture (Story 2.9 — AC1,2,3,6)", () => {
  /** A .page-surface element (inside a .pdf-canvas) so the memo pointerdown's
   *  closest(".page-surface") check passes. */
  function canvasTarget(): HTMLElement {
    const canvas = document.createElement("div");
    canvas.className = "pdf-canvas";
    const surf = document.createElement("div");
    surf.className = "page-surface";
    canvas.appendChild(surf);
    document.body.appendChild(canvas);
    stubNodes.push(canvas);
    return surf;
  }

  /** A stored memo mark (kind=rect). */
  function memoMark(id: string, body = "", color = "annotation-default"): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "memo",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.4 } },
      style: { color, stroke_width: null, alpha: null },
      body,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }

  it("with memo armed, a click on a page places a type=memo/kind=rect mark with empty body, in the active color, and selects it", async () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("annotation-pink");
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="memo" />);

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 160 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("memo");
    expect(all[0].anchor.kind).toBe("rect");
    expect(all[0].body).toBe("");
    expect(all[0].group_id).toBeNull();
    expect(all[0].style.color).toBe("annotation-pink");
    if (all[0].anchor.kind === "rect") {
      // top-left normalized: (60,160)/(600,800) = (0.1, 0.2)
      expect(all[0].anchor.rect.x0).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.rect.y0).toBeCloseTo(0.2, 5);
      // medium preset 220x88 → 0.3667 x 0.11 added.
      expect(all[0].anchor.rect.x1).toBeCloseTo(0.1 + 220 / 600, 5);
      expect(all[0].anchor.rect.y1).toBeCloseTo(0.2 + 88 / 800, 5);
    }
    // Selected → the memo selection quick-box (color + size + delete).
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("color-swatch-annotation-pink").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("memo-size-trigger")).toBeTruthy();
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
  });

  it("uses the active memo size for the placed box", () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    const large = MEMO_SIZES.find((s) => s.key === "large")!;
    useAnnotationStore.getState().setActiveMemoSize(large);
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="memo" />);
    fireEvent.pointerDown(surf, { button: 0, clientX: 0, clientY: 0 });
    const a = useAnnotationStore.getState().all()[0];
    if (a.anchor.kind === "rect") {
      expect(a.anchor.rect.x1).toBeCloseTo(large.width / 600, 5);
      expect(a.anchor.rect.y1).toBeCloseTo(large.height / 800, 5);
    }
  });

  it("does NOT place a memo when memo is not armed (gesture is memo-gated)", () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="highlight" />);
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 160 });
    expect(useAnnotationStore.getState().all().filter((a) => a.type === "memo")).toHaveLength(0);
  });

  it("does NOT place a memo on a chrome click (not over a page)", () => {
    canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="memo" />);
    fireEvent.pointerDown(document.body, { button: 0, clientX: 60, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("clicking an EXISTING memo while memo is armed does NOT place a second box", () => {
    // Build a page-surface that contains an .annotation-memo (the existing box).
    const surf = canvasTarget();
    const memoEl = document.createElement("textarea");
    memoEl.className = "annotation-memo";
    surf.appendChild(memoEl);
    useAnnotationStore.getState().addAnnotation(memoMark("m1"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="memo" />);
    fireEvent.pointerDown(memoEl, { button: 0, clientX: 60, clientY: 160 });
    // Still just the one memo (no overlapping second box placed on top of it).
    expect(useAnnotationStore.getState().all().filter((a) => a.type === "memo")).toHaveLength(1);
  });

  it("an empty memo is removed when it loses selection (Decision 5)", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "")); // empty body
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    // Deselect (e.g. clicked elsewhere) → the empty placed-but-never-typed box vanishes.
    act(() => useAnnotationStore.getState().clearSelection());
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
  });

  it("a memo WITH text survives deselection", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "a note"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    act(() => useAnnotationStore.getState().clearSelection());
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(true);
  });

  it("a selected memo's quick-box resizes it via the size picker + updates the default, dismisses the box", async () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("memo-size-trigger"));
    const large = MEMO_SIZES.find((s) => s.key === "large")!;
    fireEvent.click(screen.getByTestId("memo-size-large"));
    // The rect regrew to the large preset (normalized against the 600x800 box).
    const m = useAnnotationStore.getState().annotations.get("m1")!;
    if (m.anchor.kind === "rect") {
      expect(m.anchor.rect.x1).toBeCloseTo(m.anchor.rect.x0 + large.width / 600, 5);
      expect(m.anchor.rect.y1).toBeCloseTo(m.anchor.rect.y0 + large.height / 800, 5);
    }
    expect(useAnnotationStore.getState().activeMemoSize).toBe(large);
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
  });

  it("a selected memo's quick-box recolors it (the box accent)", async () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n", "annotation-default"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    expect(useAnnotationStore.getState().annotations.get("m1")!.style.color).toBe("annotation-blue");
  });

  it("the size picker shows the SELECTED memo's own size, not the session default (Codex LOW)", async () => {
    // A memo sized to the SMALL preset (160px on a 600-wide box → frac 0.2667).
    const smallMemo: Annotation = {
      ...memoMark("m1"),
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.1 + 160 / 600, y1: 0.3 } },
    };
    useAnnotationStore.getState().addAnnotation(smallMemo);
    // Session default is LARGE — the picker must still show SMALL armed for this memo.
    useAnnotationStore.getState().setActiveMemoSize(MEMO_SIZES.find((s) => s.key === "large")!);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("memo-size-trigger"));
    expect(screen.getByTestId("memo-size-small").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("memo-size-large").getAttribute("aria-checked")).toBe("false");
  });

  it("Del deletes the selected memo", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    fireEvent.keyDown(document, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
  });
});

describe("AnnotationInteraction comment gestures (Story 2.10 — AC1,3,6)", () => {
  /** A .page-surface element so the comment CLICK pointerup's closest checks pass. */
  function canvasTarget(): HTMLElement {
    const canvas = document.createElement("div");
    canvas.className = "pdf-canvas";
    const surf = document.createElement("div");
    surf.className = "page-surface";
    canvas.appendChild(surf);
    document.body.appendChild(canvas);
    stubNodes.push(canvas);
    return surf;
  }

  it("comment DRAG (text selection) lands a type=comment/kind=text mark with body='' and selects it", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("annotation-purple");
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} armedTool="comment" />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("comment");
    expect(all[0].anchor.kind).toBe("text");
    expect(all[0].body).toBe("");
    expect(all[0].style.color).toBe("annotation-purple");
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    // A comment shows the bubble (rendered by AnnotationLayer), NEVER the generic
    // selection quick-box (Decision 4).
    await waitFor(() => expect(useAnnotationStore.getState().all()).toHaveLength(1));
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
  });

  it("comment CLICK (no selection) on a page surface drops a type=comment/kind=rect pin via buildCommentPin and selects it", () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("annotation-blue");
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="comment" />);

    // A real click: pointerdown then pointerup at (near) the same point.
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 160 });
    fireEvent.pointerUp(surf, { button: 0, clientX: 60, clientY: 160 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("comment");
    expect(all[0].anchor.kind).toBe("rect");
    expect(all[0].body).toBe("");
    expect(all[0].style.color).toBe("annotation-blue");
    if (all[0].anchor.kind === "rect") {
      // top-left normalized: (60,160)/(600,800) = (0.1, 0.2); a point rect.
      expect(all[0].anchor.rect.x0).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.rect.y0).toBeCloseTo(0.2, 5);
      expect(all[0].anchor.rect.x1).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.rect.y1).toBeCloseTo(0.2, 5);
    }
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
  });

  it("comment CLICK over the quick-box or an existing pin does NOT drop a second pin", () => {
    const surf = canvasTarget();
    // An existing pin inside the page surface (the kind the click must NOT stack on).
    const pin = document.createElement("button");
    pin.className = "annotation-comment-pin";
    surf.appendChild(pin);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="comment" />);
    fireEvent.pointerDown(pin, { button: 0, clientX: 60, clientY: 160 });
    fireEvent.pointerUp(pin, { button: 0, clientX: 60, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("a FAILED drag (release far from pointerdown, empty selection) does NOT drop a pin (Codex MED)", () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="comment" />);
    // Down at one point, release 40px away with no selection → a drag, not a click.
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 160 });
    fireEvent.pointerUp(surf, { button: 0, clientX: 60, clientY: 200 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("a release with NO preceding valid pointerdown does NOT drop a pin", () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="comment" />);
    // pointerup alone (no candidate recorded) must not place a pin.
    fireEvent.pointerUp(surf, { button: 0, clientX: 60, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("a non-comment armed tool does NOT drop a pin on an empty click", () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="underline" />);
    fireEvent.pointerUp(surf, { button: 0, clientX: 60, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("an empty comment is KEPT on deselect (Decision 5 - NOT the memo cleanup)", () => {
    const comment: Annotation = {
      id: "c1",
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.1, y1: 0.2 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: "",
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
    useAnnotationStore.getState().addAnnotation(comment);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("c1"));
    act(() => useAnnotationStore.getState().clearSelection());
    // The empty comment survives (unlike an empty memo).
    expect(useAnnotationStore.getState().annotations.has("c1")).toBe(true);
  });
});

describe("AnnotationInteraction box-select gesture (Story 2.11 — AC1,2,5,6)", () => {
  function pageSurface(): HTMLElement {
    const canvas = document.createElement("div");
    canvas.className = "pdf-canvas";
    const surf = document.createElement("div");
    surf.className = "page-surface";
    canvas.appendChild(surf);
    document.body.appendChild(canvas);
    stubNodes.push(canvas);
    return surf;
  }

  it("a box drag with boxActive=true creates a region highlight with kind=rect, canonical rect, selected, opens the selection quick-box", async () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("annotation-green");
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxActive rectReader={reader} />,
    );

    // Drag 60px down-right (above threshold).
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("highlight");
    expect(all[0].anchor.kind).toBe("rect");
    expect(all[0].group_id).toBeNull();
    expect(all[0].style.color).toBe("annotation-green");
    expect(all[0].style.stroke_width).toBeNull();
    expect(all[0].body).toBeNull();
    if (all[0].anchor.kind === "rect") {
      // card at top=0, page box 600x800, scale 1.
      // x0=60/600=0.1, y0=80/800=0.1, x1=120/600=0.2, y1=160/800=0.2
      expect(all[0].anchor.rect.x0).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.rect.y0).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.rect.x1).toBeCloseTo(0.2, 5);
      expect(all[0].anchor.rect.y1).toBeCloseTo(0.2, 5);
    }
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    // No region tool-type picker any more (box-comment removed): the region lands as
    // a highlight and the 2.5 selection quick-box (recolor + delete) takes over.
    expect(screen.queryByTestId("region-quick-box")).toBeNull();
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
  });

  it("a box drag canonicalizes the rect when dragged up-left (x0>x1, y0>y1)", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxActive rectReader={reader} />);

    // Down at bottom-right, up at top-left.
    fireEvent.pointerDown(surf, { button: 0, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(document, { clientX: 60, clientY: 80 });
    fireEvent.pointerUp(document, { button: 0, clientX: 60, clientY: 80 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    if (all[0].anchor.kind === "rect") {
      // Canonical: x0 <= x1, y0 <= y1.
      expect(all[0].anchor.rect.x0).toBeLessThan(all[0].anchor.rect.x1);
      expect(all[0].anchor.rect.y0).toBeLessThan(all[0].anchor.rect.y1);
    }
  });

  it("a below-threshold drag creates no mark (stray click guard)", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxActive rectReader={reader} />);

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    // Travel only 4px — below BOX_DRAG_THRESHOLD (8px).
    fireEvent.pointerMove(document, { clientX: 64, clientY: 80 });
    fireEvent.pointerUp(document, { button: 0, clientX: 64, clientY: 80 });

    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("pointerdown on an existing mark does NOT start a box drag (click-selects instead)", () => {
    const surf = pageSurface();
    // Place an existing mark element.
    const existingMark = document.createElement("div");
    existingMark.className = "annotation-highlight";
    surf.appendChild(existingMark);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxActive rectReader={reader} />);

    fireEvent.pointerDown(existingMark, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 200 });

    // No new region created — click on existing mark selects it, not box-draws.
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("pointerdown on .quick-box does NOT start a box drag", () => {
    const surf = pageSurface();
    const qb = document.createElement("div");
    qb.className = "quick-box";
    surf.appendChild(qb);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxActive rectReader={reader} />);

    fireEvent.pointerDown(qb, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 200 });

    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("box drag does NOT create a region when boxActive=false", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    // boxActive not set (defaults false)
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 200 });

    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("a stored region highlight is click-selectable and opens the 2.5 selection quick-box (recolor+delete)", async () => {
    const region: Annotation = {
      id: "rg1",
      doc_id: "doc-1",
      type: "highlight",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: null,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
    useAnnotationStore.getState().addAnnotation(region);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxActive rectReader={reader} />);

    // Select AFTER mount so the docId-clearSelection effect on mount doesn't clear it.
    act(() => useAnnotationStore.getState().select("rg1"));

    // Simulate pointerdown on a .annotation-highlight element (like the fill div).
    const fill = document.createElement("div");
    fill.className = "annotation-highlight annotation-region";
    document.body.appendChild(fill);
    stubNodes.push(fill);
    fireEvent.pointerDown(fill, { button: 0, clientX: 60, clientY: 160 });

    // The selection quick-box must open (no region picker for pre-existing mark).
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
  });
});
