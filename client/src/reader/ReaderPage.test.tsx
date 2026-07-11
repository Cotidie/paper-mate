import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import ReaderPage from "@/reader/ReaderPage";
import * as api from "@/api/client";
import type { Annotation } from "@/api/client";
import * as renderLayer from "@/render";
import { useAnnotationStore } from "@/store";
import { DEBOUNCE_MS } from "@/hooks/useAutosave";
import { useSettingsStore } from "@/settings/store";
import { DEFAULT_KEYMAP } from "@/settings/keymap";

// The Reader pulls in pdf.js, which can't run under jsdom. These tests only
// care about the reader shell, so stub the render layer; loadDocument stays
// pending so the Reader sits in its loading phase (the pdf-canvas is present).
vi.mock("@/render", () => ({
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
  // ReaderPage fetches the version on mount (GET /api/health). Stub it so
  // tests never hit the network; individual tests override when they assert
  // the value.
  vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "9.9.9" });
  // Story 3.5: the load effect GETs the saved annotations on open. Default to
  // an empty set so every existing open-a-doc test never fires the real
  // fetch; individual tests override to assert restore behavior (CLAUDE.md:
  // keep test scaffolding in sync).
  vi.spyOn(api, "getAnnotations").mockResolvedValue([]);
  // Story 6.7: the load effect fires markDocOpened as a best-effort side
  // effect after hydrate succeeds. Default to resolving so every existing
  // open-a-doc test never hits the real fetch; individual tests override to
  // assert the call + its best-effort (swallowed-rejection) behavior.
  vi.spyOn(api, "markDocOpened").mockResolvedValue(fakeDoc);
  // Story 5.1: the settings store's `persist` middleware writes localStorage,
  // which leaks across tests (Gotcha #1, story Dev Notes). Reset both so a
  // rebind in one test can't poison the next.
  localStorage.clear();
  useSettingsStore.setState({ keymap: DEFAULT_KEYMAP });
  // Story 5.5: the hide-all flag is a store singleton across tests in this file;
  // reset it so a toggle in one test can't leak "hidden" into the next.
  // Story 5.8: docId is the same kind of singleton leak risk now that the
  // store owns it, so it resets alongside hidden/selectedId here too.
  useAnnotationStore.setState({ hidden: false, selectedId: null, docId: null });
});

const fakeDoc: api.Doc = {
  doc_id: "a".repeat(64),
  filename: "paper.pdf",
  title: "A Paper",
  page_count: 3,
  added: "2026-06-28T00:00:00+00:00",
  last_opened: "2026-06-28T00:00:00+00:00",
  authors_list: [],
  file_type: "pdf",
  status: "ready",
  schema_version: 1,
};

/**
 * Render ReaderPage at `/reader/:docId` inside a data router (Story 6.1): the
 * open mechanism is now a route param, not "fill the dropzone-input". A stub
 * `/` route stands in for the Library so redirect-on-failure tests can assert
 * navigation without pulling in LibraryPage's own dependencies.
 */
function renderReaderAt(docId: string) {
  const router = createMemoryRouter(
    [
      { path: "/reader/:docId", element: <ReaderPage /> },
      { path: "/", element: <div data-testid="library-stub" /> },
    ],
    { initialEntries: [`/reader/${docId}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("loading a document via the route param (Story 6.1, AC-2)", () => {
  it("loads the doc via GET /api/docs/{id} and shows the filename in the top bar", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);

    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByText("paper.pdf")).toBeTruthy();
  });

  it("shows the app version (from /api/health) in the Settings modal, not the top bar", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "0.0.1" });
    renderReaderAt(fakeDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    // The version no longer lives in the top bar...
    expect(screen.getByRole("banner").textContent).not.toContain("0.0.1");
    // ...it moved into the Settings modal footer.
    fireEvent.click(screen.getByTestId("tool-settings-button"));
    await waitFor(() =>
      expect(screen.getByTestId("settings-version").textContent).toContain("v0.0.1"),
    );
  });

  it("shows the page indicator (current in a chip + total) in the top bar (AC-2)", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);

    // Reader (mocked render) reports page 1; total = doc.page_count (3). The
    // current-page chip is an editable input, so the page is its `value`.
    await waitFor(() =>
      expect((screen.getByTestId("page-indicator-current") as HTMLInputElement).value).toBe("1"),
    );
    expect(screen.getByTestId("page-indicator").textContent).toContain("of 3");
  });

  it("shows the zoom control in the top bar, left of ToC, driving the Reader (AC-3)", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
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

describe("back-to-Library control (Story 6.1, AC-4)", () => {
  it("navigates to / when clicked", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    await waitFor(() => expect(screen.getByTestId("library-stub")).toBeTruthy());
  });
});

describe("unknown/failed document redirects to the Library (Story 6.1, AC-5)", () => {
  it("a getDoc failure (unknown docId) navigates to / without mounting the reader", async () => {
    vi.spyOn(api, "getDoc").mockRejectedValue(new Error("not found"));
    renderReaderAt("0".repeat(64));

    await waitFor(() => expect(screen.getByTestId("library-stub")).toBeTruthy());
    expect(screen.queryByTestId("reader-backdrop")).toBeNull();
  });
});

describe("table of contents (Story 1.9)", () => {
  // Resolve loadDocument (the shell tests leave it pending) so the Reader reaches
  // its ready phase and reports the outline up via onOutline → ReaderPage's `toc` state.
  async function openedApp(entries: renderLayer.TocEntry[] = []) {
    vi.mocked(renderLayer.loadDocument).mockResolvedValue({
      getPage: vi.fn(async () => ({})),
    } as unknown as Awaited<ReturnType<typeof renderLayer.loadDocument>>);
    vi.mocked(renderLayer.getOutline).mockResolvedValue(entries);
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
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
    // must still close (the click reached ReaderPage's onJump).
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByTestId("toc-panel")).toBeNull());
  });
});

describe("tool rail + tool keys (Story 1.8)", () => {
  async function openReader() {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
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

  it("the Comment flyout's Box option arms box-comment mode (no hotkey, Story 8.4/D4); switching tools away resets it", async () => {
    await openReader();
    const comment = () => screen.getByTestId("tool-comment-button");
    // One click arms Comment AND opens its flyout (the unified open-on-tool-change
    // mechanism); the Text option starts armed (plain text/click mode).
    fireEvent.click(comment());
    expect(comment().className).toContain("tool-button--armed");
    expect(screen.getByTestId("comment-text-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("comment-box-toggle").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByTestId("comment-box-toggle"));
    expect(screen.getByTestId("comment-box-toggle").getAttribute("aria-checked")).toBe("true");
    // Switching away from Comment (Escape → cursor) resets box-comment; re-arming
    // Comment always starts back in plain text mode (mirrors box-highlight's reset).
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(comment());
    expect(screen.getByTestId("comment-text-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("comment-box-toggle").getAttribute("aria-checked")).toBe("false");
  });

  it("box-highlight and box-comment are mutually exclusive (modes of different tools; only one activeTool at a time)", async () => {
    await openReader();
    // Arm box-highlight (M), then switch to Comment: Highlight's box mode resets
    // (activeTool leaves Highlight) and Comment starts in plain text mode.
    fireEvent.keyDown(document, { key: "m" });
    expect(screen.getByTestId("highlight-box-toggle").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("tool-comment-button"));
    expect(screen.getByTestId("comment-text-toggle").getAttribute("aria-checked")).toBe("true");
    // Arm box-comment, then switch back to Highlight: box-comment resets and
    // Highlight starts in plain text mode too.
    fireEvent.click(screen.getByTestId("comment-box-toggle"));
    expect(screen.getByTestId("comment-box-toggle").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("tool-highlight-button"));
    expect(screen.getByTestId("highlight-text-toggle").getAttribute("aria-checked")).toBe("true");
  });

  it("Escape defers to the overlay when a mark is selected (does not disarm the tool); a second Escape then returns to cursor (Story 5.6, layered Esc)", async () => {
    await openReader();
    const hi = () => screen.getByTestId("tool-highlight-button");
    fireEvent.keyDown(document, { key: "h" });
    expect(hi().className).toContain("tool-button--armed");

    // A mark is selected (seeded directly on the store -- the overlay's own
    // clearSelection is a separate concern, covered by useSelection's Esc
    // handling and AnnotationInteraction.test.tsx). ReaderPage's Escape branch
    // must DEFER, not disarm, so a single press never both clears the
    // selection AND drops the armed tool (the AC-2 regression this story fixes).
    act(() => useAnnotationStore.setState({ selectedId: "a1" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hi().className).toContain("tool-button--armed");

    // Nothing selected now (as the overlay's clearSelection would have left
    // it): the SECOND Escape falls through to the fallback rung, cursor.
    act(() => useAnnotationStore.setState({ selectedId: null }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hi().className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
  });

  it("Escape defers to the overlay when a marquee multi-selection is active (does not disarm the tool) (Story 5.6, layered Esc)", async () => {
    await openReader();
    const hi = () => screen.getByTestId("tool-highlight-button");
    fireEvent.keyDown(document, { key: "h" });
    expect(hi().className).toContain("tool-button--armed");

    act(() => useAnnotationStore.setState({ multiSelectedIds: ["a1", "a2"] }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hi().className).toContain("tool-button--armed");

    act(() => useAnnotationStore.setState({ multiSelectedIds: [] }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hi().className).not.toContain("tool-button--armed");
  });

  it("Escape still defers correctly even after Settings re-registers ReaderPage's listener AFTER the overlay's (Codex HIGH, Story 5.6): capture phase, not registration order, makes this safe", async () => {
    await openReader();
    const hi = () => screen.getByTestId("tool-highlight-button");
    fireEvent.keyDown(document, { key: "h" });
    expect(hi().className).toContain("tool-button--armed");

    // Select a REAL mark through the real store, so the overlay's own
    // (bubble-phase) useSelection document listener actually mounts.
    act(() => useAnnotationStore.getState().addAnnotation(mark("a1", fakeDoc.doc_id)));
    act(() => useAnnotationStore.getState().select("a1"));
    expect(useAnnotationStore.getState().selectedId).toBe("a1");

    // Open then close Settings: ReaderPage's own keydown effect unmounts
    // (guard clause) and re-mounts, re-attaching its listener AFTER the
    // overlay's still-mounted selection listener — the exact registration-
    // order flip that broke the old bubble-phase "read state" approach (the
    // overlay would clear the selection FIRST, then ReaderPage would read the
    // now-empty store and disarm on the SAME press).
    fireEvent.click(screen.getByTestId("tool-settings-button"));
    fireEvent.click(screen.getByTestId("settings-close"));

    fireEvent.keyDown(document, { key: "Escape" });
    // Capture phase guarantees ReaderPage evaluates against the PRE-clear
    // value regardless of the flipped bubble order: it must still defer (not
    // disarm) on this first Escape, while the overlay clears the selection.
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    expect(hi().className).toContain("tool-button--armed");

    // Second Escape (now nothing selected): falls through to cursor.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hi().className).not.toContain("tool-button--armed");
  });

  it("'H' over a focused button still arms (letter hotkeys have no native button meaning)", async () => {
    await openReader();
    // Bug repro: clicking a tool-rail button leaves it focused; a stale focus
    // ring must not swallow every later hotkey (matches useUndoRedo's
    // editable-only exempt precedent, not the click-oriented isExempt).
    const btn = screen.getByTestId("tool-highlight-button");
    fireEvent.keyDown(btn, { key: "h" });
    expect(btn.className).toContain("tool-button--armed");
  });

  it("clicking a tool-rail button does not strand keyboard focus and block later hotkeys", async () => {
    await openReader();
    const hi = screen.getByTestId("tool-highlight-button");
    // A real click focuses the clicked button (jsdom mirrors this).
    fireEvent.click(hi);
    hi.focus();
    expect(hi.className).toContain("tool-button--armed");
    // Escape while that button still has focus must still disarm...
    fireEvent.keyDown(hi, { key: "Escape" });
    expect(hi.className).not.toContain("tool-button--armed");
    // ...and a later hotkey, fired with the same stale target, must still work.
    fireEvent.keyDown(hi, { key: "u" });
    expect(screen.getByTestId("tool-underline-button").className).toContain("tool-button--armed");
  });

  it("a handled hotkey blurs a stale-focused tool-rail button, so its native focus ring cannot linger (fix request)", async () => {
    await openReader();
    const hi = screen.getByTestId("tool-highlight-button");
    fireEvent.click(hi);
    hi.focus();
    expect(document.activeElement).toBe(hi);
    // Escape disarms the tool; the button that held stale keyboard focus
    // must be blurred in the same stroke, or the browser's :focus-visible
    // ring latches onto it on this very keydown and never lets go (the
    // black-border-lingers-after-Esc bug).
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).not.toBe(hi);

    // Same for a matched hotkey action (not just the hard-coded Escape branch).
    fireEvent.click(hi);
    hi.focus();
    expect(document.activeElement).toBe(hi);
    fireEvent.keyDown(document, { key: "v" });
    expect(document.activeElement).not.toBe(hi);
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

describe("Settings modal + hotkey rebinding (Story 5.1)", () => {
  async function openReader() {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
  }

  it("the Gear trigger opens the Settings modal", async () => {
    await openReader();
    expect(screen.queryByTestId("settings-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("tool-settings-button"));
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
  });

  it("a rebound key arms the new tool; the old default key is inert (AC-1/AC-3)", async () => {
    await openReader();
    act(() => {
      useSettingsStore.getState().rebind("highlight", { key: "g" });
    });
    fireEvent.keyDown(document, { key: "g" });
    expect(screen.getByTestId("tool-highlight-button").className).toContain("tool-button--armed");
    fireEvent.keyDown(document, { key: "v" });
    fireEvent.keyDown(document, { key: "h" });
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain(
      "tool-button--armed",
    );
  });

  it("the global tool-key handler is suppressed while the Settings modal is open", async () => {
    await openReader();
    fireEvent.click(screen.getByTestId("tool-settings-button"));
    fireEvent.keyDown(document, { key: "h" });
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain(
      "tool-button--armed",
    );
  });

  it("a captured key inside the modal does not leak through to arm a tool", async () => {
    await openReader();
    fireEvent.click(screen.getByTestId("tool-settings-button"));
    fireEvent.click(screen.getByTestId("settings-capture-highlight"));
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "g" });
    fireEvent.click(screen.getByTestId("settings-close"));
    expect(screen.getByTestId("tool-highlight-button").className).not.toContain(
      "tool-button--armed",
    );
    // But the rebind itself DID take effect, once the modal is closed.
    fireEvent.keyDown(document, { key: "g" });
    expect(screen.getByTestId("tool-highlight-button").className).toContain("tool-button--armed");
  });

  it("Escape closes the modal and returns focus to the Gear trigger", async () => {
    await openReader();
    const gear = screen.getByTestId("tool-settings-button");
    gear.focus();
    fireEvent.click(gear);
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "Escape" });
    expect(screen.queryByTestId("settings-modal")).toBeNull();
    expect(document.activeElement).toBe(gear);
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

describe("Annotation Bank (Story 3.6)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map(), flashId: null });
    useAnnotationStore.temporal.getState().clear();
  });

  // Resolve loadDocument (the shell tests leave it pending) so the Reader
  // reaches its ready phase — mirrors the ToC describe block's helper.
  async function openedApp() {
    vi.mocked(renderLayer.loadDocument).mockResolvedValue({
      getPage: vi.fn(async () => ({})),
    } as unknown as Awaited<ReturnType<typeof renderLayer.loadDocument>>);
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
  }

  it("renders nothing until toggled, and shows the empty state once open (AC-1, AC-3)", async () => {
    await openedApp();
    expect(screen.queryByTestId("bank-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Annotation bank" }));
    expect(screen.getByTestId("bank-empty")).toBeTruthy();
  });

  it("toggles the Bank panel open/closed from the top-bar button, reflecting aria-pressed (AC-1)", async () => {
    await openedApp();
    const bank = screen.getByRole("button", { name: "Annotation bank" });
    fireEvent.click(bank);
    expect(screen.getByTestId("bank-panel")).toBeTruthy();
    expect(bank.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(bank);
    expect(screen.queryByTestId("bank-panel")).toBeNull();
    expect(bank.getAttribute("aria-pressed")).toBe("false");
  });

  it("Ctrl B toggles the Bank panel (AC-1)", async () => {
    await openedApp();
    expect(screen.queryByTestId("bank-panel")).toBeNull();
    fireEvent.keyDown(document, { ctrlKey: true, key: "b" });
    expect(screen.getByTestId("bank-panel")).toBeTruthy();
    fireEvent.keyDown(document, { ctrlKey: true, key: "b" });
    expect(screen.queryByTestId("bank-panel")).toBeNull();
  });

  it("Ctrl B is exempt while typing in an editable field", async () => {
    await openedApp();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { ctrlKey: true, key: "b" });
    expect(screen.queryByTestId("bank-panel")).toBeNull();
    document.body.removeChild(input);
  });

  it("lists a mark belonging to the open document", async () => {
    await openedApp();
    act(() => useAnnotationStore.getState().addAnnotation(mark("a1", fakeDoc.doc_id)));
    fireEvent.click(screen.getByRole("button", { name: "Annotation bank" }));
    // `mark()` is a highlight; the Bank's filter defaults to comments only
    // (Story 8.2 AC #2), so widen it before asserting the row is listed.
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
    expect(screen.getByTestId("bank-row-a1")).toBeTruthy();
  });

  it("clicking a row flashes the mark, selects it (same as an on-page click, user fix request), and keeps the panel open (unlike ToC's close-on-jump)", async () => {
    await openedApp();
    act(() => useAnnotationStore.getState().addAnnotation(mark("a1", fakeDoc.doc_id)));
    fireEvent.click(screen.getByRole("button", { name: "Annotation bank" }));
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
    fireEvent.click(screen.getByTestId("bank-row-a1"));
    expect(useAnnotationStore.getState().flashId).toBe("a1");
    expect(useAnnotationStore.getState().selectedId).toBe("a1");
    // The Bank is a review surface (EXPERIENCE.md F2): stays open so the reader
    // can click through several marks, unlike the ToC's one-shot navigation.
    expect(screen.getByTestId("bank-panel")).toBeTruthy();
  });
});

describe("hide/show all annotations toggle (Story 5.5)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map(), selectedId: null, hidden: false });
  });

  // Mirrors the ToC/Bank describe blocks' helper.
  async function openedApp() {
    vi.mocked(renderLayer.loadDocument).mockResolvedValue({
      getPage: vi.fn(async () => ({})),
    } as unknown as Awaited<ReturnType<typeof renderLayer.loadDocument>>);
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
  }

  it("renders the eye pill in S1 with aria-pressed=false", async () => {
    await openedApp();
    const eye = screen.getByRole("button", { name: "Hide annotations" });
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    expect(eye.querySelector("svg")).toBeTruthy();
    expect(eye.textContent).toBe("");
  });

  it("clicking flips aria-pressed and swaps the aria-label (AC-1)", async () => {
    await openedApp();
    const eye = screen.getByRole("button", { name: "Hide annotations" });
    fireEvent.click(eye);
    expect(screen.getByRole("button", { name: "Show annotations" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show annotations" }));
    expect(screen.getByRole("button", { name: "Hide annotations" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("a store with a selectedId set has it cleared after a hide click (AC-3)", async () => {
    await openedApp();
    act(() => useAnnotationStore.getState().addAnnotation(mark("a1", fakeDoc.doc_id)));
    act(() => useAnnotationStore.getState().select("a1"));
    expect(useAnnotationStore.getState().selectedId).toBe("a1");

    fireEvent.click(screen.getByRole("button", { name: "Hide annotations" }));
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    expect(useAnnotationStore.getState().hidden).toBe(true);
  });
});

describe("restore-on-open — the anti-clobber baseline (Story 3.5, AC-4)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map() });
    useAnnotationStore.temporal.getState().clear();
  });

  it("restoring marks on open does NOT dirty autosave (no spurious PUT)", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockResolvedValue([mark("r1", fakeDoc.doc_id)]);
    const putSpy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);

    // Fake timers are enabled BEFORE render/open so that a debounce scheduled
    // DURING open (a regression that dirties on hydrate) is created under fake
    // timers and is actually driven by advanceTimersByTimeAsync — otherwise a
    // real-timer PUT would fire after the test and falsely pass (Codex review).
    vi.useFakeTimers();
    try {
      renderReaderAt(fakeDoc.doc_id);
      // Flush the open promises (getDoc + getAnnotations) AND advance well past
      // the debounce in one go — all under fake timers.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
      });
      expect(screen.queryByTestId("reader-backdrop")).toBeTruthy();
      // The restored mark is in the working copy, and no PUT was scheduled.
      expect(useAnnotationStore.getState().annotations.has("r1")).toBe(true);
      expect(putSpy).not.toHaveBeenCalled();

      // Ctrl+Z right after open cannot remove the restored mark (undo floor, AC-4).
      act(() => {
        useAnnotationStore.temporal.getState().undo();
      });
      expect(useAnnotationStore.getState().annotations.has("r1")).toBe(true);
      expect(useAnnotationStore.temporal.getState().pastStates.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a real edit AFTER restore still dirties + PUTs (baseline→dirty works)", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockResolvedValue([mark("r1", fakeDoc.doc_id)]);
    const putSpy = vi.spyOn(api, "putAnnotations").mockResolvedValue(undefined);
    renderReaderAt(fakeDoc.doc_id);

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

  it("a GET annotations failure on open navigates back to the Library (no empty-store clobber, AC-5)", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockRejectedValue(new Error("network down"));
    renderReaderAt(fakeDoc.doc_id);

    await waitFor(() => expect(screen.getByTestId("library-stub")).toBeTruthy());
    // The reader never mounted.
    expect(screen.queryByTestId("reader-backdrop")).toBeNull();
  });
});

describe("open-touch: markDocOpened on hydrate (Story 6.7, AC-4/AC-8)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map(), docId: null });
    useAnnotationStore.temporal.getState().clear();
  });

  it("fires markDocOpened(docId) once after hydrate succeeds", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    const openSpy = vi.spyOn(api, "markDocOpened").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);

    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(fakeDoc.doc_id);
  });

  it("a markDocOpened rejection is swallowed: no redirect, reader still renders (AC-8)", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "markDocOpened").mockRejectedValue(new Error("storage hiccup"));
    renderReaderAt(fakeDoc.doc_id);

    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());
    // Give the rejected, swallowed promise a tick to settle before asserting.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("library-stub")).toBeNull();
    expect(screen.getByTestId("reader-backdrop")).toBeTruthy();
  });
});

describe("doc-switch annotation isolation (Story 6.7, AC-6)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map(), docId: null });
    useAnnotationStore.temporal.getState().clear();
  });

  it("navigating from paper A to paper B swaps the store atomically; A's marks never appear on B", async () => {
    const docA: api.Doc = { ...fakeDoc, doc_id: "a".repeat(64) };
    const docB: api.Doc = { ...fakeDoc, doc_id: "b".repeat(64), filename: "other.pdf" };
    vi.spyOn(api, "getDoc").mockImplementation(async (docId: string) =>
      docId === docA.doc_id ? docA : docB,
    );
    vi.spyOn(api, "getAnnotations").mockImplementation(async (docId: string) =>
      docId === docA.doc_id ? [mark("a1", docA.doc_id)] : [mark("b1", docB.doc_id)],
    );

    const router = createMemoryRouter(
      [
        { path: "/reader/:docId", element: <ReaderPage /> },
        { path: "/", element: <div data-testid="library-stub" /> },
      ],
      { initialEntries: [`/reader/${docA.doc_id}`] },
    );
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(useAnnotationStore.getState().annotations.has("a1")).toBe(true));
    expect(useAnnotationStore.getState().docId).toBe(docA.doc_id);

    await act(async () => {
      await router.navigate(`/reader/${docB.doc_id}`);
    });

    await waitFor(() => expect(useAnnotationStore.getState().docId).toBe(docB.doc_id));
    const annotations = useAnnotationStore.getState().annotations;
    expect(annotations.has("b1")).toBe(true);
    expect(annotations.has("a1")).toBe(false);
    expect(useAnnotationStore.temporal.getState().pastStates.length).toBe(0);
  });
});

describe("autosave save-failure toast (Story 3.4, AC-5)", () => {
  afterEach(() => {
    useAnnotationStore.setState({ annotations: new Map() });
    useAnnotationStore.temporal.getState().clear();
  });

  it("shows the exact save-failure copy with no em-dash, keeping the change on screen", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "putAnnotations").mockRejectedValue(new Error("network down"));
    renderReaderAt(fakeDoc.doc_id);

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
