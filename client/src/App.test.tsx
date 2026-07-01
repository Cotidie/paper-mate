import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import App from "./App";
import * as api from "./api/client";
import type { Annotation } from "./api/client";
import * as renderLayer from "./render";
import { useAnnotationStore } from "./store";
import { DEBOUNCE_MS } from "./useAutosave";

// The S1 Reader pulls in pdf.js, which can't run under jsdom. These App tests
// only care about the S0↔S1 shell, so stub the render layer; loadDocument stays
// pending so the Reader sits in its loading phase (the pdf-canvas is present).
vi.mock("./render", () => ({
  loadDocument: vi.fn(() => new Promise(() => {})),
  destroyDocument: vi.fn(),
  getPageBox: vi.fn(() => ({ width: 600, height: 800 })),
  // ToC outline read (Story 1.9): the Reader imports it, so the mocked barrel
  // must export it or the outline effect throws. Default to no outline.
  getOutline: vi.fn(async () => []),
  renderPage: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })),
  fitToWidthScale: vi.fn(() => 1),
  currentPageInView: vi.fn(() => 1),
  // The real usePageViewport hook (sub-path import) calls pageWindow at render,
  // so the mocked render barrel must export it (+ WINDOW_RADIUS).
  pageWindow: vi.fn((c: number, r: number, n: number) => ({
    start: Math.max(1, c - r),
    end: Math.min(n, c + r),
  })),
  WINDOW_RADIUS: 2,
  pageNavTarget: vi.fn((c: number, d: number, n: number) => Math.min(n, Math.max(1, c + d))),
  nextZoom: vi.fn((s: number, dir: number) => (dir >= 0 ? s * 2 : s / 2)),
  focalScroll: vi.fn((edge: number, size: number, frac: number, focal: number) => edge + frac * size - focal),
  panScroll: vi.fn((start: number, delta: number) => start - delta),
  ZOOM_STEP: 1.25,
  ZOOM_WHEEL_STEP: 1.1,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  // App fetches the version on mount (GET /api/health). Stub it so tests never
  // hit the network; individual tests override when they assert the value.
  vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "9.9.9" });
  // Story 3.5: handleFile now GETs the saved annotations on open. Default to an
  // empty set so every existing open-a-doc test never fires the real fetch;
  // individual tests override to assert restore behavior (CLAUDE.md: keep test
  // scaffolding in sync).
  vi.spyOn(api, "getAnnotations").mockResolvedValue([]);
});

const fakeDoc: api.Doc = {
  doc_id: "a".repeat(64),
  filename: "paper.pdf",
  title: "A Paper",
  page_count: 3,
  added: "2026-06-28T00:00:00+00:00",
  last_opened: "2026-06-28T00:00:00+00:00",
  schema_version: 1,
};

function pdfFile() {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "paper.pdf", {
    type: "application/pdf",
  });
}

describe("S0 empty state", () => {
  it("shows the dropzone copy 'Drop a PDF here' / 'or browse…' (AC-1)", () => {
    render(<App />);
    expect(screen.getByTestId("empty-dropzone")).toBeTruthy();
    expect(screen.getByText("Drop a PDF here")).toBeTruthy();
    expect(screen.getByText("or browse…")).toBeTruthy();
  });

  it("does not render the S1 reader frame before a PDF loads", () => {
    render(<App />);
    expect(screen.queryByTestId("reader-backdrop")).toBeNull();
  });

  it("exposes a keyboard-focusable browse control (focus-ring target, AC-1/UX-DR17)", () => {
    render(<App />);
    const browse = screen.getByRole("button", { name: "or browse…" });
    browse.focus();
    expect(document.activeElement).toBe(browse);
  });
});

describe("upload → S1 transition (AC-6)", () => {
  it("transitions to S1 and shows the filename in the top bar on success", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });

    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByText("paper.pdf")).toBeTruthy();
  });

  it("shows the app version badge (from /api/health) in the top bar", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "0.0.1" });
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });

    await waitFor(() => expect(screen.getByText("v0.0.1")).toBeTruthy());
    expect(screen.getByRole("banner").contains(screen.getByText("v0.0.1"))).toBe(true);
  });

  it("shows the 'Page N of M' indicator in the top bar (AC-2)", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });

    // Reader (mocked render) reports page 1; M = doc.page_count (3).
    await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeTruthy());
  });

  it("shows the zoom control in the top bar, left of ToC, driving the Reader (AC-3)", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    render(<App />);
    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    // Zoom control lives in the top bar (banner), before the ToC button.
    const banner = screen.getByRole("banner");
    const zoom = screen.getByTestId("zoom-control");
    expect(banner.contains(zoom)).toBe(true);
    const toc = screen.getByRole("button", { name: "Table of contents" });
    // DOCUMENT_POSITION_FOLLOWING (4): toc comes after zoom in document order.
    expect(zoom.compareDocumentPosition(toc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Buttons drive the Reader's imperative zoom handle (nextZoom mock ×2 / ÷2).
    expect(screen.getByTestId("zoom-percent").textContent).toBe("100%");
    fireEvent.click(screen.getByLabelText("Zoom in"));
    await waitFor(() => expect(screen.getByTestId("zoom-percent").textContent).toBe("200%"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    await waitFor(() => expect(screen.getByTestId("zoom-percent").textContent).toBe("100%"));
  });
});

describe("table of contents (Story 1.9)", () => {
  // Resolve loadDocument (the shell tests leave it pending) so the Reader reaches
  // its ready phase and reports the outline up via onOutline → App's `toc` state.
  async function openedApp(entries: renderLayer.TocEntry[] = []) {
    vi.mocked(renderLayer.loadDocument).mockResolvedValue({
      getPage: vi.fn(async () => ({})),
    } as unknown as Awaited<ReturnType<typeof renderLayer.loadDocument>>);
    vi.mocked(renderLayer.getOutline).mockResolvedValue(entries);
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    render(<App />);
    fireEvent.change(screen.getByTestId("dropzone-input"), { target: { files: [pdfFile()] } });
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
  }

  it("renders ToC + Bank as icon buttons with accessible names (no visible text)", async () => {
    await openedApp([]);
    const toc = screen.getByRole("button", { name: "Table of contents" });
    const bank = screen.getByRole("button", { name: "Annotation bank" });
    // Icon-only: an svg glyph, no text label.
    expect(toc.querySelector("svg")).toBeTruthy();
    expect(bank.querySelector("svg")).toBeTruthy();
    expect(toc.textContent).toBe("");
  });

  it("toggles the ToC panel open and closed from the top-bar button (AC-1)", async () => {
    await openedApp([{ title: "Intro", pageNumber: 1, depth: 0 }]);
    expect(screen.queryByTestId("toc-panel")).toBeNull();
    const toc = screen.getByRole("button", { name: "Table of contents" });
    fireEvent.click(toc);
    await waitFor(() => expect(screen.getByTestId("toc-panel")).toBeTruthy());
    expect(toc.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toc);
    expect(screen.queryByTestId("toc-panel")).toBeNull();
  });

  it("shows the empty state for a PDF with no outline (AC-3)", async () => {
    await openedApp([]);
    fireEvent.click(screen.getByRole("button", { name: "Table of contents" }));
    await waitFor(() => expect(screen.getByTestId("toc-empty")).toBeTruthy());
  });

  it("clicking a row jumps the reader and closes the panel (AC-2)", async () => {
    await openedApp([{ title: "Methods", pageNumber: 2, depth: 0 }]);
    fireEvent.click(screen.getByRole("button", { name: "Table of contents" }));
    const row = await screen.findByTestId("toc-row-0");
    // jsdom has no scrollTo on the canvas; the jump no-ops there, but the panel
    // must still close (the click reached App's onJump).
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByTestId("toc-panel")).toBeNull());
  });
});

describe("review hardening", () => {
  it("clears the file input value after a pick so the same file can re-fire (F6)", () => {
    vi.spyOn(api, "uploadDoc").mockRejectedValue(new Error("bad"));
    render(<App />);
    const input = screen.getByTestId("dropzone-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdfFile()] } });
    expect(input.value).toBe("");
  });

  it("disables the browse control while an upload is in flight (F5)", async () => {
    let release!: (doc: api.Doc) => void;
    vi.spyOn(api, "uploadDoc").mockReturnValue(
      new Promise<api.Doc>((res) => {
        release = res;
      }),
    );
    render(<App />);
    const browse = screen.getByRole("button", { name: "or browse…" });

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect((browse as HTMLButtonElement).disabled).toBe(true));

    release(fakeDoc);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
  });
});

describe("tool rail + tool keys (Story 1.8)", () => {
  async function openReader() {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    render(<App />);
    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
  }

  it("arming hand in the flyout arms panning in the Reader (panArmed → data-pan)", async () => {
    await openReader();
    // Default: cursor — no pan armed.
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(false);
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    fireEvent.click(screen.getByTestId("tool-option-hand"));
    // Rail shows hand armed AND the Reader is now pannable.
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(true);
  });

  it("V and Escape return to cursor (un-arm pan)", async () => {
    await openReader();
    const armHand = () => {
      // Open the pointer flyout if a tool switch hasn't already auto-opened it
      // (switching to any tool opens its sub-toolbar — the unified mechanism).
      if (!screen.queryByTestId("tool-flyout")) {
        fireEvent.click(screen.getByTestId("tool-cursor-button"));
      }
      fireEvent.click(screen.getByTestId("tool-option-hand"));
    };
    armHand();
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(true);
    fireEvent.keyDown(document, { key: "v" });
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(false);

    armHand();
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(false);
  });

  it("'H' arms the highlight tool; 'V'/'Escape' disarm it (Story 2.3)", async () => {
    await openReader();
    const hi = () => screen.getByTestId("tool-highlight-button");
    // Default: not armed.
    expect(hi().className).not.toContain("tool-button--armed");
    // H arms highlight.
    fireEvent.keyDown(document, { key: "h" });
    expect(hi().className).toContain("tool-button--armed");
    // V disarms.
    fireEvent.keyDown(document, { key: "v" });
    expect(hi().className).not.toContain("tool-button--armed");
    // Re-arm, Escape disarms.
    fireEvent.keyDown(document, { key: "H" });
    expect(hi().className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hi().className).not.toContain("tool-button--armed");
  });

  it("'U' arms the underline tool; 'V'/'Escape' disarm it (Story 2.7)", async () => {
    await openReader();
    const un = () => screen.getByTestId("tool-underline-button");
    expect(un().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "u" });
    expect(un().className).toContain("tool-button--armed");
    // Mutual exclusion: highlight is not also armed.
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "v" });
    expect(un().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "U" });
    expect(un().className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(un().className).not.toContain("tool-button--armed");
  });

  it("'D' arms the pen tool; 'V'/'Escape' disarm it (Story 2.8)", async () => {
    await openReader();
    const pen = () => screen.getByTestId("tool-pen-button");
    expect(pen().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "d" });
    expect(pen().className).toContain("tool-button--armed");
    // Mutual exclusion: highlight/underline are not also armed.
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("tool-underline-button").className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "v" });
    expect(pen().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "D" });
    expect(pen().className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(pen().className).not.toContain("tool-button--armed");
  });

  it("'T' arms the memo tool; 'V'/'Escape' disarm it (Story 2.9)", async () => {
    await openReader();
    const memo = () => screen.getByTestId("tool-memo-button");
    expect(memo().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "t" });
    expect(memo().className).toContain("tool-button--armed");
    // Mutual exclusion: highlight/underline/pen are not also armed.
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("tool-pen-button").className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "v" });
    expect(memo().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "T" });
    expect(memo().className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(memo().className).not.toContain("tool-button--armed");
  });

  it("'C' arms the comment tool; 'V'/'Escape' disarm it (Story 2.10)", async () => {
    await openReader();
    const comment = () => screen.getByTestId("tool-comment-button");
    expect(comment().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "c" });
    expect(comment().className).toContain("tool-button--armed");
    // Mutual exclusion: highlight/underline/pen/memo are not also armed.
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("tool-memo-button").className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "v" });
    expect(comment().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "C" });
    expect(comment().className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(comment().className).not.toContain("tool-button--armed");
  });

  it("'M' arms Highlight with box mode on; 'V'/'Escape' return to cursor (Story 2.11, UX-DR15)", async () => {
    await openReader();
    const cursor = () => screen.getByTestId("tool-cursor-button");
    const highlight = () => screen.getByTestId("tool-highlight-button");
    expect(cursor().className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "m" });
    // Box-highlight is a MODE of Highlight: M arms Highlight (its button armed, the
    // cursor button is not) and switches the box toggle on (the flyout opens by the
    // open-on-tool-change effect).
    expect(highlight().className).toContain("tool-button--armed");
    expect(cursor().className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("highlight-box-toggle").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document, { key: "v" });
    // V returns to plain cursor — cursor armed, Highlight off.
    expect(cursor().className).toContain("tool-button--armed");
    expect(highlight().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "M" });
    // Capital M also works.
    expect(highlight().className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "Escape" });
    // Escape returns to cursor (AD-11); re-arming Highlight starts in plain mode.
    expect(cursor().className).toContain("tool-button--armed");
    expect(highlight().className).not.toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "h" });
    expect(screen.getByTestId("highlight-box-toggle").getAttribute("aria-checked")).toBe("false");
  });

  it("'H' over a focused button/select does NOT arm (handler exempts controls)", async () => {
    await openReader();
    const btn = screen.getByTestId("tool-highlight-button");
    // Key event whose target is a BUTTON must be ignored by the document handler.
    fireEvent.keyDown(btn, { key: "h" });
    expect(btn.className).not.toContain("tool-button--armed");
  });

  it("clicking the Highlight rail button arms it; re-click keeps it armed (no toggle-off)", async () => {
    await openReader();
    const btn = screen.getByTestId("tool-highlight-button");
    fireEvent.click(btn);
    expect(btn.className).toContain("tool-button--armed");
    // Re-clicking the active tool does NOT cancel it — it stays armed.
    fireEvent.click(btn);
    expect(btn.className).toContain("tool-button--armed");
  });

  it("arming highlight releases the hand pan so the drag is not eaten (#5/#2 mutual exclusion)", async () => {
    await openReader();
    // Arm hand → pannable.
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    fireEvent.click(screen.getByTestId("tool-option-hand"));
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(true);
    // Press H: highlight arms AND pan is released (mode back to cursor), so a
    // text drag selects instead of panning.
    fireEvent.keyDown(document, { key: "h" });
    expect(screen.getByTestId("tool-highlight-button").className).toContain("tool-button--armed");
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(false);
    // Exactly one tool active: the pointer button is no longer armed.
    expect(screen.getByTestId("tool-cursor-button").className).not.toContain("tool-button--armed");
  });

  it("clicking the pointer button while Highlight is armed switches to cursor in ONE click", async () => {
    await openReader();
    fireEvent.keyDown(document, { key: "h" });
    expect(screen.getByTestId("tool-highlight-button").className).toContain("tool-button--armed");
    // Single click on the pointer button commits to cursor in ONE click (highlight
    // disarmed, mutual exclusion). Per the unified mechanism, switching to the
    // pointer tool also opens its sub-toolbar by default.
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    // Cursor (not hand), so pan is not armed.
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(false);
  });

  it("switching back to hand disarms the highlight tool (mutual exclusion)", async () => {
    await openReader();
    fireEvent.keyDown(document, { key: "h" });
    expect(screen.getByTestId("tool-highlight-button").className).toContain("tool-button--armed");
    // One click switches Highlight → cursor and auto-opens the pointer flyout
    // (unified mechanism), from which hand can be picked → pan arms.
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    fireEvent.click(screen.getByTestId("tool-option-hand"));
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("reader-backdrop").hasAttribute("data-pan")).toBe(true);
  });

  it("'[' toggles the rail collapsed / expanded", async () => {
    await openReader();
    // Expanded: the cursor button is present.
    expect(screen.queryByTestId("tool-cursor-button")).toBeTruthy();
    fireEvent.keyDown(document, { key: "[" });
    // Collapsed: minimal rail, no cursor button, expand affordance present.
    expect(screen.queryByTestId("tool-cursor-button")).toBeNull();
    expect(screen.getByTestId("tool-rail-collapse").getAttribute("aria-label")).toBe("Expand tools");
    fireEvent.keyDown(document, { key: "[" });
    expect(screen.queryByTestId("tool-cursor-button")).toBeTruthy();
  });
});

describe("upload failure → toast, stay S0 (AC-5)", () => {
  it("shows the exact 'Couldn't open this file.' copy and stays in S0", async () => {
    vi.spyOn(api, "uploadDoc").mockRejectedValue(new Error("bad pdf"));
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });

    await waitFor(() =>
      expect(screen.getByText("Couldn't open this file.")).toBeTruthy(),
    );
    expect(screen.getByTestId("empty-dropzone")).toBeTruthy();
    expect(screen.queryByTestId("reader-backdrop")).toBeNull();
  });
});

function mark(id: string, docId: string): Annotation {
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

describe("restore-on-open — the anti-clobber baseline (Story 3.5, AC-4)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map() });
    useAnnotationStore.temporal.getState().clear();
  });

  it("restoring marks on open does NOT dirty autosave (no spurious PUT)", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockResolvedValue([mark("r1", fakeDoc.doc_id)]);
    const putSpy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
    // The restored mark is in the working copy.
    expect(useAnnotationStore.getState().annotations.has("r1")).toBe(true);

    // Advance well past the debounce: the restore must NOT have scheduled a PUT.
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(putSpy).not.toHaveBeenCalled();

    // Ctrl+Z right after open cannot remove the restored mark (undo floor, AC-4).
    act(() => {
      useAnnotationStore.temporal.getState().undo();
    });
    expect(useAnnotationStore.getState().annotations.has("r1")).toBe(true);
    expect(useAnnotationStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("a real edit AFTER restore still dirties + PUTs (baseline→dirty works)", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockResolvedValue([mark("r1", fakeDoc.doc_id)]);
    const putSpy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    vi.useFakeTimers();
    try {
      act(() => {
        useAnnotationStore.getState().addAnnotation(mark("new", fakeDoc.doc_id));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
  });

  it("a GET failure on open keeps the reader closed (no empty-store clobber, AC-5)", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockRejectedValue(new Error("network down"));
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(screen.getByText("Couldn't open this file.")).toBeTruthy());
    // Stayed in S0: the reader never mounted.
    expect(screen.queryByTestId("reader-backdrop")).toBeNull();
    expect(screen.getByTestId("empty-dropzone")).toBeTruthy();
  });
});

describe("autosave save-failure toast (Story 3.4, AC-5)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map() });
    useAnnotationStore.temporal.getState().clear();
  });

  it("shows the exact save-failure copy with no em-dash, keeping the change on screen", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "putAnnotations").mockRejectedValue(new Error("network down"));
    render(<App />);

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile()] },
    });
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    vi.useFakeTimers();
    try {
      act(() => {
        useAnnotationStore.getState().addAnnotation(mark("a1", fakeDoc.doc_id));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't save. Changes kept in this session."),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId("toast").textContent).not.toContain("—");
    // The change stays in the working copy (not rolled back on failure).
    expect(useAnnotationStore.getState().annotations.has("a1")).toBe(true);
  });
});
