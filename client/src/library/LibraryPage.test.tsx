import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import LibraryPage from "@/library/LibraryPage";
import * as api from "@/api/client";

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
});

const fakeDoc: api.Doc = {
  doc_id: "b".repeat(64),
  filename: "added.pdf",
  title: null,
  page_count: 1,
  added: "2026-07-05T00:00:00+00:00",
  last_opened: "2026-07-05T00:00:00+00:00",
  schema_version: 1,
};

function pdfFile() {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "added.pdf", {
    type: "application/pdf",
  });
}

/** Render LibraryPage at `/` inside a data router; a stub `/reader/:docId`
 *  route stands in for the reader so the bridge's navigate() can be observed. */
function renderLibrary() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <LibraryPage /> },
      { path: "/reader/:docId", element: <div data-testid="reader-stub" /> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("Library shell (Story 6.1, AC-3)", () => {
  it("renders the empty-collection copy, app identity, and folder panel", () => {
    renderLibrary();
    expect(screen.getByText("No papers yet.")).toBeTruthy();
    expect(screen.getByText("Paper Mate")).toBeTruthy();
    expect(screen.getByLabelText("Folders")).toBeTruthy();
  });

  it("exposes a keyboard-focusable Add button (AC-6)", () => {
    renderLibrary();
    const add = screen.getByRole("button", { name: /add/i });
    add.focus();
    expect(document.activeElement).toBe(add);
  });
});

describe("Add affordance single-file upload bridge", () => {
  it("uploads the picked file and navigates to /reader/:docId", async () => {
    vi.spyOn(api, "uploadDoc").mockResolvedValue(fakeDoc);
    renderLibrary();

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile()] },
    });

    await waitFor(() => expect(screen.getByTestId("reader-stub")).toBeTruthy());
    expect(api.uploadDoc).toHaveBeenCalledTimes(1);
  });

  it("shows a failure toast and stays on / when the upload fails", async () => {
    vi.spyOn(api, "uploadDoc").mockRejectedValue(new Error("bad pdf"));
    renderLibrary();

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile()] },
    });

    await waitFor(() => expect(screen.getByText("Couldn't add this file.")).toBeTruthy());
    expect(screen.queryByTestId("reader-stub")).toBeNull();
    expect(screen.getByText("No papers yet.")).toBeTruthy();
  });
});
