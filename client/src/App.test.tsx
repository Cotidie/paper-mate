import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";
import * as api from "./api/client";

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
