import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import AnnotationInteraction from "./AnnotationInteraction";
import { useAnnotationStore, DEFAULT_MEMO_SIZE, MEMO_SIZES } from "@/store";
import type { PageCardRef, PageBox } from "@/anchor";
import type { Annotation } from "@/api/client";
import { HOVER_CLOSE_DELAY_MS } from "./CommentPreview";

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
    multiSelectedIds: [],
    hoveredId: null,
    hidden: false,
    groupDragPreview: null,
    activeColors: {
      highlight: "annotation-default",
      underline: "annotation-default",
      pen: "annotation-default",
      memo: "annotation-default",
      comment: "annotation-default",
    },
    activeStrokeWidth: 8,
    activeAlpha: { pen: 0.4, memo: 0.4 },
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

  it("right-click on a page pops a Comment+Memo picker (no highlight/underline)", async () => {
    const card = fakeCard(0, 0);
    const surface = setupPageSurface(card);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [card]} scale={1} enabled rectReader={reader} />);

    // Fire contextmenu against the surface (so .closest('.page-surface') matches).
    fireEvent.contextMenu(surface, { clientX: 100, clientY: 100 });

    await screen.findByTestId("quick-box");
    expect(screen.getByTestId("quick-box-comment")).toBeTruthy();
    expect(screen.getByTestId("quick-box-memo")).toBeTruthy();
    expect(screen.queryByTestId("quick-box-highlight")).toBeNull();
    expect(screen.queryByTestId("quick-box-underline")).toBeNull();
    surface.remove();
  });

  it("right-click suppresses the native context menu (preventDefault)", () => {
    const card = fakeCard(0, 0);
    const surface = setupPageSurface(card);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [card]} scale={1} enabled rectReader={reader} />);

    // fireEvent returns false when a handler called preventDefault.
    const notPrevented = fireEvent.contextMenu(surface, { clientX: 100, clientY: 100 });
    expect(notPrevented).toBe(false);
    surface.remove();
  });

  it("right-click: picking Comment creates a comment pin at the click point", async () => {
    const card = fakeCard(0, 0);
    const surface = setupPageSurface(card);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [card]} scale={1} enabled rectReader={reader} />);

    // clientX=120, clientY=200 → card-local x0=120, y0=200 → normalized x0=120/600, y0=200/800
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 200 });
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

  it("right-click: picking Memo creates a memo at the click point", async () => {
    const card = fakeCard(0, 0);
    const surface = setupPageSurface(card);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [card]} scale={1} enabled rectReader={reader} />);

    // clientX=60, clientY=160 → card-local x0=60, y0=160
    fireEvent.contextMenu(surface, { clientX: 60, clientY: 160 });
    fireEvent.click(await screen.findByTestId("quick-box-memo"));

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("memo");
    expect(all[0].anchor.kind).toBe("rect");
    if (all[0].anchor.kind === "rect") {
      expect(all[0].anchor.rect.x0).toBeCloseTo(60 / 600, 5);
      expect(all[0].anchor.rect.y0).toBeCloseTo(160 / 800, 5);
      // default square 90x90 (Story 3.1 seed default, 20% smaller per user fix request).
      expect(all[0].anchor.rect.x1).toBeCloseTo((60 + 90) / 600, 5);
      expect(all[0].anchor.rect.y1).toBeCloseTo((160 + 90) / 800, 5);
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

  it("consumes its own Escape in the capture phase, before a bubble-phase document listener observes it (Story 5.6, rung 1a)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");

    // App's own `Escape -> cursor` fallback is a bubble-phase document
    // listener (registered well before this effect re-runs on the `pending`
    // flip). A bubble spy here stands in for it: if the pending quick-box's
    // capture-phase handler correctly calls stopImmediatePropagation, the
    // spy must never observe the press.
    const bubbleSpy = vi.fn();
    document.addEventListener("keydown", bubbleSpy);
    try {
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("quick-box")).toBeNull());
      expect(bubbleSpy).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", bubbleSpy);
    }
  });

  it("leaves the native selection alive on present, so Ctrl+C still copies the dragged text (bug fix: the preview highlight is a separate overlay, not a stand-in that requires clearing it)", async () => {
    const { removeAllRanges } = stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it("renders a preview highlight standing in for the (now-cleared) native selection", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");
    expect(screen.getByTestId("pending-selection-preview")).toBeTruthy();
  });

  it("re-derives (does NOT dismiss) the quick-box position on scroll — it now tracks the selection instead of disappearing (Story 4.x fix)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    let cardTop = 0;
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ left: 0, top: cardTop, right: 600, bottom: cardTop + 800, width: 600, height: 800, x: 0, y: cardTop }) as DOMRect;
    const pages: PageCardRef[] = [{ pageIndex: 0, cardEl: el, box }];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    const quickBox = await screen.findByTestId("quick-box");
    const initialTop = quickBox.style.top;

    // Simulate the canvas scrolling 200px: the card's LIVE rect moves.
    cardTop = -200;
    fireEvent.scroll(document, {});

    // Still open (not dismissed) AND its position followed the card.
    expect(screen.queryByTestId("quick-box")).not.toBeNull();
    await waitFor(() => expect(quickBox.style.top).not.toBe(initialTop));
  });

  it("re-derives the quick-box position and preview on a zoom (scale change), instead of going stale", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />,
    );
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    const quickBox = await screen.findByTestId("quick-box");
    const initialTop = quickBox.style.top;

    // Zoom: scale doubles. The stored (scale-independent) selection rects
    // denormalize to different card-local pixels, so the box must move.
    rerender(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={2} enabled rectReader={reader} />);

    await waitFor(() => expect(quickBox.style.top).not.toBe(initialTop));
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

  it("Story 2.6: a drag-release lands the mark in the ACTIVE color (create reads activeColors, not a hardcode)", async () => {
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("highlight", "annotation-blue");
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

  it("picking a swatch recolors the just-landed highlight and KEEPS the box open (user fix request; selection stays)", async () => {
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
    // A color pick no longer dismisses the box (matches restroke/realpha, which
    // already kept it open) — the mark stays selected AND the box stays visible.
    expect(screen.getByTestId("selection-quick-box")).toBeTruthy();
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
    useAnnotationStore.getState().setActiveColor("underline", "annotation-green");
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

  it("with pen armed, a pointer drag stores ONE kind=path mark and does NOT auto-select it", async () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("pen", "annotation-blue");
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
    expect(all[0].style.stroke_width).toBe(8); // the default activeStrokeWidth (medium)
    if (all[0].anchor.kind === "path") {
      expect(all[0].anchor.points.length).toBe(3);
      // normalized: (60,80)/(600,800) = (0.1, 0.1)
      expect(all[0].anchor.points[0].x).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.points[0].y).toBeCloseTo(0.1, 5);
    }
    // Pen does NOT auto-select on release (user fix 2026-06-30): drawing is a
    // repeated gesture, so the stroke lands unselected and the selection quick-box
    // does NOT pop — the user can draw the next stroke uninterrupted. (Clicking the
    // stroke later selects it; that path is covered by the pen selection-box tests.)
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
  });

  it("clears a stale hover when the pen is disarmed (no hover ring left after draw mode)", () => {
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />,
    );
    // Drawing over a mark sets hoveredId (the visual is CSS-suppressed while pen
    // armed); disarming must clear the state so no ring shows once draw mode ends.
    act(() => useAnnotationStore.getState().setHovered("some-mark"));
    rerender(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool={null} />);
    expect(useAnnotationStore.getState().hoveredId).toBeNull();
  });

  it("suppresses the click after a stroke is drawn, so a scribble on a mark can't also select it", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(1); // a stroke landed
    // The trailing click (a scribble that ended on a mark would synthesize one) is
    // swallowed: capture-phase preventDefault → dispatchEvent returns false.
    const dispatched = canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dispatched).toBe(false);
  });

  it("does NOT suppress the click when no stroke was drawn (a plain click still selects an idle stroke)", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    // Click with no drag: < 2 points → no stroke, so the click must pass through to
    // the mark's own onClick (the click-to-select-idle-stroke path, fix 2).
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerUp(document, { button: 0, clientX: 60, clientY: 80 });
    const dispatched = canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dispatched).toBe(true);
  });

  it("uses the active stroke width for a new stroke", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveStrokeWidth(16); // override the default (8) to prove it is read
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(useAnnotationStore.getState().all()[0].style.stroke_width).toBe(16);
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

  it("hiding mid-draft aborts the stroke: no stray mark on a later pointerup after un-hiding (Story 5.5, Codex)", () => {
    const canvas = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="pen" />);
    fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    expect(screen.queryByTestId("pen-preview")).toBeTruthy();
    // Hiding tears down the gesture's document listeners mid-draft, same as any
    // other disable path (armedTool clearing, doc switch): the draft must be
    // aborted right then, not left stranded for the next enable to pick up.
    act(() => useAnnotationStore.getState().setHidden(true));
    act(() => useAnnotationStore.getState().setHidden(false));
    // A pointerup arriving after re-show (the physical mouseup that happened while
    // no listener was bound, or any later unrelated release) must NOT resume and
    // commit the old draft as a stroke.
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
    // Thickness picker present; expand it to see the armed step.
    fireEvent.click(screen.getByTestId("stroke-width-trigger"));
    expect(screen.getByTestId("stroke-width-8").className).toContain("stroke-width-step--armed");
    // Opacity picker present; expand it to see the armed step (the mark's alpha).
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    expect(screen.getByTestId("alpha-0.6").className).toContain("alpha-step--armed");
    expect(screen.getByTestId("quick-box-delete")).toBeTruthy();
  });

  it("picking a stroke width restrokes the pen mark + updates the default, KEEPS the box open", async () => {
    setup(penMark("p1", "annotation-blue", 4));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("stroke-width-trigger"));
    fireEvent.click(screen.getByTestId("stroke-width-8"));
    expect(useAnnotationStore.getState().annotations.get("p1")!.style.stroke_width).toBe(8);
    expect(useAnnotationStore.getState().activeStrokeWidth).toBe(8);
    // The quick-box stays open (only the inner step menu collapses); the mark stays selected.
    expect(screen.getByTestId("selection-quick-box")).toBeTruthy();
    expect(screen.queryByTestId("stroke-width-8")).toBeNull();
    expect(useAnnotationStore.getState().selectedId).toBe("p1");
  });

  it("picking a color recolors the pen mark (reuses the recolor seam)", async () => {
    setup(penMark("p1", "annotation-blue", 4));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-pink"));
    expect(useAnnotationStore.getState().annotations.get("p1")!.style.color).toBe("annotation-pink");
  });

  it("picking an alpha re-alphas the pen mark + updates the PEN default (per-tool), KEEPS the box open (Story 2.13)", async () => {
    setup(penMark("p1", "annotation-blue", 4));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    fireEvent.click(screen.getByTestId("alpha-0.6"));
    expect(useAnnotationStore.getState().annotations.get("p1")!.style.alpha).toBe(0.6);
    expect(useAnnotationStore.getState().activeAlpha.pen).toBe(0.6);
    // The memo default is untouched (per-tool split, fix request).
    expect(useAnnotationStore.getState().activeAlpha.memo).toBe(0.4);
    // The quick-box stays open (only the inner step menu collapses); the mark stays selected.
    expect(screen.getByTestId("selection-quick-box")).toBeTruthy();
    expect(screen.queryByTestId("alpha-0.6")).toBeNull();
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

  it("picking a swatch recolors the selected mark and KEEPS the box open (user fix request); the selection stays", async () => {
    setup([textMark("m1", "annotation-default")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-pink"));
    expect(useAnnotationStore.getState().annotations.get("m1")!.style.color).toBe("annotation-pink");
    // A color pick no longer dismisses the box — the mark stays selected AND the
    // box stays visible, matching restroke/realpha's existing behavior.
    expect(screen.getByTestId("selection-quick-box")).toBeTruthy();
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
  });

  it("Story 2.6 req3: recoloring an existing mark also updates the active/default color (remember last choice)", async () => {
    setup([textMark("m1", "annotation-default")], "m1");
    await screen.findByTestId("selection-quick-box");
    expect(useAnnotationStore.getState().activeColors.highlight).toBe("annotation-default");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-purple"));
    // Editing a highlight's color carries into the session default for new HIGHLIGHT
    // marks only (per-tool split — recoloring a highlight must not touch pen/memo/etc).
    expect(useAnnotationStore.getState().activeColors.highlight).toBe("annotation-purple");
    expect(useAnnotationStore.getState().activeColors.pen).toBe("annotation-default");
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

  it("Del deletes when focus is on a button INSIDE the quick-box (post-create auto-focus)", async () => {
    // After a create, selection auto-focuses the box's first swatch BUTTON. Del must
    // still delete — a button is exempt for its own activation keys, not Delete.
    setup([textMark("m1")], "m1");
    const box = await screen.findByTestId("selection-quick-box");
    const focused = document.activeElement as HTMLElement;
    expect(box.contains(focused)).toBe(true);
    expect(focused.tagName).toBe("BUTTON");
    fireEvent.keyDown(focused, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("Backspace does NOT delete the selected mark (Del-only, Story 3.3)", () => {
    setup([textMark("m1")], "m1");
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(true);
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

  it("scroll (incl. zoom recenter) re-anchors the box to the mark's LIVE screen point instead of closing it (bug fix: closing on scroll self-closed a Bank-jump-opened box on its own smooth scroll)", async () => {
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().addAnnotation(textMark("m1"));
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    const box = await screen.findByTestId("selection-quick-box");
    const topBefore = box.style.top;

    // Simulate the canvas having scrolled: the card's live screen position
    // moves (mirrors what a real `getBoundingClientRect()` would report after
    // a scroll), THEN fire the scroll event the component listens for.
    pages[0].cardEl.getBoundingClientRect = () =>
      ({ left: 0, top: -500, right: 600, bottom: 300, width: 600, height: 800, x: 0, y: -500 }) as DOMRect;
    fireEvent.scroll(document, {});

    // The box stays open (repositioned, not dismissed)...
    expect(screen.queryByTestId("selection-quick-box")).not.toBeNull();
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
    // ...AND its position actually follows the card's new screen point (not
    // frozen at the pre-scroll value) — this is what "re-anchors" means; a
    // test that only checks the box is still mounted would pass even if the
    // reposition math silently no-op'd.
    expect(box.style.top).not.toBe(topBefore);
  });

  it("selecting a second non-memo mark on ANOTHER page (e.g. a Bank jump) re-anchors the box to the NEW mark, not a stale one (Codex review finding: a useCallback memoized only on isMemoSelected froze the box on whichever mark was selected when isMemoSelected last actually changed)", async () => {
    const pageA = fakeCard(0, 0);
    const pageB = fakeCard(1, 5000);
    const m1 = textMark("m1"); // page_index 0 (fakeCard top=0)
    const m2 = textMark("m2");
    m2.anchor = { kind: "text", page_index: 1, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "y" };
    useAnnotationStore.getState().addAnnotation(m1);
    useAnnotationStore.getState().addAnnotation(m2);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [pageA, pageB]} scale={1} enabled rectReader={reader} />);

    act(() => useAnnotationStore.getState().select("m1"));
    const box = await screen.findByTestId("selection-quick-box");
    const topOnPageA = parseFloat(box.style.top);
    expect(topOnPageA).toBeLessThan(500); // anchored near pageA's cardEl top (0)

    // A second, DIFFERENT non-memo mark on another page — the exact sequence
    // `handleBankJump` produces (`select(item.id)` twice in a row, never
    // passing through a memo selection in between, so `isMemoSelected` never
    // flips and a `useCallback` memoized only on it would stay frozen).
    act(() => useAnnotationStore.getState().select("m2"));
    await waitFor(() => expect(parseFloat(box.style.top)).not.toBe(topOnPageA));
    const topOnPageB = parseFloat(box.style.top);
    // pageB's cardEl top (5000) is far below the viewport, so `clampToViewport`
    // pins the box near the viewport's bottom edge rather than the raw 5000 —
    // the property that matters is that it moved WAY down from pageA's
    // near-top position, not a specific pixel value.
    expect(topOnPageB).toBeGreaterThan(topOnPageA + 300);
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

describe("AnnotationInteraction convert highlight to comment (Story 3.7 — AC1)", () => {
  /** Render the interaction layer with one page card and select a stored mark. */
  function setup(marks: Annotation[], selectId: string) {
    marks.forEach((m) => useAnnotationStore.getState().addAnnotation(m));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select(selectId));
  }

  it("shows 'Turn into comment' for a selected text highlight", async () => {
    setup([textMark("m1")], "m1");
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("quick-box-convert-comment")).toBeTruthy();
  });

  it("is gated off for an underline mark (scope OUT)", async () => {
    const underline = textMark("m1");
    underline.type = "underline";
    setup([underline], "m1");
    await screen.findByTestId("selection-quick-box");
    expect(screen.queryByTestId("quick-box-convert-comment")).toBeNull();
  });

  it("is gated off for a region (kind=rect) highlight (scope OUT — reverse revert is text-only)", async () => {
    const region = textMark("m1");
    region.anchor = { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 } };
    setup([region], "m1");
    await screen.findByTestId("selection-quick-box");
    expect(screen.queryByTestId("quick-box-convert-comment")).toBeNull();
  });

  it("clicking it flips the mark to type=comment/body='' via the command path, keeps the selection", async () => {
    setup([textMark("m1")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("quick-box-convert-comment"));
    const m1 = useAnnotationStore.getState().annotations.get("m1")!;
    expect(m1.type).toBe("comment");
    expect(m1.body).toBe("");
    // Selection is kept (not cleared) so the comment's bubble opens for it.
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
    // The generic quick-box gates off once the descriptor routes to the bubble.
    await waitFor(() => expect(screen.queryByTestId("selection-quick-box")).toBeNull());
  });

  it("converts a two-page group together (both siblings flip in one call)", async () => {
    setup([textMark("m1", "annotation-default", "g1"), textMark("m2", "annotation-default", "g1")], "m1");
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("quick-box-convert-comment"));
    const map = useAnnotationStore.getState().annotations;
    expect(map.get("m1")!.type).toBe("comment");
    expect(map.get("m2")!.type).toBe("comment");
  });

  it("reverse convert reopens the generic quick-box even if a scroll closed it while the bubble was open (code review finding)", async () => {
    const comment: Annotation = { ...textMark("m1"), type: "comment", body: "" };
    setup([comment], "m1");
    // A scroll while the comment (bubble-routed) is selected closes selectionBoxOpen.
    // Harmless for a comment (its bubble doesn't gate on that flag) but must not
    // suppress the generic box once the store flips the mark back to a highlight.
    fireEvent.scroll(document, {});
    act(() => useAnnotationStore.getState().retypeAnnotation(["m1"], "highlight", null, "2026-06-29T12:00:00Z"));
    await screen.findByTestId("selection-quick-box");
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
    useAnnotationStore.getState().setActiveColor("memo", "annotation-pink");
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
      // default square 90x90 (Story 3.1 seed default, 20% smaller per user fix request) → 90/600 x, 90/800 y.
      expect(all[0].anchor.rect.x1).toBeCloseTo(0.1 + 90 / 600, 5);
      expect(all[0].anchor.rect.y1).toBeCloseTo(0.2 + 90 / 800, 5);
    }
    // Selected → the memo selection quick-box (color + delete; no size picker since 3.1).
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    await screen.findByTestId("selection-quick-box");
    expect(screen.getByTestId("color-swatch-annotation-pink").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("memo-size-trigger")).toBeNull();
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

  it("clicking empty space blurs a focused memo textarea (deselect behaves like Esc)", () => {
    const surf = canvasTarget();
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "note"));
    // AnnotationInteraction doesn't render the layer, so stand in a focused memo
    // textarea to represent the selected+focused memo.
    const ta = document.createElement("textarea");
    ta.className = "annotation-memo";
    surf.appendChild(ta);
    render(<AnnotationInteraction docId="doc-1" getPages={() => [fakeCard(0, 0)]} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    ta.focus();
    expect(document.activeElement).toBe(ta);
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 400 });
    // Selection cleared AND the textarea blurred — so its :focus-visible ring can't
    // persist and look selected (the user-reported black-border-after-deselect bug).
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    expect(document.activeElement).not.toBe(ta);
  });

  it("with a memo selected, an empty-space click DESELECTS it instead of placing a new memo (user fix)", () => {
    const surf = canvasTarget();
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "a note")); // non-empty so it survives deselect
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="memo" rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    // Click empty page space while a memo is selected (memo still armed).
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 160 });
    // No second memo placed; the selection cleared (first click deselects).
    expect(useAnnotationStore.getState().all().filter((a) => a.type === "memo")).toHaveLength(1);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
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

  // Story 3.1 removed the preset size picker from the memo selection quick-box (a
  // memo now resizes via the edit frame's corner handles); the old "resize via size
  // picker" + "picker shows the memo's own size" tests are dropped with it.

  it("a selected memo's quick-box recolors it (the box accent)", async () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n", "annotation-default"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    expect(useAnnotationStore.getState().annotations.get("m1")!.style.color).toBe("annotation-blue");
  });

  it("a selected memo's quick-box re-alphas it + updates the MEMO default (per-tool, fix request), KEEPS the box open", async () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n", "annotation-default"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    await screen.findByTestId("selection-quick-box");
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    fireEvent.click(screen.getByTestId("alpha-0.6"));
    expect(useAnnotationStore.getState().annotations.get("m1")!.style.alpha).toBe(0.6);
    expect(useAnnotationStore.getState().activeAlpha.memo).toBe(0.6);
    // The pen default is untouched (per-tool split).
    expect(useAnnotationStore.getState().activeAlpha.pen).toBe(0.4);
    expect(screen.getByTestId("selection-quick-box")).toBeTruthy();
  });

  it("a selected memo's quick-box is the VERTICAL variant (user fix request: horizontal-below covered the collapse toggle); a highlight's is not", async () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n", "annotation-default"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    const box = await screen.findByTestId("selection-quick-box");
    expect(box.className).toContain("quick-box--vertical");

    act(() => useAnnotationStore.getState().clearSelection());
    useAnnotationStore.getState().addAnnotation(textMark("h1", "annotation-default"));
    act(() => useAnnotationStore.getState().select("h1"));
    const box2 = await screen.findByTestId("selection-quick-box");
    expect(box2.className).not.toContain("quick-box--vertical");
  });

  it("Del deletes the selected memo", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    fireEvent.keyDown(document, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
  });

  it("Del deletes the selected memo even while its OWN textarea has focus (user bug: typing in the memo blocked Del)", () => {
    const surf = canvasTarget();
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n"));
    // AnnotationInteraction doesn't render the layer; stand in the real MemoBox
    // structure (outer box data-testid="annotation-mark-*" wrapping an inner
    // data-testid="memo-body-*" textarea, memo collapse/expand restructure) so
    // the fix's exact-testid match can be exercised.
    const box = document.createElement("div");
    box.className = "annotation-memo";
    box.setAttribute("data-testid", "annotation-mark-m1");
    const ta = document.createElement("textarea");
    ta.setAttribute("data-testid", "memo-body-m1");
    box.appendChild(ta);
    surf.appendChild(box);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    ta.focus();
    expect(document.activeElement).toBe(ta);
    fireEvent.keyDown(ta, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
  });

  it("Del on a DIFFERENT unrelated textarea still does NOT delete the selected memo (bypass stays scoped)", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", "n"));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    act(() => useAnnotationStore.getState().select("m1"));
    const other = document.createElement("textarea");
    document.body.appendChild(other);
    fireEvent.keyDown(other, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(true);
    other.remove();
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
    useAnnotationStore.getState().setActiveColor("comment", "annotation-purple");
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
    // A comment shows the bubble (rendered here, not the generic selection
    // quick-box — Decision 4). See the "comment overlay" describe block below
    // for the bubble's own tests.
    await waitFor(() => expect(useAnnotationStore.getState().all()).toHaveLength(1));
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
  });

  it("comment CLICK (no selection) on a page surface drops a type=comment/kind=rect pin via buildCommentPin and selects it", () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("comment", "annotation-blue");
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

  it("with a comment selected, an empty-space click DESELECTS it instead of dropping a new pin (user fix)", () => {
    const surf = canvasTarget();
    const comment: Annotation = {
      id: "c1",
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.05, y0: 0.05, x1: 0.05, y1: 0.05 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: "existing note",
      created_at: "2026-06-29T00:00:01Z",
      updated_at: "2026-06-29T00:00:01Z",
    };
    useAnnotationStore.getState().addAnnotation(comment);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled armedTool="comment" rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().select("c1"));
    // Click empty page space while the comment tool is still armed and a comment
    // is selected: a real click (pointerdown then pointerup at the same point).
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 160 });
    fireEvent.pointerUp(surf, { button: 0, clientX: 60, clientY: 160 });
    // No second pin dropped; the selection cleared (first click deselects, the
    // memo-placement fix's sibling — a second, fresh click would create one).
    expect(useAnnotationStore.getState().all().filter((a) => a.type === "comment")).toHaveLength(1);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
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

describe("AnnotationInteraction comment overlay — bubble + hover preview (Story 2.10, relocated from AnnotationLayer as a page-edge-clipping bug fix, 2026-07-03)", () => {
  /** A kind=text comment (drag) on page 0. */
  function textComment(id: string, body = "", color = "annotation-default", groupId: string | null = null): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "comment",
      group_id: groupId,
      anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" },
      style: { color, stroke_width: null, alpha: null },
      body,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }
  /** A kind=rect comment (click) on page 0 — a point anchor. */
  function rectComment(id: string, body = "", color = "annotation-default", groupId: string | null = null): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "comment",
      group_id: groupId,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.3, x1: 0.2, y1: 0.3 } },
      style: { color, stroke_width: null, alpha: null },
      body,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }

  /** Render the interaction layer with one page card. */
  function setup() {
    const pages = [fakeCard(0, 0)];
    return render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
  }

  it("selecting a comment (via the store, mirroring the pin's own onClick) renders the bubble with value=body", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c3", "a note"));
    setup();
    act(() => useAnnotationStore.getState().select("c3"));
    const body = screen.getByTestId("comment-body-c3") as HTMLTextAreaElement;
    expect(body.tagName.toLowerCase()).toBe("textarea");
    expect(body.value).toBe("a note");
  });

  it("typing in the bubble writes body through retextAnnotations; recolor + delete fire", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c4", "", "annotation-default"));
    setup();
    act(() => useAnnotationStore.getState().select("c4"));
    fireEvent.change(screen.getByTestId("comment-body-c4"), { target: { value: "typed" } });
    expect(useAnnotationStore.getState().annotations.get("c4")!.body).toBe("typed");
    // Recolor tints the comment (fill + pin) AND sets the default (last-choice-wins).
    fireEvent.click(screen.getByTestId("color-swatch-annotation-green"));
    expect(useAnnotationStore.getState().annotations.get("c4")!.style.color).toBe("annotation-green");
    // Comment recolor sets ONLY the comment tool's default (per-tool split).
    expect(useAnnotationStore.getState().activeColors.comment).toBe("annotation-green");
    expect(useAnnotationStore.getState().activeColors.highlight).toBe("annotation-default");
    // Delete removes the comment.
    fireEvent.click(screen.getByTestId("comment-delete-c4"));
    expect(useAnnotationStore.getState().annotations.has("c4")).toBe(false);
  });

  it("the open bubble live-tracks an in-flight drag preview of its rect-kind pin (Story 3.1)", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c9"));
    setup();
    act(() => useAnnotationStore.getState().select("c9"));
    // Committed anchor: x0=0.2,y0=0.3 → left=120, top=240 (box 600x800, scale 1).
    expect(screen.getByTestId("comment-bubble-c9").style.left).toBe("120px");
    act(() =>
      useAnnotationStore.getState().setDragPreview({
        id: "c9",
        anchor: { kind: "rect", page_index: 0, rect: { x0: 0.4, y0: 0.5, x1: 0.4, y1: 0.5 } },
      }),
    );
    // Preview anchor: x0=0.4,y0=0.5 → left=240, top=400.
    expect(screen.getByTestId("comment-bubble-c9").style.left).toBe("240px");
  });

  it("does not render a bubble for a comment with no rects/geometry (guard, would crash denormalizeRect otherwise)", () => {
    const empty = textComment("c-empty");
    empty.anchor = { kind: "text", page_index: 0, rects: [], text: "x" };
    useAnnotationStore.getState().addAnnotation(empty);
    setup();
    act(() => useAnnotationStore.getState().select("c-empty"));
    expect(screen.queryByTestId("comment-body-c-empty")).toBeNull();
    expect(useAnnotationStore.getState().selectedId).toBe("c-empty");
  });

  it("editing a grouped (two-page) comment writes the body to ALL siblings (Codex HIGH)", () => {
    // Two comment slices sharing a group_id (both resolve to page 0 in the test).
    const c1 = textComment("c1", "", "annotation-default", "g1");
    const c2 = textComment("c2", "", "annotation-default", "g1");
    useAnnotationStore.getState().addAnnotation(c1);
    useAnnotationStore.getState().addAnnotation(c2);
    setup();
    act(() => useAnnotationStore.getState().select("c1"));
    fireEvent.change(screen.getByTestId("comment-body-c1"), { target: { value: "shared" } });
    // BOTH siblings carry the note, so reopening the other page's pin shows it.
    expect(useAnnotationStore.getState().annotations.get("c1")!.body).toBe("shared");
    expect(useAnnotationStore.getState().annotations.get("c2")!.body).toBe("shared");
  });

  it("the bubble's swatch row is labelled 'Comment color' (Codex LOW)", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c7"));
    const { container } = setup();
    act(() => useAnnotationStore.getState().select("c7"));
    const row = container.querySelector('.comment-bubble [role="group"]');
    expect(row!.getAttribute("aria-label")).toBe("Comment color");
  });

  it("Esc on the bubble container (e.g. a focused swatch) dismisses the comment (Codex MED)", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c8", "note"));
    setup();
    act(() => useAnnotationStore.getState().select("c8"));
    // Esc raised from a swatch button inside the bubble (not the textarea) clears.
    const swatch = screen.getByTestId("color-swatch-annotation-green");
    fireEvent.keyDown(swatch, { key: "Escape" });
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    // The (non-empty) comment survives (Decision 5 keeps it either way).
    expect(useAnnotationStore.getState().annotations.has("c8")).toBe(true);
  });

  it("a selected kind=text comment shows 'Turn into highlight' in its bubble (Story 3.7, AC2)", () => {
    useAnnotationStore.getState().addAnnotation(textComment("c9b"));
    setup();
    act(() => useAnnotationStore.getState().select("c9b"));
    expect(screen.getByTestId("comment-convert-highlight-c9b")).toBeTruthy();
  });

  it("a kind=rect comment has NO 'Turn into highlight' action (no text counterpart to revert to)", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c10"));
    setup();
    act(() => useAnnotationStore.getState().select("c10"));
    expect(screen.queryByTestId("comment-convert-highlight-c10")).toBeNull();
  });

  it("clicking 'Turn into highlight' flips type -> highlight and drops a non-empty body to null", () => {
    useAnnotationStore.getState().addAnnotation(textComment("c11", "a note"));
    setup();
    act(() => useAnnotationStore.getState().select("c11"));
    fireEvent.click(screen.getByTestId("comment-convert-highlight-c11"));
    const c = useAnnotationStore.getState().annotations.get("c11")!;
    expect(c.type).toBe("highlight");
    expect(c.body).toBeNull();
    // Selection is kept (not cleared) so the generic quick-box takes over for it.
    expect(useAnnotationStore.getState().selectedId).toBe("c11");
  });

  it("converts a two-page comment group together (both siblings flip in one call)", () => {
    const c1 = textComment("c1", "note", "annotation-default", "g1");
    const c2 = textComment("c2", "note", "annotation-default", "g1");
    useAnnotationStore.getState().addAnnotation(c1);
    useAnnotationStore.getState().addAnnotation(c2);
    setup();
    act(() => useAnnotationStore.getState().select("c1"));
    fireEvent.click(screen.getByTestId("comment-convert-highlight-c1"));
    const map = useAnnotationStore.getState().annotations;
    expect(map.get("c1")!.type).toBe("highlight");
    expect(map.get("c2")!.type).toBe("highlight");
  });

  describe("hover preview (user feature request)", () => {
    /** Advance fake timers AND let React flush any state updates that result. */
    async function tick(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("hovering the pin (unselected) shows the compact preview with the comment's body", () => {
      useAnnotationStore.getState().addAnnotation(rectComment("p1", "a quick note"));
      setup();
      expect(screen.queryByTestId("comment-preview-p1")).toBeNull();
      act(() => useAnnotationStore.getState().setHovered("p1"));
      const body = screen.getByTestId("comment-preview-body-p1") as HTMLTextAreaElement;
      expect(body.value).toBe("a quick note");
    });

    it("does NOT show the compact preview while the comment is selected (the full bubble takes over)", () => {
      useAnnotationStore.getState().addAnnotation(rectComment("p2", "note"));
      setup();
      act(() => useAnnotationStore.getState().select("p2"));
      act(() => useAnnotationStore.getState().setHovered("p2"));
      expect(screen.queryByTestId("comment-preview-p2")).toBeNull();
      expect(screen.getByTestId("comment-body-p2")).toBeTruthy(); // the full bubble, instead
    });

    it("typing in the compact preview writes body through retextAnnotations, group-aware", () => {
      const c1 = rectComment("p3a", "", "annotation-default", "g1");
      const c2 = rectComment("p3b", "", "annotation-default", "g1");
      useAnnotationStore.getState().addAnnotation(c1);
      useAnnotationStore.getState().addAnnotation(c2);
      setup();
      act(() => useAnnotationStore.getState().setHovered("p3a"));
      fireEvent.change(screen.getByTestId("comment-preview-body-p3a"), { target: { value: "typed" } });
      // Group-aware, same as the full bubble's retext (Codex HIGH precedent): both
      // siblings carry the note.
      expect(useAnnotationStore.getState().annotations.get("p3a")!.body).toBe("typed");
      expect(useAnnotationStore.getState().annotations.get("p3b")!.body).toBe("typed");
    });

    it("un-hovering closes the preview after the grace window, not instantly (hover-intent)", async () => {
      useAnnotationStore.getState().addAnnotation(rectComment("p4", "note"));
      setup();
      act(() => useAnnotationStore.getState().setHovered("p4"));
      expect(screen.getByTestId("comment-preview-p4")).toBeTruthy();
      act(() => useAnnotationStore.getState().setHovered(null));
      // Still open immediately after the pointer leaves — the gap-crossing window.
      expect(screen.getByTestId("comment-preview-p4")).toBeTruthy();
      await tick(HOVER_CLOSE_DELAY_MS);
      expect(screen.queryByTestId("comment-preview-p4")).toBeNull();
    });

    it("re-hovering within the grace window cancels the close (no flicker)", async () => {
      useAnnotationStore.getState().addAnnotation(rectComment("p5", "note"));
      setup();
      act(() => useAnnotationStore.getState().setHovered("p5"));
      act(() => useAnnotationStore.getState().setHovered(null));
      await tick(HOVER_CLOSE_DELAY_MS / 2);
      // Pointer reached the box itself (or re-entered the pin) before the close fired.
      act(() => useAnnotationStore.getState().setHovered("p5"));
      await tick(HOVER_CLOSE_DELAY_MS);
      expect(screen.getByTestId("comment-preview-p5")).toBeTruthy();
    });

    it("hovering the preview box itself (onPointerEnter) keeps hoveredId alive", () => {
      useAnnotationStore.getState().addAnnotation(rectComment("p6", "note"));
      setup();
      act(() => useAnnotationStore.getState().setHovered("p6"));
      fireEvent.pointerEnter(screen.getByTestId("comment-preview-p6"));
      expect(useAnnotationStore.getState().hoveredId).toBe("p6");
      fireEvent.pointerLeave(screen.getByTestId("comment-preview-p6"));
      expect(useAnnotationStore.getState().hoveredId).toBeNull();
    });

    it("does not render a compact preview for a non-comment mark (sanity: gated on comment marks only)", () => {
      useAnnotationStore.getState().addAnnotation(textMark("h1"));
      setup();
      act(() => useAnnotationStore.getState().setHovered("h1"));
      expect(screen.queryByTestId("comment-preview-h1")).toBeNull();
    });
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

  it('a box drag with boxMode="highlight" creates a region highlight with kind=rect, canonical rect, selected, opens the selection quick-box', async () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("highlight", "annotation-green");
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />,
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
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />);

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
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />);

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    // Travel only 4px — below BOX_DRAG_THRESHOLD (8px).
    fireEvent.pointerMove(document, { clientX: 64, clientY: 80 });
    fireEvent.pointerUp(document, { button: 0, clientX: 64, clientY: 80 });

    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("the live box-preview shows a FILL (not just the dashed border), tinted to the active color (fix request)", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("highlight", "annotation-green");
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />);

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    const preview = screen.getByTestId("box-preview");
    expect(preview.style.borderColor).toBe("var(--color-annotation-green)");
    const fill = preview.querySelector(".box-preview__fill") as HTMLElement | null;
    expect(fill).toBeTruthy();
    expect(fill!.style.backgroundColor).toBe("var(--color-annotation-green)");
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
  });

  it("pointerdown on an existing mark does NOT start a box drag (click-selects instead)", () => {
    const surf = pageSurface();
    // Place an existing mark element.
    const existingMark = document.createElement("div");
    existingMark.className = "annotation-highlight";
    surf.appendChild(existingMark);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />);

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
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />);

    fireEvent.pointerDown(qb, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 200 });

    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("box drag does NOT create a region when boxMode is null", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    // boxMode not set (defaults null)
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
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />);

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

describe("AnnotationInteraction box-comment gesture (Story 8.4 — AC1,5, Design D2/D3)", () => {
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

  it('a box drag with boxMode="comment" creates ONE region comment (kind=rect, body="", defaults.colors.comment), selected, opens the bubble not the selection quick-box', async () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    useAnnotationStore.getState().setActiveColor("comment", "annotation-purple");
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="comment" rectReader={reader} />,
    );

    // Drag 60px down-right (above threshold).
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("comment");
    expect(all[0].anchor.kind).toBe("rect");
    expect(all[0].group_id).toBeNull();
    expect(all[0].style.color).toBe("annotation-purple");
    expect(all[0].body).toBe("");
    if (all[0].anchor.kind === "rect") {
      expect(all[0].anchor.rect.x0).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.rect.y0).toBeCloseTo(0.1, 5);
      expect(all[0].anchor.rect.x1).toBeCloseTo(0.2, 5);
      expect(all[0].anchor.rect.y1).toBeCloseTo(0.2, 5);
    }
    expect(useAnnotationStore.getState().selectedId).toBe(all[0].id);
    // A comment shows the bubble, NOT the generic selection quick-box (Decision 4).
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
  });

  it('a below-threshold box-comment drag creates no mark (stray click guard)', () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="comment" rectReader={reader} />,
    );

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    // Travel only 4px — below BOX_DRAG_THRESHOLD (8px).
    fireEvent.pointerMove(document, { clientX: 64, clientY: 80 });
    fireEvent.pointerUp(document, { button: 0, clientX: 64, clientY: 80 });

    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("mid-drag boxMode going to null aborts the box-comment draft (no mark, no preview)", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="comment" rectReader={reader} />,
    );

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    expect(screen.getByTestId("box-preview")).toBeTruthy();

    // The mode switches off mid-drag (e.g. the flyout picks Text, or the tool
    // is disarmed) — the draft must abort, not commit on the eventual release.
    rerender(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode={null} rectReader={reader} />);
    expect(screen.queryByTestId("box-preview")).toBeNull();

    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("mid-drag boxMode switching to the OTHER mode (comment -> highlight) aborts the draft instead of committing the wrong type (Codex 8.4 review, Med finding 1)", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    const { rerender } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="comment" rectReader={reader} />,
    );

    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });

    // The mode flips directly to "highlight" mid-drag (e.g. a hotkey/flyout
    // switch to the OTHER box mode) without ever passing through null.
    rerender(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled boxMode="highlight" rectReader={reader} />,
    );

    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });
    // Must NOT commit as a highlight (the drag started as a comment) — the
    // whole draft is discarded, not silently retyped.
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });
});

describe("AnnotationInteraction box mode suppresses useCreateQuickBox's comment create (Story 8.4, Design D3)", () => {
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

  it("with boxMode=\"comment\" active, a text-drag selection does NOT ALSO create a text comment (exactly one mark, from the box gesture)", async () => {
    const surf = canvasTarget();
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction
        docId="doc-1"
        getPages={() => pages}
        scale={1}
        enabled
        armedTool="comment"
        boxMode="comment"
        rectReader={reader}
      />,
    );

    // A box drag over the page (useCreateQuickBox's onPointerUp also fires on
    // this same document pointerup — it must see boxMode active and bail).
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 160 });
    fireEvent.pointerUp(document, { button: 0, clientX: 120, clientY: 160 });

    const all = useAnnotationStore.getState().all();
    expect(all).toHaveLength(1);
    expect(all[0].anchor.kind).toBe("rect");
  });

  it('with boxMode="comment" active, an empty-selection click does NOT drop a click pin (box gesture owns the gesture, not the click-pin path)', () => {
    const surf = canvasTarget();
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction
        docId="doc-1"
        getPages={() => pages}
        scale={1}
        enabled
        armedTool="comment"
        boxMode="comment"
        rectReader={reader}
      />,
    );

    // A real click (pointerdown then pointerup at the same point, below the box
    // drag threshold): neither the box gesture nor the click-pin path creates.
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 160 });
    fireEvent.pointerUp(surf, { button: 0, clientX: 60, clientY: 160 });

    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });
});

describe("AnnotationInteraction multi-select (box-select) gesture (user feature request)", () => {
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

  /** A memo (kind=rect) whose denormalized px box (page box 600x800, scale 1,
   *  card top=0) is easy to reason about in client-px marquee coordinates. */
  function memoAt(id: string, rect: { x0: number; y0: number; x1: number; y1: number }): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "memo",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: "",
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }

  it("a marquee drag selects every mark it overlaps on the drag's page", () => {
    const surf = pageSurface();
    // px (60,80)-(180,240): inside a (50,70)-(200,250) marquee.
    useAnnotationStore.getState().addAnnotation(memoAt("caught", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }));
    // px (420,560)-(540,720): far outside the marquee.
    useAnnotationStore.getState().addAnnotation(memoAt("missed", { x0: 0.7, y0: 0.7, x1: 0.9, y1: 0.9 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    fireEvent.pointerDown(surf, { button: 0, clientX: 50, clientY: 70 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 250 });
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 250 });

    expect(useAnnotationStore.getState().multiSelectedIds).toEqual(["caught"]);
  });

  it("catches multiple overlapping marks in one drag", () => {
    const surf = pageSurface();
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    useAnnotationStore.getState().addAnnotation(memoAt("b", { x0: 0.3, y0: 0.3, x1: 0.4, y1: 0.4 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    fireEvent.pointerDown(surf, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(document, { button: 0, clientX: 300, clientY: 300 });

    expect(useAnnotationStore.getState().multiSelectedIds.sort()).toEqual(["a", "b"]);
  });

  it("a below-threshold drag does not change the multi-selection (stray click guard)", () => {
    const surf = pageSurface();
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    fireEvent.pointerDown(surf, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(document, { clientX: 64, clientY: 80 }); // 4px, below the 8px threshold
    fireEvent.pointerUp(document, { button: 0, clientX: 64, clientY: 80 });

    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("a marquee CAN start over an existing mark (unlike box-highlight's create gesture)", () => {
    const surf = pageSurface();
    const existingMark = document.createElement("div");
    existingMark.className = "annotation-highlight";
    surf.appendChild(existingMark);
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    fireEvent.pointerDown(existingMark, { button: 0, clientX: 50, clientY: 70 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 250 });
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 250 });

    expect(useAnnotationStore.getState().multiSelectedIds).toEqual(["a"]);
  });

  it("does NOT marquee-select when multiSelectActive=false", () => {
    const surf = pageSurface();
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }));
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);
    fireEvent.pointerDown(surf, { button: 0, clientX: 50, clientY: 70 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 250 });
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 250 });

    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("renders the live marquee preview rect while dragging, cleared on release", () => {
    const surf = pageSurface();
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    fireEvent.pointerDown(surf, { button: 0, clientX: 50, clientY: 70 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 250 });
    expect(screen.getByTestId("multi-select-preview")).toBeTruthy();
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 250 });
    expect(screen.queryByTestId("multi-select-preview")).toBeNull();
  });

  it("Del deletes every multi-selected mark", () => {
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    useAnnotationStore.getState().addAnnotation(memoAt("b", { x0: 0.3, y0: 0.3, x1: 0.4, y1: 0.4 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().setMultiSelected(["a", "b"]));
    fireEvent.keyDown(document, { key: "Delete" });
    const annotations = useAnnotationStore.getState().annotations;
    expect(annotations.has("a")).toBe(false);
    expect(annotations.has("b")).toBe(false);
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("a pointerdown on the group frame's delete button ICON does NOT clear the multi-selection first (live bug: Trash svg is a child of the button, isExempt's exact-tagName check misses it, deselect fired before the click landed)", () => {
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    useAnnotationStore.getState().addAnnotation(memoAt("b", { x0: 0.3, y0: 0.3, x1: 0.4, y1: 0.4 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().setMultiSelected(["a", "b"]));

    // AnnotationInteraction doesn't render AnnotationLayer's group frame; stand in
    // a real `.annotation-multi-select-frame` containing a nested <svg> icon (like
    // the real Trash glyph) so a pointerdown's e.target is the SVG, not the button.
    const frame = document.createElement("div");
    frame.className = "annotation-multi-select-frame";
    const btn = document.createElement("button");
    btn.setAttribute("data-testid", "multi-select-delete");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    btn.appendChild(icon);
    frame.appendChild(btn);
    document.body.appendChild(frame);

    fireEvent.pointerDown(icon);
    // The multi-selection must survive a pointerdown that lands on the icon
    // (the group frame's own interior), same as a click landing on the button
    // proper would be exempt.
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual(["a", "b"]);
    frame.remove();
  });

  it("Esc clears the multi-selection without deleting", () => {
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().setMultiSelected(["a"]));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
  });

  it("Esc clears the multi-selection while a button holds focus (Codex MED, Story 5.6: was swallowed by the broad isExempt, mirroring useSelection.ts's own already-fixed twin bug)", () => {
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().setMultiSelected(["a"]));
    // A stale-focused button (e.g. the last-clicked tool-rail button) must not
    // swallow Esc — App now DEFERS Esc whenever multiSelectedIds is non-empty
    // (Story 5.6 rung 2), so if this handler ALSO ignored it, Esc became a
    // total no-op (neither listener acted).
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    stubNodes.push(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
  });

  it("does not delete on Del while typing in an input (editable exempt)", () => {
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().setMultiSelected(["a"]));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
    input.remove();
  });

  it("a pointerdown on empty space clears the multi-selection", () => {
    const surf = pageSurface();
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    act(() => useAnnotationStore.getState().setMultiSelected(["a"]));
    fireEvent.pointerDown(surf, { button: 0, clientX: 500, clientY: 700 });
    // A plain empty-space click below the marquee threshold: no new drag commits,
    // but the deselect-on-empty-click listener still fires on pointerdown itself.
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("aborts on Escape mid-drag without committing a selection change", () => {
    const surf = pageSurface();
    useAnnotationStore.getState().addAnnotation(memoAt("a", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }));
    const pages = [fakeCard(0, 0)];
    render(
      <AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled multiSelectActive rectReader={reader} />,
    );
    fireEvent.pointerDown(surf, { button: 0, clientX: 50, clientY: 70 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 250 });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("multi-select-preview")).toBeNull();
    fireEvent.pointerUp(document, { button: 0, clientX: 200, clientY: 250 });
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });
});

describe("selected-mark Delete/Escape are not swallowed by a focused button (bug fix)", () => {
  // Repro: click a tool-rail / Annotation Bank button (it keeps DOM focus), then
  // click a mark to select it, then press Del. The document-level selection
  // handler saw e.target = the focused BUTTON and the broad isControlTarget
  // exemption bailed, so Del/Esc silently did nothing (the button just showed a
  // focus ring). The handler now uses the narrow isEditableTarget, which does
  // NOT exempt buttons.
  function selectMark(id: string) {
    const mark = textMark(id);
    useAnnotationStore.setState({ annotations: new Map([[mark.id, mark]]) });
    render(<AnnotationInteraction docId="doc-1" getPages={() => [fakeCard(0, 0)]} scale={1} enabled rectReader={reader} />);
    // Select AFTER mount: useSelection clears the selection once on mount (the
    // doc-switch guard), so a pre-set selectedId would be wiped before the
    // keydown effect binds.
    act(() => useAnnotationStore.setState({ selectedId: id }));
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    stubNodes.push(button);
    return button;
  }

  it("Delete deletes the selected mark while a button holds focus (target = BUTTON)", () => {
    const button = selectMark("m1");
    fireEvent.keyDown(button, { key: "Delete" });
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(false);
  });

  it("Escape clears the selection (without deleting) while a button holds focus", () => {
    const button = selectMark("m2");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    expect(useAnnotationStore.getState().annotations.has("m2")).toBe(true);
  });
});

describe("AnnotationInteraction hide-all toggle (Story 5.5, AC-2, AC-3)", () => {
  it("a create gesture while hidden produces no quick-box and creates nothing", () => {
    useAnnotationStore.setState({ hidden: true });
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });

    expect(screen.queryByTestId("quick-box")).toBeNull();
    expect(useAnnotationStore.getState().all()).toHaveLength(0);
  });

  it("un-hiding restores the create path (same gesture now pops the quick-box)", async () => {
    useAnnotationStore.setState({ hidden: true });
    stubSelection([{ left: 10, top: 100, right: 200, bottom: 120 }]);
    const pages = [fakeCard(0, 0)];
    render(<AnnotationInteraction docId="doc-1" getPages={() => pages} scale={1} enabled rectReader={reader} />);

    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    expect(screen.queryByTestId("quick-box")).toBeNull();

    act(() => useAnnotationStore.setState({ hidden: false }));
    fireEvent.pointerUp(document, { button: 0, clientX: 50, clientY: 110 });
    await screen.findByTestId("quick-box");
  });

  it("a select gesture on an existing mark is suppressed while hidden", () => {
    const mark = textMark("m1");
    useAnnotationStore.setState({ annotations: new Map([[mark.id, mark]]), hidden: true });
    render(<AnnotationInteraction docId="doc-1" getPages={() => [fakeCard(0, 0)]} scale={1} enabled rectReader={reader} />);

    act(() => useAnnotationStore.getState().select("m1"));
    expect(screen.queryByTestId("selection-quick-box")).toBeNull();
  });

  it("renders nothing while hidden even with a live selection", () => {
    const mark = textMark("m1");
    useAnnotationStore.setState({ annotations: new Map([[mark.id, mark]]), selectedId: "m1", hidden: true });
    const { container } = render(
      <AnnotationInteraction docId="doc-1" getPages={() => [fakeCard(0, 0)]} scale={1} enabled rectReader={reader} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
