import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useBulkUpload } from "@/library/useBulkUpload";
import * as api from "@/api/client";

afterEach(() => {
  vi.restoreAllMocks();
});

function pdfFile(name: string) {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
}

const fakeDoc = (doc_id: string, filename: string): api.Doc => ({
  doc_id,
  filename,
  title: null,
  page_count: 1,
  added: "2026-07-05T00:00:00+00:00",
  last_opened: "2026-07-05T00:00:00+00:00",
  authors_list: [],
  file_type: "pdf",
  status: "ready",
  schema_version: 1,
});

describe("useBulkUpload", () => {
  it("streams pending rows immediately, resolves each, and settles once", async () => {
    const docA = fakeDoc("a".repeat(64), "a.pdf");
    const docB = fakeDoc("b".repeat(64), "b.pdf");
    const uploadDoc = vi
      .spyOn(api, "uploadDoc")
      .mockImplementation(async (file: File) => (file.name === "a.pdf" ? docA : docB));

    const onResolved = vi.fn();
    const onBatchSettled = vi.fn();
    const onFailed = vi.fn();

    const { result } = renderHook(() => useBulkUpload({ onResolved, onBatchSettled, onFailed }));

    act(() => {
      result.current.uploadFiles([pdfFile("a.pdf"), pdfFile("b.pdf")]);
    });

    expect(result.current.pending.map((p) => p.filename).sort()).toEqual(["a.pdf", "b.pdf"]);

    await waitFor(() => expect(result.current.pending.length).toBe(0));

    expect(uploadDoc).toHaveBeenCalledTimes(2);
    expect(onResolved).toHaveBeenCalledWith(docA, null);
    expect(onResolved).toHaveBeenCalledWith(docB, null);
    expect(onBatchSettled).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("passes the target folderId through to onResolved for every resolved file (fix request)", async () => {
    const docA = fakeDoc("a".repeat(64), "a.pdf");
    vi.spyOn(api, "uploadDoc").mockResolvedValue(docA);

    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useBulkUpload({ onResolved, onBatchSettled: vi.fn(), onFailed: vi.fn() }),
    );

    act(() => {
      result.current.uploadFiles([pdfFile("a.pdf")], "folder-1");
    });

    await waitFor(() => expect(result.current.pending.length).toBe(0));

    expect(onResolved).toHaveBeenCalledWith(docA, "folder-1");
  });

  it("isolates a per-file failure: the other file still resolves, failure count reported once", async () => {
    const goodDoc = fakeDoc("c".repeat(64), "good.pdf");
    vi.spyOn(api, "uploadDoc").mockImplementation(async (file: File) => {
      if (file.name === "bad.pdf") throw new Error("Could not read PDF file");
      return goodDoc;
    });

    const onResolved = vi.fn();
    const onBatchSettled = vi.fn();
    const onFailed = vi.fn();

    const { result } = renderHook(() => useBulkUpload({ onResolved, onBatchSettled, onFailed }));

    act(() => {
      result.current.uploadFiles([pdfFile("bad.pdf"), pdfFile("good.pdf")]);
    });

    await waitFor(() => expect(result.current.pending.length).toBe(0));

    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith(goodDoc, null);
    expect(onBatchSettled).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith(1);
  });

  it("caps concurrency at UPLOAD_CONCURRENCY (4) in flight", async () => {
    let live = 0;
    let maxLive = 0;
    const gates: Array<() => void> = [];
    vi.spyOn(api, "uploadDoc").mockImplementation(
      (file: File) =>
        new Promise<api.Doc>((resolve) => {
          live++;
          maxLive = Math.max(maxLive, live);
          gates.push(() => {
            live--;
            resolve(fakeDoc("d".repeat(64), file.name));
          });
        }),
    );

    const { result } = renderHook(() =>
      useBulkUpload({ onResolved: vi.fn(), onBatchSettled: vi.fn(), onFailed: vi.fn() }),
    );

    const files = Array.from({ length: 10 }, (_, i) => pdfFile(`f${i}.pdf`));
    act(() => {
      result.current.uploadFiles(files);
    });

    await waitFor(() => expect(gates.length).toBe(4));
    expect(maxLive).toBe(4);

    for (let released = 0; released < files.length; released++) {
      await waitFor(() => expect(gates.length).toBeGreaterThan(0));
      const release = gates.shift()!;
      act(() => release());
    }

    await waitFor(() => expect(result.current.pending.length).toBe(0));
    expect(maxLive).toBeLessThanOrEqual(4);
  });

  it("shares a single concurrency budget across two overlapping uploadFiles() batches", async () => {
    let live = 0;
    let maxLive = 0;
    const gates: Array<() => void> = [];
    vi.spyOn(api, "uploadDoc").mockImplementation(
      (file: File) =>
        new Promise<api.Doc>((resolve) => {
          live++;
          maxLive = Math.max(maxLive, live);
          gates.push(() => {
            live--;
            resolve(fakeDoc("e".repeat(64), file.name));
          });
        }),
    );

    const onBatchSettled = vi.fn();
    const { result } = renderHook(() =>
      useBulkUpload({ onResolved: vi.fn(), onBatchSettled, onFailed: vi.fn() }),
    );

    act(() => {
      result.current.uploadFiles([pdfFile("a1.pdf"), pdfFile("a2.pdf"), pdfFile("a3.pdf")]);
    });
    await waitFor(() => expect(gates.length).toBe(3));

    act(() => {
      result.current.uploadFiles([pdfFile("b1.pdf"), pdfFile("b2.pdf"), pdfFile("b3.pdf")]);
    });
    // Batch A already holds 3 of the 4 global slots; only 1 more of batch
    // B's items can start until a slot frees, even though B is its own
    // `uploadFiles()` call with its own would-be 4-wide pool.
    await waitFor(() => expect(gates.length).toBe(4));
    expect(maxLive).toBe(4);

    for (let released = 0; released < 6; released++) {
      await waitFor(() => expect(gates.length).toBeGreaterThan(0));
      const release = gates.shift()!;
      act(() => release());
    }

    await waitFor(() => expect(result.current.pending.length).toBe(0));
    await waitFor(() => expect(onBatchSettled).toHaveBeenCalledTimes(2));
    expect(maxLive).toBeLessThanOrEqual(4);
  });
});
