import { describe, it, expect, afterEach, vi } from "vitest";
import type { Ref } from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import ReaderPage from "@/reader/ReaderPage";
import * as api from "@/api/client";

// Fix regression: PageIndicator's Prev/Next handlers used to derive their
// target from `currentPage`, which only advances once the Reader's
// smooth-scroll animation visibly crosses a page boundary. A second click
// fired mid-animation recomputed the SAME target the first click already
// requested, so rapid clicking silently advanced only one page. This test
// replaces the (pdf.js-dependent) real Reader with a bare stub exposing a
// spy-able `jumpToPage`, so the fix (a ref tracking the last REQUESTED page,
// independent of the real Reader/IntersectionObserver timing) is verified
// without needing real scroll animation or pdf.js.
const jumpToPage = vi.fn();
// Captures the mounted stub's `onVisiblePageChange` so a test can simulate
// the Reader eventually reporting a page (as it would once a prior jump's
// animation settles), independent of the rapid clicks under test.
let reportVisiblePage: ((page: number) => void) | null = null;

// ReaderPage itself imports `pageNavTarget` from `@/render` (a pure clamp
// helper); stub the whole barrel so pdf.js never loads under jsdom.
vi.mock("@/render", () => ({
  pageNavTarget: (current: number, delta: number, pageCount: number) =>
    Math.min(pageCount, Math.max(1, current + delta)),
}));

vi.mock("@/components/Reader/Reader", () => ({
  default: ({
    ref,
    onVisiblePageChange,
  }: {
    ref?: Ref<{ jumpToPage: typeof jumpToPage }>;
    onVisiblePageChange?: (page: number) => void;
  }) => {
    if (ref && typeof ref !== "function") {
      ref.current = { jumpToPage };
    }
    reportVisiblePage = onVisiblePageChange ?? null;
    return <div data-testid="reader-backdrop" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  jumpToPage.mockClear();
});

const fakeDoc: api.Doc = {
  doc_id: "a".repeat(64),
  filename: "paper.pdf",
  title: "A Paper",
  page_count: 10,
  added: "2026-06-28T00:00:00+00:00",
  last_opened: "2026-06-28T00:00:00+00:00",
  authors_list: [],
  file_type: "pdf",
  status: "ready",
  schema_version: 1,
  structure_status: "ready",
};

function renderReaderAt(docId: string) {
  const router = createMemoryRouter(
    [
      { path: "/reader/:docId", element: <ReaderPage /> },
      { path: "/", element: <div data-testid="library-stub" /> },
    ],
    { initialEntries: [`/reader/${docId}`] },
  );
  render(<RouterProvider router={router} />);
}

describe("Prev/Next stays responsive across rapid clicks (nav responsiveness fix)", () => {
  it("two rapid Next clicks (before currentPage catches up) request consecutive pages, not the same one twice", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockResolvedValue([]);
    vi.spyOn(api, "markDocOpened").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    const next = screen.getByRole("button", { name: "Next page" });
    // `currentPage` state never advances here (the stub never calls
    // `onVisiblePageChange`), reproducing the mid-animation window where the
    // Reader hasn't yet reported the new page. The fix must still advance.
    fireEvent.click(next);
    fireEvent.click(next);

    expect(jumpToPage.mock.calls.map((c) => c[0])).toEqual([2, 3]);
  });

  it("two rapid Prev clicks likewise request consecutive pages backward", async () => {
    vi.spyOn(api, "getDoc").mockResolvedValue(fakeDoc);
    vi.spyOn(api, "getAnnotations").mockResolvedValue([]);
    vi.spyOn(api, "markDocOpened").mockResolvedValue(fakeDoc);
    renderReaderAt(fakeDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    const next = screen.getByRole("button", { name: "Next page" });
    const prev = screen.getByRole("button", { name: "Previous page" });
    // Advance to page 3, then simulate the Reader eventually reporting it
    // (as it would once that jump's animation settles) so Prev enables.
    fireEvent.click(next);
    fireEvent.click(next);
    act(() => reportVisiblePage?.(3));
    jumpToPage.mockClear();

    // The two Prev clicks below still fire before any further
    // `onVisiblePageChange` report — the same mid-animation window the fix
    // targets.
    fireEvent.click(prev);
    fireEvent.click(prev);

    expect(jumpToPage.mock.calls.map((c) => c[0])).toEqual([2, 1]);
  });

  it("clamps at the last page and does not exceed page_count on repeated Next clicks", async () => {
    const shortDoc = { ...fakeDoc, page_count: 2 };
    vi.spyOn(api, "getDoc").mockResolvedValue(shortDoc);
    vi.spyOn(api, "getAnnotations").mockResolvedValue([]);
    vi.spyOn(api, "markDocOpened").mockResolvedValue(shortDoc);
    renderReaderAt(shortDoc.doc_id);
    await waitFor(() => expect(screen.getByTestId("reader-backdrop")).toBeTruthy());

    const next = screen.getByRole("button", { name: "Next page" });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);

    expect(jumpToPage.mock.calls.map((c) => c[0])).toEqual([2, 2, 2]);
  });
});
