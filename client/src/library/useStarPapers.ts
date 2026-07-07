import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { starPapers as apiStarPapers, unstarPapers as apiUnstarPapers, type Library } from "@/api/client";

interface UseStarPapersOptions {
  /** Reconcile the collection (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level toast on failure. */
  onToast: (message: string, variant: "error" | "info") => void;
}

/**
 * The star/unstar lifecycle (Story 7.8, AC-1) against
 * `POST /api/library/star|unstar`. Mirrors `useTrashPapers`: optimistic
 * update, reconciled from the returned `Library` on resolve, reverted on
 * failure. A single monotonic `opSeqRef` is shared across both verbs so a
 * slow star can't clobber a faster later unstar of the same paper (or vice
 * versa). No success toast: starring is silent and self-evident from the
 * marker.
 */
export function useStarPapers({ setLibrary, onToast }: UseStarPapersOptions) {
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

  const starPapers = useCallback(
    (docIds: string[]) => {
      const seq = ++opSeqRef.current;
      const priorStarred = new Map<string, boolean>();

      setLibrary((prev) => {
        if (!prev) return prev;
        const idSet = new Set(docIds);
        return {
          ...prev,
          papers: prev.papers.map((p) => {
            if (!idSet.has(p.doc_id)) return p;
            priorStarred.set(p.doc_id, p.starred);
            return { ...p, starred: true };
          }),
        };
      });

      apiStarPapers(docIds)
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
                    priorStarred.has(p.doc_id) ? { ...p, starred: priorStarred.get(p.doc_id)! } : p,
                  ),
                }
              : prev,
          );
          onToast("Couldn't star that paper.", "error");
        });
    },
    [setLibrary, onToast],
  );

  const unstarPapers = useCallback(
    (docIds: string[]) => {
      const seq = ++opSeqRef.current;
      const priorStarred = new Map<string, boolean>();

      setLibrary((prev) => {
        if (!prev) return prev;
        const idSet = new Set(docIds);
        return {
          ...prev,
          papers: prev.papers.map((p) => {
            if (!idSet.has(p.doc_id)) return p;
            priorStarred.set(p.doc_id, p.starred);
            return { ...p, starred: false };
          }),
        };
      });

      apiUnstarPapers(docIds)
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
                    priorStarred.has(p.doc_id) ? { ...p, starred: priorStarred.get(p.doc_id)! } : p,
                  ),
                }
              : prev,
          );
          onToast("Couldn't unstar that paper.", "error");
        });
    },
    [setLibrary, onToast],
  );

  return { starPapers, unstarPapers };
}
