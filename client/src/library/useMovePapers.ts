import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { movePapers as apiMovePapers, type Library } from "@/api/client";

interface UseMovePapersOptions {
  /** Reconcile the collection (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level error toast when a move fails. */
  onToast: (message: string, variant: "error" | "info") => void;
}

/**
 * The single-paper (7.2) / batch (7.3) move lifecycle against
 * `POST /api/library/move`. Optimistic: `folder_id` on the matching rows
 * updates immediately (so a moved paper visibly leaves the current folder
 * view without waiting on the round-trip), reconciled from the returned
 * `Library` on resolve, reverted on failure. A monotonic `moveSeqRef` (mirrors
 * `useFolders.opSeqRef`) guards against a stale slow response clobbering a
 * newer move.
 */
export function useMovePapers({ setLibrary, onToast }: UseMovePapersOptions) {
  const mountedRef = useRef(true);
  const moveSeqRef = useRef(0);

  useEffect(() => {
    // StrictMode dev double-invokes effects; reset to true on setup, or the
    // fake cleanup permanently latches this false (Epic 6 retro lesson).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const movePapers = useCallback(
    (docIds: string[], folderId: string | null) => {
      const seq = ++moveSeqRef.current;
      const priorFolderIds = new Map<string, string | null>();

      setLibrary((prev) => {
        if (!prev) return prev;
        const idSet = new Set(docIds);
        return {
          ...prev,
          papers: prev.papers.map((p) => {
            if (!idSet.has(p.doc_id)) return p;
            priorFolderIds.set(p.doc_id, p.folder_id);
            return { ...p, folder_id: folderId };
          }),
        };
      });

      apiMovePapers(docIds, folderId)
        .then((library: Library) => {
          if (!mountedRef.current || seq !== moveSeqRef.current) return;
          setLibrary(library);
        })
        .catch(() => {
          if (!mountedRef.current || seq !== moveSeqRef.current) return;
          setLibrary((prev) =>
            prev
              ? {
                  ...prev,
                  papers: prev.papers.map((p) =>
                    priorFolderIds.has(p.doc_id) ? { ...p, folder_id: priorFolderIds.get(p.doc_id)! } : p,
                  ),
                }
              : prev,
          );
          onToast("Couldn't move that paper.", "error");
        });
    },
    [setLibrary, onToast],
  );

  return { movePapers };
}
