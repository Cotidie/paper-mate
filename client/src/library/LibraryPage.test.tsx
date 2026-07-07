import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import LibraryPage from "@/library/LibraryPage";
import * as api from "@/api/client";

afterEach(() => {
  cleanup();
  // A fake-timer test must never leak into the next (would hang every waitFor).
  vi.useRealTimers();
  // The drag-preview node is appended directly to document.body (outside
  // React's tree, so cleanup() above doesn't remove it) and only scheduled
  // for removal via setTimeout(0) - sweep up any stray one.
  document.querySelectorAll(".collection-table__drag-preview").forEach((el) => el.remove());
});
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
    await waitFor(() => expect(screen.getByText("1 files in Recent")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("2 files in Recent")).toBeTruthy());
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
    expect(screen.getByText("1 files in Recent")).toBeTruthy();

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("dup.pdf")] },
    });
    await waitFor(() => expect(screen.getAllByText("Duplicate Paper").length).toBe(1));
    expect(screen.getByText("1 files in Recent")).toBeTruthy();
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
    expect(screen.getByText("1 files in Recent")).toBeTruthy();
    expect(screen.queryByText("Drop PDFs here")).toBeNull();
  });

  it("navigates to /reader/:docId when the row's Open button is clicked", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());
    expect(screen.queryByTestId("reader-stub")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

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
    const titlesAfterResolve = Array.from(document.querySelectorAll(".collection-table__title-text")).map(
      (el) => el.textContent,
    );

    // Let the post-batch `getLibrary()` reconcile (AC-7) land too.
    await waitFor(() => expect(api.getLibrary).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    const titlesAfterReconcile = Array.from(document.querySelectorAll(".collection-table__title-text")).map(
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

describe("Metadata extraction settle-polling (Story 6.5)", () => {
  function docStatus(
    doc_id: string,
    filename: string,
    status: api.Doc["status"],
    title: string | null = null,
  ): api.Doc {
    return { ...fakeDoc(doc_id, filename, title), status };
  }

  function libRow(
    doc_id: string,
    status: api.CollectionRow["status"],
    title: string | null,
    filename: string,
  ): api.CollectionRow {
    return {
      doc_id,
      title,
      authors: null,
      added: "2026-07-05T00:00:00+00:00",
      file_type: "pdf",
      status,
      folder_id: null,
      trashed: false,
      order: 0,
      filename,
    };
  }

  it("polls getLibrary until an extracting row settles, updates it in place, notices the skip, and stops", async () => {
    vi.useFakeTimers();
    const id = "x".repeat(64);
    let call = 0;
    vi.spyOn(api, "getLibrary").mockImplementation(async () => {
      call++;
      if (call <= 1) return { papers: [], folders: [] }; // mount
      if (call <= 3) return { papers: [libRow(id, "extracting", null, "P.pdf")], folders: [] };
      return { papers: [libRow(id, "enrich-skipped", "Local Title", "P.pdf")], folders: [] };
    });
    vi.spyOn(api, "uploadDoc").mockResolvedValue(docStatus(id, "P.pdf", "extracting"));

    renderLibrary();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0))); // mount fetch

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("P.pdf")] },
    });
    // Upload resolves + batch reconcile (call 2, extracting) -> poll starts.
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(screen.getByText("Extracting")).toBeTruthy();

    // Poll tick 1 (call 3, still extracting).
    await act(async () => void (await vi.advanceTimersByTimeAsync(1200)));
    expect(screen.getByText("Extracting")).toBeTruthy();

    // Poll tick 2 (call 4, settled): row updates in place, info notice shown.
    await act(async () => void (await vi.advanceTimersByTimeAsync(1200)));
    expect(screen.getByText("Local Title")).toBeTruthy();
    expect(screen.queryByText("Extracting")).toBeNull();
    expect(screen.getByText("Enrichment skipped.")).toBeTruthy();

    // Polling has stopped: no further getLibrary calls however long we wait.
    const settledCalls = vi.mocked(api.getLibrary).mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
    expect(vi.mocked(api.getLibrary).mock.calls.length).toBe(settledCalls);

    vi.useRealTimers();
  });

  it("does not poll when the batch settles with no extracting rows (6.4 ready path unchanged)", async () => {
    // uploadDoc resolves to a `ready` doc and the reconcile shows no extracting
    // row, so the poll loop is never entered.
    const id = "y".repeat(64);
    const backend = mockBackend();
    vi.spyOn(api, "uploadDoc").mockImplementation(async () =>
      backend.store(docStatus(id, "R.pdf", "ready", "Ready Paper")),
    );
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Drop PDFs here")).toBeTruthy());

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("R.pdf")] },
    });
    await waitFor(() => expect(screen.getByText("Ready Paper")).toBeTruthy());

    // Exactly the mount fetch + the one post-batch reconcile — no poll.
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(api.getLibrary).mock.calls.length).toBe(2);
    expect(screen.queryByText(/Enrichment skipped/)).toBeNull();
  });

  it("still raises the enrich-skipped notice when polling caps on a permanently-stuck row", async () => {
    vi.useFakeTimers();
    const batchId = "b".repeat(64);
    const stuckId = "s".repeat(64); // a pre-existing row that never settles
    // After the batch settles, the library always has the batch row as
    // enrich-skipped PLUS a stuck extracting row, so polling never settles and
    // eventually hits the cap. onMaxPolls must still resolve the batch notice.
    vi.spyOn(api, "getLibrary").mockImplementation(async () => ({
      papers: [
        libRow(batchId, "enrich-skipped", "Batch Local Title", "batch.pdf"),
        libRow(stuckId, "extracting", null, "stuck.pdf"),
      ],
      folders: [],
    }));
    vi.spyOn(api, "uploadDoc").mockResolvedValue(docStatus(batchId, "batch.pdf", "extracting"));

    renderLibrary();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("batch.pdf")] },
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));

    // Run out the whole poll budget (60 * 1200ms) plus a buffer.
    await act(async () => void (await vi.advanceTimersByTimeAsync(60 * 1200 + 2000)));

    // The batch's enrich-skipped row is noticed even though the loop capped.
    expect(screen.getByText("Enrichment skipped.")).toBeTruthy();
    vi.useRealTimers();
  });

  it("renders a parse-failed row with its filename and lets it open (interactive)", async () => {
    const id = "z".repeat(64);
    vi.spyOn(api, "getLibrary").mockResolvedValue({
      papers: [libRow(id, "parse-failed", null, "poor-paper.pdf")],
      folders: [],
    });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("poor-paper")).toBeTruthy());
    expect(screen.getByText("-")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("reader-stub")).toBeTruthy());
  });
});

describe("Inline edit Title/Authors (Story 6.6)", () => {
  it("commits an edit optimistically and calls patchDoc with just that field", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    const patchDoc = vi.spyOn(api, "patchDoc").mockResolvedValue({
      ...fakeDoc(fakeRow.doc_id, "attention.pdf", "Corrected Title"),
      authors: fakeRow.authors,
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());

    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Corrected Title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Optimistic update lands immediately, before patchDoc resolves.
    expect(screen.getByText("Corrected Title")).toBeTruthy();
    expect(patchDoc).toHaveBeenCalledWith(fakeRow.doc_id, { title: "Corrected Title" });

    await waitFor(() => expect(screen.getByText("Corrected Title")).toBeTruthy());
  });

  it("reverts the row and shows an error toast when patchDoc rejects", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    vi.spyOn(api, "patchDoc").mockRejectedValue(new Error("boom"));
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());

    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    const input = screen.getByDisplayValue("Attention Is All You Need") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Will Fail" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Will Fail")).toBeTruthy(); // optimistic

    await waitFor(() => expect(screen.getByText("Couldn't save that change.")).toBeTruthy());
    expect(screen.getByText("Attention Is All You Need")).toBeTruthy(); // reverted
    expect(screen.queryByText("Will Fail")).toBeNull();
  });

  it("an older PATCH resolving after a newer one does not clobber the newer result (Codex review follow-up)", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [fakeRow], folders: [] });
    let resolveFirst: (doc: api.Doc) => void = () => {};
    let resolveSecond: (doc: api.Doc) => void = () => {};
    const patchDoc = vi
      .spyOn(api, "patchDoc")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeTruthy());

    // First edit commits "First Edit"; its PATCH (#1) is left unresolved.
    const cell = screen.getByText("Attention Is All You Need");
    fireEvent.click(cell.closest("tr")!); // arm
    fireEvent.click(cell); // edit
    fireEvent.change(screen.getByDisplayValue("Attention Is All You Need"), {
      target: { value: "First Edit" },
    });
    fireEvent.keyDown(screen.getByDisplayValue("First Edit"), { key: "Enter" });
    expect(screen.getByText("First Edit")).toBeTruthy();

    // A second edit to the SAME field lands before PATCH #1 resolves. The
    // row is still armed from the first cycle (commit doesn't change arm
    // state), so a single click re-enters edit directly.
    fireEvent.click(screen.getByText("First Edit"));
    fireEvent.change(screen.getByDisplayValue("First Edit"), { target: { value: "Second Edit" } });
    fireEvent.keyDown(screen.getByDisplayValue("Second Edit"), { key: "Enter" });
    expect(screen.getByText("Second Edit")).toBeTruthy();

    // The newer request (#2) resolves first.
    resolveSecond({
      ...fakeDoc(fakeRow.doc_id, "attention.pdf", "Second Edit"),
      authors: fakeRow.authors,
    });
    await waitFor(() => expect(screen.getByText("Second Edit")).toBeTruthy());

    // The older, superseded request (#1) resolves late. It must not clobber
    // the newer, already-reconciled value.
    resolveFirst({
      ...fakeDoc(fakeRow.doc_id, "attention.pdf", "First Edit"),
      authors: fakeRow.authors,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByText("Second Edit")).toBeTruthy();
    expect(screen.queryByText("First Edit")).toBeNull();
    expect(patchDoc).toHaveBeenCalledTimes(2);
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

describe("Folder panel wiring (Story 7.1)", () => {
  it("renders folders returned by getLibrary through the real FolderPanel", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({
      papers: [],
      folders: [{ id: "f1", name: "My Folder", parent_id: null }],
    });
    renderLibrary();

    await waitFor(() => expect(screen.getByText("My Folder")).toBeTruthy());
    expect(screen.getByText("Uncategorized")).toBeTruthy();
  });
});

describe("Folder filter + move (Story 7.2)", () => {
  const folderA = { id: "folder-a", name: "Folder A", parent_id: null };

  function libraryRow(overrides: Partial<api.CollectionRow>): api.CollectionRow {
    return {
      doc_id: "p".repeat(64),
      title: "A Paper",
      authors: null,
      added: "2026-07-06T00:00:00+00:00",
      file_type: "pdf",
      status: "ready",
      folder_id: null,
      trashed: false,
      order: 0,
      ...overrides,
    };
  }

  it("REGRESSION: selecting a folder filters visible rows to that folder's papers only", async () => {
    const uncategorized = libraryRow({ doc_id: "u".repeat(64), title: "Uncategorized Paper", order: 0 });
    const inFolder = libraryRow({
      doc_id: "f".repeat(64),
      title: "Foldered Paper",
      folder_id: folderA.id,
      order: 1,
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [uncategorized, inFolder], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Uncategorized Paper")).toBeTruthy());
    expect(screen.getByText("Foldered Paper")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Folder A" }));

    expect(screen.getByText("Foldered Paper")).toBeTruthy();
    expect(screen.queryByText("Uncategorized Paper")).toBeNull();
  });

  it("All shows every non-trashed paper regardless of folder", async () => {
    const uncategorized = libraryRow({ doc_id: "u".repeat(64), title: "Uncategorized Paper", order: 0 });
    const inFolder = libraryRow({
      doc_id: "f".repeat(64),
      title: "Foldered Paper",
      folder_id: folderA.id,
      order: 1,
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [uncategorized, inFolder], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Uncategorized Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Folder A" }));
    fireEvent.click(screen.getByText("All"));

    expect(screen.getByText("Uncategorized Paper")).toBeTruthy();
    expect(screen.getByText("Foldered Paper")).toBeTruthy();
  });

  it("Uncategorized shows only papers with no folder", async () => {
    const uncategorized = libraryRow({ doc_id: "u".repeat(64), title: "Uncategorized Paper", order: 0 });
    const inFolder = libraryRow({
      doc_id: "f".repeat(64),
      title: "Foldered Paper",
      folder_id: folderA.id,
      order: 1,
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [uncategorized, inFolder], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Uncategorized Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));

    expect(screen.getByText("Uncategorized Paper")).toBeTruthy();
    expect(screen.queryByText("Foldered Paper")).toBeNull();
  });

  it("the toolbar count reflects the SELECTED view, not the whole library (fix request)", async () => {
    const uncategorized = libraryRow({ doc_id: "u".repeat(64), title: "Uncategorized Paper", order: 0 });
    const inFolder = libraryRow({
      doc_id: "f".repeat(64),
      title: "Foldered Paper",
      folder_id: folderA.id,
      order: 1,
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [uncategorized, inFolder], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("2 files in Recent")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));
    expect(screen.getByText("1 files in Uncategorized")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Folder A" }));
    expect(screen.getByText("1 files in Folder A")).toBeTruthy();

    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("2 files in library")).toBeTruthy();
  });

  it("Ctrl+click-checking a paper then using the toolbar Move button updates membership and it leaves the current (Uncategorized) view", async () => {
    const paper = libraryRow({ doc_id: "m".repeat(64), title: "Movable Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [folderA] });
    const movePapers = vi
      .spyOn(api, "movePapers")
      .mockResolvedValue({ papers: [{ ...paper, folder_id: folderA.id }], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Movable Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));
    expect(screen.getByText("Movable Paper")).toBeTruthy();

    fireEvent.click(screen.getByText("Movable Paper").closest("tr")!, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Folder A" }));

    expect(movePapers).toHaveBeenCalledWith([paper.doc_id], folderA.id);
    await waitFor(() => expect(screen.queryByText("Movable Paper")).toBeNull());
  });

  it("the toolbar Move button is disabled with nothing checked, enabled once a row is checked", async () => {
    const paper = libraryRow({ doc_id: "m".repeat(64), title: "Movable Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Movable Paper")).toBeTruthy());

    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Movable Paper").closest("tr")!, { ctrlKey: true });
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a plain (non-Ctrl) single click also enables Move and moves that one file (fix request)", async () => {
    const paper = libraryRow({ doc_id: "m".repeat(64), title: "Movable Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [folderA] });
    const movePapers = vi
      .spyOn(api, "movePapers")
      .mockResolvedValue({ papers: [{ ...paper, folder_id: folderA.id }], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Movable Paper")).toBeTruthy());

    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Movable Paper").closest("tr")!);
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Folder A" }));
    expect(movePapers).toHaveBeenCalledWith([paper.doc_id], folderA.id);
  });

  it("a plain click on another row cancels a multi-selection down to just that row (fix: root-caused by two disjoint selection states)", async () => {
    const first = libraryRow({ doc_id: "1".repeat(64), title: "First Paper", order: 0 });
    const second = libraryRow({ doc_id: "2".repeat(64), title: "Second Paper", order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [first, second], folders: [folderA] });
    const movePapers = vi
      .spyOn(api, "movePapers")
      .mockResolvedValue({ papers: [first, { ...second, folder_id: folderA.id }], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("First Paper")).toBeTruthy());

    const firstRow = screen.getByText("First Paper").closest("tr")!;
    const secondRow = screen.getByText("Second Paper").closest("tr")!;
    fireEvent.click(firstRow, { ctrlKey: true });
    fireEvent.click(secondRow, { ctrlKey: true });
    expect(firstRow.hasAttribute("data-checked")).toBe(true);
    expect(secondRow.hasAttribute("data-checked")).toBe(true);

    // A plain click on the second row must cancel the multi-selection and
    // leave only the clicked row selected - previously the first row stayed
    // highlighted because the plain click only updated a separate, unlifted
    // "armed" state that never touched the checked set.
    fireEvent.click(secondRow);
    expect(firstRow.hasAttribute("data-checked")).toBe(false);
    expect(secondRow.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Folder A" }));
    expect(movePapers).toHaveBeenCalledWith([second.doc_id], folderA.id);
  });

  it("Shift+click range-selects then toolbar Move moves the whole range and clears the selection (Story 7.3, AC-4/AC-5)", async () => {
    const first = libraryRow({ doc_id: "1".repeat(64), title: "First Paper", order: 0 });
    const second = libraryRow({ doc_id: "2".repeat(64), title: "Second Paper", order: 1 });
    const third = libraryRow({ doc_id: "3".repeat(64), title: "Third Paper", order: 2 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [first, second, third], folders: [folderA] });
    const movePapers = vi.spyOn(api, "movePapers").mockResolvedValue({
      papers: [
        { ...first, folder_id: folderA.id },
        { ...second, folder_id: folderA.id },
        { ...third, folder_id: folderA.id },
      ],
      folders: [folderA],
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("First Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));
    fireEvent.click(screen.getByText("First Paper").closest("tr")!); // anchor = first row
    fireEvent.click(screen.getByText("Third Paper").closest("tr")!, { shiftKey: true }); // range first..third

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Folder A" }));

    expect(movePapers).toHaveBeenCalledTimes(1);
    expect(new Set(movePapers.mock.calls[0][0])).toEqual(
      new Set([first.doc_id, second.doc_id, third.doc_id]),
    );
    await waitFor(() => expect(screen.queryByText("First Paper")).toBeNull());
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("dragging a row onto a folder entry moves it (drag-to-folder fix request)", async () => {
    const paper = libraryRow({ doc_id: "m".repeat(64), title: "Movable Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [folderA] });
    const movePapers = vi
      .spyOn(api, "movePapers")
      .mockResolvedValue({ papers: [{ ...paper, folder_id: folderA.id }], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Movable Paper")).toBeTruthy());

    const row = screen.getByText("Movable Paper").closest("tr")!;
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? "",
      types: ["application/x-papermate-move"],
      effectAllowed: "",
      setDragImage: () => {},
    };
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.drop(screen.getByText("Folder A"), { dataTransfer });

    expect(movePapers).toHaveBeenCalledWith([paper.doc_id], folderA.id);
  });

  it("entering an empty folder in a non-empty library keeps the table layout (no EmptyDropzone flash) and shows the empty-folder line", async () => {
    const uncategorized = libraryRow({ doc_id: "u".repeat(64), title: "Uncategorized Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [uncategorized], folders: [folderA] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Uncategorized Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Folder A" }));

    expect(screen.getByText("No papers in this folder.")).toBeTruthy();
    expect(screen.queryByTestId("empty-dropzone")).toBeNull();
    // Toolbar stays mounted (table layout persists) but now counts the
    // SELECTED folder, not the whole library (fix request).
    expect(screen.getByText("0 files in Folder A")).toBeTruthy();
  });

  it("a just-uploaded pending row does not show under an unrelated selected folder", async () => {
    const uncategorized = libraryRow({ doc_id: "u".repeat(64), title: "Uncategorized Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [uncategorized], folders: [folderA] });
    vi.spyOn(api, "uploadDoc").mockReturnValue(new Promise(() => {})); // never resolves in this test
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Uncategorized Paper")).toBeTruthy());

    // Folder A is empty; select it (table layout stays, since total papers > 0).
    fireEvent.click(screen.getByRole("button", { name: "Folder A" }));
    expect(screen.getByText("No papers in this folder.")).toBeTruthy();

    fireEvent.change(screen.getByTestId("library-add-input"), {
      target: { files: [pdfFile("mid-upload.pdf")] },
    });

    // The pending row lands Uncategorized visually — must not appear under Folder A.
    expect(screen.queryByText("mid-upload")).toBeNull();
    expect(screen.getByText("No papers in this folder.")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
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

describe("Display, Sort controls (Story 7.4)", () => {
  function libraryRow(overrides: Partial<api.CollectionRow>): api.CollectionRow {
    return {
      doc_id: "p".repeat(64),
      title: "A Paper",
      authors: null,
      added: "2026-07-06T00:00:00+00:00",
      file_type: "pdf",
      status: "ready",
      folder_id: null,
      trashed: false,
      order: 0,
      ...overrides,
    };
  }

  function titleTexts(): (string | null)[] {
    return Array.from(document.querySelectorAll(".collection-table__title-text")).map((el) => el.textContent);
  }

  it("Display: hiding a column omits its header and cells without touching the others", async () => {
    const paper = libraryRow({ doc_id: "1".repeat(64), title: "Only Paper", authors: "Some Author" });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Only Paper")).toBeTruthy());
    expect(screen.getByText("Some Author")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Authors" }));

    expect(screen.queryByRole("columnheader", { name: "Authors" })).toBeNull();
    expect(screen.queryByText("Some Author")).toBeNull();
    expect(screen.getByText("Only Paper")).toBeTruthy();
  });

  it("Column header dropdown: Hide from a header's own menu omits that column (fix request: clickable headers)", async () => {
    const paper = libraryRow({ doc_id: "1".repeat(64), title: "Only Paper", authors: "Some Author" });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Only Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Authors" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));

    expect(screen.queryByRole("columnheader", { name: "Authors" })).toBeNull();
    expect(screen.queryByText("Some Author")).toBeNull();
  });

  it("Column header dropdown: Sort DESC from a header's own menu reorders rows", async () => {
    const alpha = libraryRow({ doc_id: "1".repeat(64), title: "Alpha Paper", order: 0 });
    const beta = libraryRow({ doc_id: "2".repeat(64), title: "Beta Paper", order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [alpha, beta], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Alpha Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort DESC" }));

    expect(titleTexts()).toEqual(["Beta Paper", "Alpha Paper"]);
  });

  it("Sort: reorders the rendered rows by the chosen column and direction", async () => {
    const alpha = libraryRow({ doc_id: "1".repeat(64), title: "Beta Paper", order: 0 });
    const beta = libraryRow({ doc_id: "2".repeat(64), title: "Alpha Paper", order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [alpha, beta], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Beta Paper")).toBeTruthy());
    expect(titleTexts()).toEqual(["Beta Paper", "Alpha Paper"]);

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ASC" }));

    expect(titleTexts()).toEqual(["Alpha Paper", "Beta Paper"]);
  });

  it("Sort: reload returns to the backend response order (not persisted)", async () => {
    const alpha = libraryRow({ doc_id: "1".repeat(64), title: "Beta Paper", order: 0 });
    const beta = libraryRow({ doc_id: "2".repeat(64), title: "Alpha Paper", order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [alpha, beta], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Beta Paper")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ASC" }));
    expect(titleTexts()).toEqual(["Alpha Paper", "Beta Paper"]);

    cleanup();
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Beta Paper")).toBeTruthy());
    expect(titleTexts()).toEqual(["Beta Paper", "Alpha Paper"]);
  });

  it("Sort does NOT clear a prior selection", async () => {
    const first = libraryRow({ doc_id: "1".repeat(64), title: "First Paper", order: 0 });
    const second = libraryRow({ doc_id: "2".repeat(64), title: "Second Paper", order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [first, second], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("First Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("First Paper").closest("tr")!);
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ASC" }));

    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a Shift+click range AFTER a sort selects the visually-contiguous run and toolbar Move moves that set (7.3-follows-sort contract)", async () => {
    const alpha = libraryRow({ doc_id: "1".repeat(64), title: "Charlie Paper", order: 0 });
    const beta = libraryRow({ doc_id: "2".repeat(64), title: "Alpha Paper", order: 1 });
    const gamma = libraryRow({ doc_id: "3".repeat(64), title: "Beta Paper", order: 2 });
    const folderA = { id: "folder-a", name: "Folder A", parent_id: null };
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [alpha, beta, gamma], folders: [folderA] });
    const movePapers = vi.spyOn(api, "movePapers").mockResolvedValue({
      papers: [
        { ...alpha, folder_id: folderA.id },
        { ...beta, folder_id: folderA.id },
        { ...gamma, folder_id: folderA.id },
      ],
      folders: [folderA],
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Charlie Paper")).toBeTruthy());
    // Response order: Charlie, Alpha, Beta. Sort by Title asc -> Alpha, Beta, Charlie.
    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ASC" }));
    expect(titleTexts()).toEqual(["Alpha Paper", "Beta Paper", "Charlie Paper"]);

    // Visually-contiguous range Alpha..Beta (NOT the response-order neighbors).
    fireEvent.click(screen.getByText("Alpha Paper").closest("tr")!);
    fireEvent.click(screen.getByText("Beta Paper").closest("tr")!, { shiftKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Folder A" }));

    expect(new Set(movePapers.mock.calls[0][0])).toEqual(new Set([beta.doc_id, gamma.doc_id]));
  });
});

describe("Trash (Story 7.5)", () => {
  function libraryRow(overrides: Partial<api.CollectionRow>): api.CollectionRow {
    return {
      doc_id: "p".repeat(64),
      title: "A Paper",
      authors: null,
      added: "2026-07-06T00:00:00+00:00",
      file_type: "pdf",
      status: "ready",
      folder_id: null,
      trashed: false,
      order: 0,
      ...overrides,
    };
  }

  it("toolbar Delete trashes the checked selection and clears it", async () => {
    const paper = libraryRow({ doc_id: "d".repeat(64), title: "Doomed Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [] });
    const trashPapers = vi
      .spyOn(api, "trashPapers")
      .mockResolvedValue({ papers: [{ ...paper, trashed: true }], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Doomed Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("Doomed Paper").closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(trashPapers).toHaveBeenCalledWith([paper.doc_id]);
    await waitFor(() => expect(screen.queryByText("Doomed Paper")).toBeNull());
    // Selection cleared: Move/Delete disable again once nothing is checked
    // (there is nothing left visible to check, but the toolbar buttons
    // reflect an empty selectedIds set either way).
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the toolbar Delete button is disabled with nothing checked, enabled once a row is checked", async () => {
    const paper = libraryRow({ doc_id: "d".repeat(64), title: "Doomed Paper", order: 0 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Doomed Paper")).toBeTruthy());

    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Doomed Paper").closest("tr")!);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("selecting Trash shows trashed rows with no Open button, a disabled toolbar Restore/Purge, and hides Move/Delete", async () => {
    const trashedPaper = libraryRow({ doc_id: "t".repeat(64), title: "Trashed Paper", trashed: true });
    const liveePaper = libraryRow({ doc_id: "l".repeat(64), title: "Live Paper", trashed: false, order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [trashedPaper, liveePaper], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Live Paper")).toBeTruthy());
    expect(screen.queryByText("Trashed Paper")).toBeNull();

    fireEvent.click(screen.getByText("Trash"));

    expect(screen.getByText("Trashed Paper")).toBeTruthy();
    expect(screen.queryByText("Live Paper")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect((screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Purge" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    fireEvent.click(screen.getByText("Trashed Paper").closest("tr")!);
    expect((screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Purge" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Trash lens empty copy reads exactly 'Trash is empty.'", async () => {
    vi.spyOn(api, "getLibrary").mockResolvedValue({
      papers: [libraryRow({ doc_id: "l".repeat(64), title: "Live Paper" })],
      folders: [],
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Live Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("Trash"));

    expect(screen.getByText("Trash is empty.")).toBeTruthy();
  });

  it("toolbar Restore acts on the selection, removes the row from the Trash view, and fires the restored-from-Trash notice", async () => {
    const trashedPaper = libraryRow({ doc_id: "t".repeat(64), title: "Trashed Paper", trashed: true });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [trashedPaper], folders: [] });
    const restorePapers = vi
      .spyOn(api, "restorePapers")
      .mockResolvedValue({ papers: [{ ...trashedPaper, trashed: false }], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("No recent papers.")).toBeTruthy());

    fireEvent.click(screen.getByText("Trash"));
    await waitFor(() => expect(screen.getByText("Trashed Paper")).toBeTruthy());
    fireEvent.click(screen.getByText("Trashed Paper").closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(restorePapers).toHaveBeenCalledWith([trashedPaper.doc_id]);
    await waitFor(() => expect(screen.queryByText("Trashed Paper")).toBeNull());
    expect(screen.getByText("restored from Trash")).toBeTruthy();
  });

  it("toolbar Purge opens a confirm over the selection; confirming calls purgeDoc and removes the row; Esc cancels", async () => {
    const trashedPaper = libraryRow({ doc_id: "t".repeat(64), title: "Trashed Paper", trashed: true });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [trashedPaper], folders: [] });
    const purgeDoc = vi.spyOn(api, "purgeDoc").mockResolvedValue({ papers: [], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Trash")).toBeTruthy());

    fireEvent.click(screen.getByText("Trash"));
    await waitFor(() => expect(screen.getByText("Trashed Paper")).toBeTruthy());
    fireEvent.click(screen.getByText("Trashed Paper").closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "Purge" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText('Purge "Trashed Paper"')).toBeTruthy();
    expect(purgeDoc).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(purgeDoc).not.toHaveBeenCalled();
    expect(screen.getByText("Trashed Paper")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Purge" }));
    const confirmButton = within(screen.getByRole("dialog")).getByRole("button", { name: "Purge" });
    fireEvent.click(confirmButton);

    expect(purgeDoc).toHaveBeenCalledWith(trashedPaper.doc_id);
    await waitFor(() => expect(screen.queryByText("Trashed Paper")).toBeNull());
  });

  it("toolbar Purge purges every selected row (bulk, fix request)", async () => {
    const paperA = libraryRow({ doc_id: "a".repeat(64), title: "Trashed A", trashed: true, order: 0 });
    const paperB = libraryRow({ doc_id: "b".repeat(64), title: "Trashed B", trashed: true, order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paperA, paperB], folders: [] });
    const purgeDoc = vi.spyOn(api, "purgeDoc").mockResolvedValue({ papers: [], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Trash")).toBeTruthy());

    fireEvent.click(screen.getByText("Trash"));
    await waitFor(() => expect(screen.getByText("Trashed B")).toBeTruthy());
    fireEvent.click(screen.getByText("Trashed A").closest("tr")!, { shiftKey: true });
    fireEvent.click(screen.getByText("Trashed B").closest("tr")!, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Purge" }));

    expect(within(screen.getByRole("dialog")).getByText("Purge 2 papers")).toBeTruthy();
    const confirmButton = within(screen.getByRole("dialog")).getByRole("button", { name: "Purge" });
    fireEvent.click(confirmButton);

    expect(purgeDoc).toHaveBeenCalledWith(paperA.doc_id);
    expect(purgeDoc).toHaveBeenCalledWith(paperB.doc_id);
  });

  it("the sidebar Empty Trash icon purges every trashed paper (fix request)", async () => {
    const paperA = libraryRow({ doc_id: "a".repeat(64), title: "Trashed A", trashed: true, order: 0 });
    const paperB = libraryRow({ doc_id: "b".repeat(64), title: "Trashed B", trashed: true, order: 1 });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paperA, paperB], folders: [] });
    const purgeDoc = vi.spyOn(api, "purgeDoc").mockResolvedValue({ papers: [], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Trash")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
    expect(within(screen.getByRole("dialog")).getByText("Purge 2 papers")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Purge" }));

    expect(purgeDoc).toHaveBeenCalledWith(paperA.doc_id);
    expect(purgeDoc).toHaveBeenCalledWith(paperB.doc_id);
  });

  it("a re-upload whose doc_id was trashed fires the restored-from-Trash notice", async () => {
    const doc_id = "r".repeat(64);
    const trashedPaper = libraryRow({ doc_id, title: "Old Title", trashed: true, folder_id: null });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [trashedPaper], folders: [] });
    vi.spyOn(api, "uploadDoc").mockResolvedValue({
      doc_id,
      filename: "old.pdf",
      title: "Old Title",
      page_count: 1,
      added: "2026-07-06T00:00:00+00:00",
      last_opened: "2026-07-07T00:00:00+00:00",
      file_type: "pdf",
      status: "ready",
      schema_version: 1,
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Trash")).toBeTruthy());

    const input = screen.getByTestId("library-add-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdfFile("old.pdf")] } });

    await waitFor(() => expect(screen.getByText("restored from Trash")).toBeTruthy());
  });
});

describe("Recent (Story 7.7)", () => {
  function libraryRow(overrides: Partial<api.CollectionRow>): api.CollectionRow {
    return {
      doc_id: "p".repeat(64),
      title: "A Paper",
      authors: null,
      added: "2026-07-06T00:00:00+00:00",
      last_opened: "2026-07-06T00:00:00+00:00",
      file_type: "pdf",
      status: "ready",
      folder_id: null,
      trashed: false,
      order: 0,
      ...overrides,
    };
  }

  const DAY_MS = 24 * 60 * 60 * 1000;

  it("is the default landing view: opens on Recent without any sidebar click", async () => {
    const paper = libraryRow({ doc_id: "d".repeat(64), title: "Landing Paper" });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [paper], folders: [] });
    renderLibrary();

    // The toolbar count names the active lens, and the Recent sidebar item is
    // highlighted - both before the user touches the panel.
    await waitFor(() => expect(screen.getByText("1 files in Recent")).toBeTruthy());
    expect(screen.getByText("Landing Paper")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Recent" }).classList.contains("library-folder-panel__item--active"),
    ).toBe(true);
  });

  it("selecting Recent shows the last-opened rows most-recent-first and labels the toolbar count", async () => {
    const now = Date.now();
    const older = libraryRow({
      doc_id: "o".repeat(64),
      title: "Older Paper",
      last_opened: new Date(now - 4 * DAY_MS).toISOString(),
    });
    const newer = libraryRow({
      doc_id: "n".repeat(64),
      title: "Newer Paper",
      last_opened: new Date(now).toISOString(),
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [older, newer], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Older Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("Recent"));

    const rows = screen
      .getAllByRole("row")
      .filter((r) => r.querySelector("td") && !r.classList.contains("collection-table__group-header"));
    expect(rows[0].textContent).toContain("Newer Paper");
    expect(rows[rows.length - 1].textContent).toContain("Older Paper");
    expect(screen.getByText("2 files in Recent")).toBeTruthy();
  });

  it("has no numeric cap: every paper within the last month shows, not just the most-recent 50", async () => {
    const now = Date.now();
    const papers = Array.from({ length: 60 }, (_, i) =>
      libraryRow({
        doc_id: i.toString().padStart(64, "0"),
        title: `Paper ${i}`,
        last_opened: new Date(now - i * 1000).toISOString(),
        order: i,
      }),
    );
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers, folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Paper 0")).toBeTruthy());

    fireEvent.click(screen.getByText("Recent"));

    expect(screen.getByText("60 files in Recent")).toBeTruthy();
  });

  it("excludes a paper last opened more than a month ago (rolling window, post-review scope)", async () => {
    const now = Date.now();
    const recent = libraryRow({
      doc_id: "r".repeat(64),
      title: "Recent Paper",
      last_opened: new Date(now).toISOString(),
    });
    const tooOld = libraryRow({
      doc_id: "t".repeat(64),
      title: "Ancient Paper",
      last_opened: new Date(now - 40 * DAY_MS).toISOString(),
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [recent, tooOld], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Recent Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("Recent"));

    expect(screen.getByText("Recent Paper")).toBeTruthy();
    expect(screen.queryByText("Ancient Paper")).toBeNull();
    expect(screen.getByText("1 files in Recent")).toBeTruthy();
  });

  it("groups Recent rows under Today/Yesterday/Last week/Last month date-bucket headers, in order", async () => {
    const now = Date.now();
    const today = libraryRow({
      doc_id: "1".repeat(64),
      title: "Today Paper",
      last_opened: new Date(now).toISOString(),
    });
    const yesterday = libraryRow({
      doc_id: "2".repeat(64),
      title: "Yesterday Paper",
      last_opened: new Date(now - 1 * DAY_MS).toISOString(),
    });
    const lastWeek = libraryRow({
      doc_id: "3".repeat(64),
      title: "Last Week Paper",
      last_opened: new Date(now - 4 * DAY_MS).toISOString(),
    });
    const lastMonth = libraryRow({
      doc_id: "4".repeat(64),
      title: "Last Month Paper",
      last_opened: new Date(now - 15 * DAY_MS).toISOString(),
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({
      papers: [today, yesterday, lastWeek, lastMonth],
      folders: [],
    });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Today Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("Recent"));

    const rows = screen.getAllByRole("row").filter((r) => r.textContent && r.textContent.trim() !== "");
    const order = rows.map((r) => r.textContent ?? "");
    const indexOf = (needle: string) => order.findIndex((text) => text.includes(needle));
    expect(indexOf("Today")).toBeGreaterThanOrEqual(0);
    expect(indexOf("Today")).toBeLessThan(indexOf("Today Paper"));
    expect(indexOf("Yesterday")).toBeLessThan(indexOf("Yesterday Paper"));
    expect(indexOf("Last week")).toBeLessThan(indexOf("Last Week Paper"));
    expect(indexOf("Last month")).toBeLessThan(indexOf("Last Month Paper"));
    // Buckets appear in recency order.
    expect(indexOf("Today")).toBeLessThan(indexOf("Yesterday"));
    expect(indexOf("Yesterday")).toBeLessThan(indexOf("Last week"));
    expect(indexOf("Last week")).toBeLessThan(indexOf("Last month"));
  });

  it("does not render date-bucket headers once a column sort is active", async () => {
    const now = Date.now();
    const today = libraryRow({
      doc_id: "1".repeat(64),
      title: "Today Paper",
      last_opened: new Date(now).toISOString(),
    });
    const yesterday = libraryRow({
      doc_id: "2".repeat(64),
      title: "Yesterday Paper",
      last_opened: new Date(now - 1 * DAY_MS).toISOString(),
    });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [today, yesterday], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Today Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("Recent"));
    expect(screen.getByText("Today")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ASC" }));

    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("Yesterday")).toBeNull();
  });

  it("Recent lens empty copy reads exactly 'No recent papers.'", async () => {
    // Every untrashed paper appears in Recent (Option A, AC-6), so the only
    // way the lens is empty with a non-empty library is when every paper is
    // trashed.
    const trashedPaper = libraryRow({ doc_id: "t".repeat(64), title: "Trashed Paper", trashed: true });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [trashedPaper], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Recent")).toBeTruthy());

    fireEvent.click(screen.getByText("Recent"));

    expect(screen.getByText("No recent papers.")).toBeTruthy();
  });

  it("excludes trashed papers from Recent", async () => {
    const trashedPaper = libraryRow({ doc_id: "t".repeat(64), title: "Trashed Paper", trashed: true });
    const livePaper = libraryRow({ doc_id: "l".repeat(64), title: "Live Paper" });
    vi.spyOn(api, "getLibrary").mockResolvedValue({ papers: [trashedPaper, livePaper], folders: [] });
    renderLibrary();
    await waitFor(() => expect(screen.getByText("Live Paper")).toBeTruthy());

    fireEvent.click(screen.getByText("Recent"));

    expect(screen.getByText("Live Paper")).toBeTruthy();
    expect(screen.queryByText("Trashed Paper")).toBeNull();
  });
});
