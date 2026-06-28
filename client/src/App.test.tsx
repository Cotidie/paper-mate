import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";
import * as api from "./api/client";

// The S1 Reader pulls in pdf.js, which can't run under jsdom. These App tests
// only care about the S0↔S1 shell, so stub the render layer; loadDocument stays
// pending so the Reader sits in its loading phase (the pdf-canvas is present).
vi.mock("./render", () => ({
  loadDocument: vi.fn(() => new Promise(() => {})),
  destroyDocument: vi.fn(),
  getPageBox: vi.fn(() => ({ width: 600, height: 800 })),
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
beforeEach(() => vi.restoreAllMocks());

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
    const toc = screen.getByRole("button", { name: "ToC" });
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
      fireEvent.click(screen.getByTestId("tool-cursor-button"));
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
