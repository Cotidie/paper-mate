import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import LibraryPage from "@/library/LibraryPage";
import * as api from "@/api/client";

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [], folders: [] });
  // The Library fetches the version on mount (GET /api/health), same as
  // ReaderPage. Stub it so tests never hit the network; individual tests
  // override to assert the rendered value.
  vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "9.9.9" });
});

function pdfFile(name: string) {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: "application/pdf",
  });
}

function fakeDoc(doc_id: string, filename: string, title: string | null = null): api.Doc {
  return {
    doc_id,
    filename,
    title,
    page_count: 1,
    added: "2026-07-05T00:00:00+00:00",
    last_opened: "2026-07-05T00:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    schema_version: 1,
  };
}

function rowFromDoc(doc: api.Doc, order: number): api.CollectionRow {
  return {
    doc_id: doc.doc_id,
    title: doc.title ?? null,
    authors: null,
    added: doc.added,
    file_type: doc.file_type,
    status: doc.status,
    folder_id: null,
    trashed: false,
    order,
    filename: doc.filename,
  };
}

/**
 * A minimal in-memory stand-in for the backend's `library.json` index: mocks
 * `getLibrary` to reflect whatever has been `store()`d, so a post-batch
 * refetch (AC-7) sees the same reality a real server would, instead of a
 * static empty mock clobbering an already-landed optimistic row.
 */
function mockBackend() {
  const papers: api.CollectionRow[] = [];
  vi.spyOn(api, "getLibrary").mockImplementation(async () => ({ papers: [...papers], folders: [] }));
  function store(doc: api.Doc): api.Doc {
    const existing = papers.findIndex((p) => p.doc_id === doc.doc_id);
    const row = rowFromDoc(doc, existing >= 0 ? papers[existing].order : papers.length);
    if (existing >= 0) papers[existing] = row;
    else papers.push(row);
    return doc;
  }
  return { store };
}

const fakeRow: api.CollectionRow = {
  doc_id: "c".repeat(64),
  title: "Attention Is All You Need",
  authors: "Vaswani et al.",
  added: "2026-07-05T00:00:00+00:00",
  file_type: "pdf",
  status: "ready",
  folder_id: null,
  trashed: false,
  order: 0,
};

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
  it("renders the empty-collection dropzone and folder panel, with no app-name top bar", async () => {
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
    expect(screen.queryByText("Paper Mate")).toBeNull();
    expect(screen.getByLabelText("Folders")).toBeTruthy();
  });

  it("exposes a keyboard-focusable Add button (AC-6)", () => {
    renderLibrary();
    const add = screen.getByRole("button", { name: /add/i });
    add.focus();
    expect(document.activeElement).toBe(add);
  });

  it("shows the count and an Add control in one row once the library has papers", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("1 files in library")).toBeTruthy());
    expect(screen.getByRole("button", { name: /add/i })).toBeTruthy();
  });

  it("shows a count skeleton (not the real count) while the library is still loading", async () => {
    let resolveFetch: (lib: api.Library) => void = () => {};
    vi.spyOn(api, "getLibrary").mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderLibrary();
    expect(document.querySelector(".library-toolbar__count-skeleton")).toBeTruthy();
    expect(screen.queryByText(/files in library/)).toBeNull();
    resolveFetch({ papers: [], folders: [] });
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
  });
});

describe("Bulk upload (Story 6.4)", () => {
  it("streams an optimistic row per browsed file, then settles them into real rows and refetches", async () => {
    const backend = mockBackend();
    const docAlpha = fakeDoc("a".repeat(64), "alpha.pdf", "Paper Alpha");
    const docBeta = fakeDoc("b".repeat(64), "beta.pdf", "Paper Beta");
    let resolveAlpha: (doc: api.Doc) => void = () => {};
    let resolveBeta: (doc: api.Doc) => void = () => {};
    vi.spyOn(api, "uploadDoc").mockImplementation(
      (file: File) =>
        new Promise<api.Doc>((resolve) => {
          if (file.name === "alpha.pdf") resolveAlpha = resolve;
          else resolveBeta = resolve;
        }),
    );
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("alpha.pdf"), pdfFile("beta.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getAllByText("Extracting").length).toBe(2);

    resolveAlpha(backend.store(docAlpha));
    resolveBeta(backend.store(docBeta));

    await waitFor(() => expect(screen.getByText("Paper Alpha")).toBeTruthy());
    expect(screen.getByText("Paper Beta")).toBeTruthy();
    expect(screen.queryByText("Extracting")).toBeNull();
    await waitFor(() => expect(screen.getByText("2 files in library")).toBeTruthy());
  });

  it("shows a failure toast for one bad file while the other still lands", async () => {
    const backend = mockBackend();
    const goodDoc = fakeDoc("d".repeat(64), "good.pdf", "Good Paper");
    vi.spyOn(api, "uploadDoc").mockImplementation(async (file: File) => {
      if (file.name === "bad.pdf") throw new Error("Could not read PDF file");
      return backend.store(goodDoc);
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("bad.pdf"), pdfFile("good.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Couldn't add this file.")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Good Paper")).toBeTruthy());
  });

  it("does not add a second row when a re-upload resolves to the same doc_id", async () => {
    const backend = mockBackend();
    const doc = fakeDoc("e".repeat(64), "dup.pdf", "Duplicate Paper");
    vi.spyOn(api, "uploadDoc").mockImplementation(async () => backend.store(doc));
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("dup.pdf")] },
    });
    await waitFor(() => expect(screen.getByText("Duplicate Paper")).toBeTruthy());
    expect(screen.getByText("1 files in library")).toBeTruthy();

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("dup.pdf")] },
    });
    await waitFor(() => expect(screen.getAllByText("Duplicate Paper").length).toBe(1));
    expect(screen.getByText("1 files in library")).toBeTruthy();
  });

  it("uploads files picked via the empty-state dropzone", async () => {
    const backend = mockBackend();
    const doc = fakeDoc("f".repeat(64), "fresh.pdf", "Fresh Paper");
    vi.spyOn(api, "uploadDoc").mockImplementation(async () => backend.store(doc));
    renderLibrary();
    await waitFor(() => expect(screen.getByTestId("empty-dropzone")).toBeTruthy());

    fireEvent.change(screen.getByTestId("dropzone-input"), {
      target: { files: [pdfFile("fresh.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Fresh Paper")).toBeTruthy());
  });
});

describe("Collection table (Story 6.3)", () => {
  it("shows skeleton rows before the library fetch resolves", async () => {
    let resolveFetch: (lib: api.Library) => void = () => {};
    vi.spyOn(api, "getLibrary").mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderLibrary();

    expect(document.querySelectorAll(".collection-table__skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByText("Drop PDFs here")).toBeNull();

    resolveFetch({ papers: [], folders: [] });
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
  });

  it("renders the collection as a table once the library loads", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());
    expect(screen.getByText("1 files in library")).toBeTruthy();
    expect(screen.queryByText("Drop PDFs here")).toBeNull();
  });

  it("navigates to /reader/:docId when a selected row is clicked again", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());
    const row = screen.getByText("Attention Is All You Need").closest("tr")!;
    fireEvent.click(row); // select
    expect(screen.queryByTestId("reader-stub")).toBeNull();
    fireEvent.click(row); // open

    await waitFor(() => expect(screen.getByTestId("reader-stub")).toBeTruthy());
  });

  it("shows an error toast and no table when the library fetch fails", async () => {
    vi.spyOn(api, "getLibrary").mockRejectedValue(new Error("boom"));
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Couldn't load your library.")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId("empty-dropzone")).toBeNull();
  });

  it("keeps the bulk-upload bridge working after a load failure", async () => {
    vi.spyOn(api, "getLibrary").mockRejectedValue(new Error("boom"));
    const doc = fakeDoc("g".repeat(64), "recover.pdf", "Recovered Paper");
    vi.spyOn(api, "uploadDoc").mockResolvedValue(doc);
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Couldn't load your library.")).toBeTruthy());

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("recover.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Recovered Paper")).toBeTruthy());
  });
});

describe("Code review fixes (Story 6.4)", () => {
  it("shows the pending row instead of the loading skeleton once an upload is enqueued mid-fetch (AC-2)", async () => {
    let resolveInitialFetch: (lib: api.Library) => void = () => {};
    vi.spyOn(api, "getLibrary").mockReturnValue(
      new Promise((resolve) => {
        resolveInitialFetch = resolve;
      }),
    );
    vi.spyOn(api, "uploadDoc").mockReturnValue(new Promise(() => {})); // never resolves in this test
    renderLibrary();

    expect(document.querySelectorAll(".collection-table__skeleton-row").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("mid-fetch.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("mid-fetch")).toBeTruthy());
    expect(document.querySelectorAll(".collection-table__skeleton-row").length).toBe(0);

    resolveInitialFetch({ papers: [], folders: [] });
  });

  it("keeps a settled upload's position stable across the post-batch refetch (no re-jump after settling)", async () => {
    // The backend appends new entries at `max(order)+1` (`_upsert_paper_entry`,
    // server/app/storage/__init__.py) and `read_library()` returns that
    // append order as-is (client sort is Story 7.4). The optimistic upsert
    // mirrors that same order so the row doesn't settle at the top only to
    // jump to the bottom once the AC-7 refetch lands moments later.
    const backend = mockBackend();
    const already = fakeDoc("h".repeat(64), "already.pdf", "Already There");
    backend.store(already);
    const fresh = fakeDoc("i".repeat(64), "fresh2.pdf", "Freshly Added");
    vi.spyOn(api, "uploadDoc").mockImplementation(async () => backend.store(fresh));
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Already There")).toBeTruthy());

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("fresh2.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Freshly Added")).toBeTruthy());
    const titlesAfterResolve = Array.from(document.querySelectorAll(".collection-table__title")).map(
      (el) => el.textContent,
    );

    // Let the post-batch `getLibrary()` reconcile (AC-7) land too.
    await waitFor(() => expect(api.getLibrary).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    const titlesAfterReconcile = Array.from(document.querySelectorAll(".collection-table__title")).map(
      (el) => el.textContent,
    );

    expect(titlesAfterReconcile).toEqual(titlesAfterResolve);
    expect(titlesAfterReconcile).toEqual(["Already There", "Freshly Added"]);
  });

  it("clears the load-failed state once a later reconcile succeeds (no stuck blank screen)", async () => {
    vi.spyOn(api, "getLibrary").mockRejectedValueOnce(new Error("boom"));
    const doc = fakeDoc("j".repeat(64), "later.pdf", null);
    vi.spyOn(api, "uploadDoc").mockImplementation(async () => {
      // The batch-settled refetch succeeds with an EMPTY library (e.g. the
      // upload's row hasn't reconciled into this particular fetch), which
      // should still clear loadFailed instead of leaving the screen blank.
      vi.mocked(api.getLibrary).mockResolvedValueOnce({ papers: [], folders: [] });
      return doc;
    });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Couldn't load your library.")).toBeTruthy());

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("later.pdf")] },
    });

    // Once the batch settles and its refetch succeeds, the empty dropzone
    // (not a blank `null` render) should show, proving loadFailed cleared.
    await waitFor(() => expect(screen.getByTestId("empty-dropzone")).toBeTruthy());
  });

  it("ignores a slow initial fetch that resolves after a faster post-batch reconcile (stale-fetch guard)", async () => {
    const papers: api.CollectionRow[] = [];
    let callCount = 0;
    let resolveInitialFetch: (lib: api.Library) => void = () => {};
    vi.spyOn(api, "getLibrary").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // The initial mount fetch (seq 1): deliberately held open so it
        // resolves LAST, after the batch-settled reconcile (seq 2) below.
        return new Promise((resolve) => {
          resolveInitialFetch = resolve;
        });
      }
      return Promise.resolve({ papers: [...papers], folders: [] });
    });
    const doc = fakeDoc("k".repeat(64), "fast.pdf", "Fast Settle");
    vi.spyOn(api, "uploadDoc").mockImplementation(async () => {
      papers.push(rowFromDoc(doc, 0));
      return doc;
    });
    renderLibrary();

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("fast.pdf")] },
    });
    // The batch-settled refetch (seq 2, real data) lands while the initial
    // fetch (seq 1) is still outstanding.
    await waitFor(() => expect(screen.getByText("Fast Settle")).toBeTruthy());

    // Now let the stale initial fetch land LAST, with empty data. Without
    // the sequence guard, this would wipe the settled row back to empty.
    resolveInitialFetch({ papers: [], folders: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByText("Fast Settle")).toBeTruthy();
  });
});

describe("Left pane (version display)", () => {
  it("shows the app version once fetchHealth resolves", async () => {
    vi.spyOn(api, "fetchHealth").mockResolvedValue({ status: "ok", version: "0.4.4" });
    renderLibrary();
    await waitFor(() => expect(screen.getByTestId("library-version").textContent).toBe("v0.4.4"));
  });

  it("renders no version label if fetchHealth fails", async () => {
    vi.spyOn(api, "fetchHealth").mockRejectedValue(new Error("boom"));
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());
    expect(screen.queryByTestId("library-version")).toBeNull();
  });

  it("still exposes the Folders landmark and an active All item", () => {
    renderLibrary();
    expect(screen.getByLabelText("Folders")).toBeTruthy();
    expect(screen.getByText("All")).toBeTruthy();
  });
});

describe("Add dropdown (File upload / Folder upload)", () => {
  it("opens the Add menu and uploads via the File upload item", async () => {
    // The Add control lives in the toolbar row, which only shows once the
    // collection has at least one paper (the true empty state shows just
    // EmptyDropzone, no duplicated Add). Seed one existing paper so the
    // toolbar (and Add) renders from the start.
    const backend = mockBackend();
    const existing = fakeDoc("l".repeat(64), "existing.pdf", "Existing Paper");
    backend.store(existing);
    const doc = fakeDoc("m".repeat(64), "via-menu.pdf", "Via Menu Paper");
    vi.spyOn(api, "uploadDoc").mockImplementation(async () => backend.store(doc));
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Existing Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /file upload/i }));

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("via-menu.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Via Menu Paper")).toBeTruthy());
  });

  it("filters a folder pick to PDFs before uploading (non-PDFs silently skipped)", async () => {
    const backend = mockBackend();
    const existing = fakeDoc("l".repeat(64), "existing.pdf", "Existing Paper");
    backend.store(existing);
    const doc1 = fakeDoc("n".repeat(64), "paper-one.pdf", "Folder Paper One");
    const doc2 = fakeDoc("o".repeat(64), "paper-two.pdf", "Folder Paper Two");
    const uploadDoc = vi.spyOn(api, "uploadDoc").mockImplementation(async (file: File) => {
      if (file.name === "paper-one.pdf") return backend.store(doc1);
      if (file.name === "paper-two.pdf") return backend.store(doc2);
      throw new Error("should never be called for a non-PDF");
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Existing Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /folder upload/i }));

    const readme = new File(["not a pdf"], "README.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("library-folder-input"), {
      target: { files: [pdfFile("paper-one.pdf"), readme, pdfFile("paper-two.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("Folder Paper One")).toBeTruthy());
    expect(screen.getByText("Folder Paper Two")).toBeTruthy();
    expect(uploadDoc).toHaveBeenCalledTimes(2);
  });

  it("does nothing when a picked folder has zero PDFs", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    const uploadDoc = vi.spyOn(api, "uploadDoc");
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /folder upload/i }));

    const readme = new File(["not a pdf"], "README.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("library-folder-input"), {
      target: { files: [readme] },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(uploadDoc).not.toHaveBeenCalled();
    expect(screen.getByText("Attention Is All You Need")).toBeTruthy();
  });
});
