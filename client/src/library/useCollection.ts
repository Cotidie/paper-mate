import { useCallback, useEffect, useRef, useState } from "react";
import { useBulkUpload } from "@/library/useBulkUpload";
import { useSettlePolling } from "@/library/useSettlePolling";
import { docToRow } from "@/library/row";
import { getLibrary, movePapers as apiMovePapers, type Doc, type Library } from "@/api/client";

/** Poll `GET /api/library` while any row is still `extracting` (Story 6.5):
 *  slow enough not to hammer the backend, fast enough to feel live. The cap
 *  stops a stuck status from spinning forever. */
const SETTLE_POLL_INTERVAL_MS = 1200;
const SETTLE_POLL_MAX = 60;

/** A row is still working iff its background extraction hasn't settled. */
function anyExtracting(lib: Library): boolean {
  return lib.papers.some((p) => p.status === "extracting");
}

/** A row is still analyzing iff its document-structure pass (opendataloader)
 *  hasn't produced `structure.json` yet. This runs AFTER metadata settles, so
 *  it keeps the poll alive past `extracting` until the analyzing indicator can
 *  clear (else polling would stop before structure finishes and the dots would
 *  freeze until a manual refresh). */
function anyAnalyzingStructure(lib: Library): boolean {
  return lib.papers.some((p) => p.structure_status === "analyzing");
}

type ToastVariant = "error" | "info";

interface UseCollectionOptions {
  /** Raise a page-level toast (upload-failure error / enrich-skipped notice). */
  onToast: (message: string, variant: ToastVariant) => void;
}

/**
 * The Library collection's data lifecycle (AD-9: the page fetches, the table
 * renders). Owns the authoritative `library` state and the interlocking
 * fetch / optimistic-add / settle-poll / batch-notice machine, plus the
 * bulk-upload pool (`useBulkUpload`). Exposes the state + `setLibrary` so the
 * page's inline-edit hook can reconcile a single row optimistically.
 *
 * The monotonic `fetchSeqRef` guard is load-bearing: only the most-recently
 * issued `getLibrary()` may apply, so a slow initial fetch can't land after
 * (and clobber) a faster post-batch reconcile or poll tick, or vice versa.
 */
export function useCollection({ onToast }: UseCollectionOptions) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const mountedRef = useRef(true);
  // Monotonic sequence: only the most-recently-issued `getLibrary()` may
  // apply its result, so a slow initial fetch can't land after (and clobber)
  // a faster post-batch reconcile or poll tick, or vice versa.
  const fetchSeqRef = useRef(0);
  // The current in-flight batch's resolved doc_ids awaiting an enrich-skipped
  // notice; scoped so a later batch never re-warns about older rows.
  const noticeBatchIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // StrictMode dev double-invokes effects (mount, cleanup, re-mount); reset
    // to true on setup, or the fake cleanup permanently latches this false
    // and the post-batch reconcile silently no-ops (see useBulkUpload).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const seq = ++fetchSeqRef.current;
    getLibrary()
      .then((lib) => {
        if (!cancelled && seq === fetchSeqRef.current) setLibrary(lib);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
          onToast("Couldn't load your library.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `onToast` is stable (the page memoizes it), so this stays a mount-only
    // fetch rather than re-fetching the whole library on every render.
  }, [onToast]);

  const handleResolved = useCallback(
    (doc: Doc, folderId: string | null) => {
      setLibrary((prev) => {
        const papers = prev?.papers ?? [];
        const row = docToRow(doc, papers);
        // Fix request: an upload dropped/picked while a folder is open lands
        // there instead of always Uncategorized (`docToRow`'s default). This
        // is just the immediate optimistic paint - the actual persistence
        // (`import_pdf` itself always lands Uncategorized, AD-L4/L2, a
        // background-task result with no folder context) happens once in
        // `handleBatchSettled`, AFTER its own reconcile, so it always wins.
        if (folderId !== null) row.folder_id = folderId;
        const existingIndex = papers.findIndex((p) => p.doc_id === doc.doc_id);
        const nextPapers =
          existingIndex >= 0 ? papers.map((p, i) => (i === existingIndex ? row : p)) : [...papers, row];
        // A re-upload of a trashed paper restores it (Story 7.5 AC-5, backend
        // `import_pdf`'s re-import branch clears `trashed`) - the pre-upload
        // snapshot in `prev.papers` still carries the `trashed` flag, so no
        // contract change is needed to detect it here.
        if (existingIndex >= 0 && papers[existingIndex].trashed) {
          onToast("restored from Trash", "info");
        }
        return { papers: nextPapers, folders: prev?.folders ?? [] };
      });
    },
    [onToast],
  );

  // Apply a freshly-fetched library, superseding any older in-flight fetch.
  const applyLibrary = useCallback((lib: Library) => {
    fetchSeqRef.current++;
    if (mountedRef.current) {
      setLibrary(lib);
      setLoadFailed(false);
    }
  }, []);

  // Raise the batch-scoped enrich-skipped notice once the batch has settled
  // (AC-8): a NON-error info toast, distinct from the upload-failure error.
  const settleNotices = useCallback(
    (lib: Library) => {
      const ids = noticeBatchIdsRef.current;
      if (ids.size === 0) return;
      const skipped = lib.papers.filter(
        (p) => ids.has(p.doc_id) && p.status === "enrich-skipped",
      ).length;
      ids.clear();
      if (skipped > 0) {
        onToast(
          skipped === 1 ? "Enrichment skipped." : `Enrichment skipped for ${skipped} papers.`,
          "info",
        );
      }
    },
    [onToast],
  );

  const settlePoll = useSettlePolling<Library>({
    fetch: getLibrary,
    isSettled: (lib) => !anyExtracting(lib) && !anyAnalyzingStructure(lib),
    onResult: applyLibrary,
    onSettled: settleNotices,
    // Capped without settling (a stuck row): still resolve the batch notice
    // from the last library seen so its IDs don't leak into a later batch.
    onMaxPolls: (lib) => {
      if (lib) settleNotices(lib);
      else noticeBatchIdsRef.current.clear();
    },
    intervalMs: SETTLE_POLL_INTERVAL_MS,
    maxPolls: SETTLE_POLL_MAX,
  });

  const handleBatchSettled = useCallback(
    (resolvedDocIds: string[], folderId: string | null) => {
      // One authoritative reconcile after the batch (AC-7); then, if any row
      // is still extracting, poll GET /api/library until every row settles.
      const seq = ++fetchSeqRef.current;
      getLibrary()
        .then((lib) => {
          if (!(mountedRef.current && seq === fetchSeqRef.current)) return;
          setLibrary(lib);
          setLoadFailed(false);
          resolvedDocIds.forEach((id) => noticeBatchIdsRef.current.add(id));
          if (anyExtracting(lib) || anyAnalyzingStructure(lib)) {
            settlePoll.start();
          } else {
            settleNotices(lib);
          }
          // Fix request: persist the batch's folder assignment AFTER this
          // reconcile (not from each `handleResolved`), so it always applies
          // last and can never be clobbered by the reconcile racing ahead of
          // it - `import_pdf` itself always lands a new doc Uncategorized
          // (AD-L4/L2, a background-task result with no folder context).
          if (folderId !== null && resolvedDocIds.length > 0) {
            apiMovePapers(resolvedDocIds, folderId)
              .then((moved) => {
                if (mountedRef.current) setLibrary(moved);
              })
              .catch(() => {
                onToast("Couldn't file the upload into that folder.", "error");
              });
          }
        })
        .catch(() => {
          // Best-effort: each resolved upload already landed via handleResolved.
        });
    },
    [settlePoll.start, settleNotices, onToast],
  );

  const handleFailed = useCallback(
    (count: number) => {
      onToast(count === 1 ? "Couldn't add this file." : `Couldn't add ${count} files.`, "error");
    },
    [onToast],
  );

  const { pending, uploadFiles } = useBulkUpload({
    onResolved: handleResolved,
    onBatchSettled: handleBatchSettled,
    onFailed: handleFailed,
  });

  return { library, setLibrary, loading, loadFailed, pending, uploadFiles };
}
