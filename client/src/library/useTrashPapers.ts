import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  trashPapers as apiTrashPapers,
  restorePapers as apiRestorePapers,
  purgeDoc as apiPurgeDoc,
  type CollectionRow,
  type Library,
} from "@/api/client";

interface UseTrashPapersOptions {
  /** Reconcile the collection (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level toast on failure, or the AC-3 restore notice. */
  onToast: (message: string, variant: "error" | "info") => void;
}

/**
 * The trash/restore/purge lifecycle (Story 7.5, AC-1/3/4) against
 * `POST /api/library/trash|restore` and `DELETE /api/docs/{id}`. Mirrors
 * `useMovePapers`: optimistic update, reconciled from the returned `Library`
 * on resolve, reverted on failure. A single monotonic `opSeqRef` is shared
 * across all three verbs so a slow trash can't clobber a faster later
 * restore of the same paper (or vice versa).
 */
export function useTrashPapers({ setLibrary, onToast }: UseTrashPapersOptions) {
  const mountedRef = useRef(true);
  const opSeqRef = useRef(0);

  useEffect(() => {
    // StrictMode dev double-invokes effects; reset to true on setup, or the
    // fake cleanup permanently latches this false (Epic 6 retro lesson).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const trashPapers = useCallback(
    (docIds: string[]) => {
      const seq = ++opSeqRef.current;
      const priorTrashed = new Map<string, boolean>();

      setLibrary((prev) => {
        if (!prev) return prev;
        const idSet = new Set(docIds);
        return {
          ...prev,
          papers: prev.papers.map((p) => {
            if (!idSet.has(p.doc_id)) return p;
            priorTrashed.set(p.doc_id, p.trashed);
            return { ...p, trashed: true };
          }),
        };
      });

      apiTrashPapers(docIds)
        .then((library: Library) => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary(library);
        })
        .catch(() => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary((prev) =>
            prev
              ? {
                  ...prev,
                  papers: prev.papers.map((p) =>
                    priorTrashed.has(p.doc_id) ? { ...p, trashed: priorTrashed.get(p.doc_id)! } : p,
                  ),
                }
              : prev,
          );
          onToast("Couldn't delete that paper.", "error");
        });
    },
    [setLibrary, onToast],
  );

  const restorePapers = useCallback(
    (docIds: string[]) => {
      const seq = ++opSeqRef.current;
      const priorTrashed = new Map<string, boolean>();

      setLibrary((prev) => {
        if (!prev) return prev;
        const idSet = new Set(docIds);
        return {
          ...prev,
          papers: prev.papers.map((p) => {
            if (!idSet.has(p.doc_id)) return p;
            priorTrashed.set(p.doc_id, p.trashed);
            return { ...p, trashed: false };
          }),
        };
      });

      apiRestorePapers(docIds)
        .then((library: Library) => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary(library);
          onToast("restored from Trash", "info");
        })
        .catch(() => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary((prev) =>
            prev
              ? {
                  ...prev,
                  papers: prev.papers.map((p) =>
                    priorTrashed.has(p.doc_id) ? { ...p, trashed: priorTrashed.get(p.doc_id)! } : p,
                  ),
                }
              : prev,
          );
          onToast("Couldn't restore that paper.", "error");
        });
    },
    [setLibrary, onToast],
  );

  const purge = useCallback(
    (docId: string) => {
      const seq = ++opSeqRef.current;
      let removedRow: CollectionRow | undefined;
      let removedIndex = -1;

      setLibrary((prev) => {
        if (!prev) return prev;
        removedIndex = prev.papers.findIndex((p) => p.doc_id === docId);
        if (removedIndex === -1) return prev;
        removedRow = prev.papers[removedIndex];
        return { ...prev, papers: prev.papers.filter((p) => p.doc_id !== docId) };
      });

      apiPurgeDoc(docId)
        .then((library: Library) => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary(library);
        })
        .catch(() => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary((prev) => {
            if (!prev || !removedRow) return prev;
            const papers = [...prev.papers];
            papers.splice(Math.min(removedIndex, papers.length), 0, removedRow);
            return { ...prev, papers };
          });
          onToast("Couldn't purge that paper.", "error");
        });
    },
    [setLibrary, onToast],
  );

  return { trashPapers, restorePapers, purge };
}
