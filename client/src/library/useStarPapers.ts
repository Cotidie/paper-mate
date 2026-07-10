import { useCallback, type Dispatch, type SetStateAction } from "react";
import { starPapers as apiStarPapers, unstarPapers as apiUnstarPapers, type Library } from "@/api/client";
import { patchField, useOptimisticLibraryOp } from "./useOptimisticLibraryOp";

interface UseStarPapersOptions {
  /** Reconcile the collection (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level toast on failure. */
  onToast: (message: string, variant: "error" | "info") => void;
}

/**
 * The star/unstar lifecycle (Story 7.8, AC-1) against
 * `POST /api/library/star|unstar`. Two configs of the shared
 * {@link useOptimisticLibraryOp} seam (Story 7.12 AC-3): optimistic, reconciled
 * from the returned `Library`, reverted on failure. Both share ONE `run`, so a
 * slow star can't clobber a faster later unstar of the same paper. No success
 * toast: starring is silent and self-evident from the marker.
 */
export function useStarPapers({ setLibrary, onToast }: UseStarPapersOptions) {
  const run = useOptimisticLibraryOp({ setLibrary, onToast });

  const starPapers = useCallback(
    (docIds: string[]) =>
      run(
        { apiFn: apiStarPapers, patch: patchField("starred", true), errorCopy: "Couldn't star that paper." },
        docIds,
      ),
    [run],
  );

  const unstarPapers = useCallback(
    (docIds: string[]) =>
      run(
        { apiFn: apiUnstarPapers, patch: patchField("starred", false), errorCopy: "Couldn't unstar that paper." },
        docIds,
      ),
    [run],
  );

  return { starPapers, unstarPapers };
}
