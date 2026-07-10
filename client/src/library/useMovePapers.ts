import { useCallback, type Dispatch, type SetStateAction } from "react";
import { movePapers as apiMovePapers, type Library } from "@/api/client";
import { patchField, useOptimisticLibraryOp } from "./useOptimisticLibraryOp";

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
 * `Library` on resolve, reverted on failure — one config of the shared
 * {@link useOptimisticLibraryOp} seam (Story 7.12 AC-3), which owns the
 * `mountedRef` + monotonic stale-response guard.
 */
export function useMovePapers({ setLibrary, onToast }: UseMovePapersOptions) {
  const run = useOptimisticLibraryOp({ setLibrary, onToast });

  const movePapers = useCallback(
    (docIds: string[], folderId: string | null) =>
      run(
        {
          apiFn: (ids: string[]) => apiMovePapers(ids, folderId),
          patch: patchField("folder_id", folderId),
          errorCopy: "Couldn't move that paper.",
        },
        docIds,
      ),
    [run],
  );

  return { movePapers };
}
