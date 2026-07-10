import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  trashPapers as apiTrashPapers,
  restorePapers as apiRestorePapers,
  purgeDoc as apiPurgeDoc,
  type Library,
} from "@/api/client";
import { patchField, removeRow, useOptimisticLibraryOp } from "./useOptimisticLibraryOp";

interface UseTrashPapersOptions {
  /** Reconcile the collection (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level toast on failure, or the AC-3 restore notice. */
  onToast: (message: string, variant: "error" | "info") => void;
}

/**
 * The trash/restore/purge lifecycle (Story 7.5, AC-1/3/4) against
 * `POST /api/library/trash|restore` and `DELETE /api/docs/{id}`. Three configs
 * of the shared {@link useOptimisticLibraryOp} seam (Story 7.12 AC-3): each is
 * optimistic, reconciled from the returned `Library`, reverted on failure.
 * They share ONE `run`, so trash/restore/purge share one monotonic guard — a
 * slow trash can't clobber a faster later restore of the same paper. `purge`
 * is the row-remove variant ({@link removeRow}): it splices its removed row
 * back at its old index on failure.
 */
export function useTrashPapers({ setLibrary, onToast }: UseTrashPapersOptions) {
  const run = useOptimisticLibraryOp({ setLibrary, onToast });

  const trashPapers = useCallback(
    (docIds: string[]) =>
      run(
        { apiFn: apiTrashPapers, patch: patchField("trashed", true), errorCopy: "Couldn't delete that paper." },
        docIds,
      ),
    [run],
  );

  const restorePapers = useCallback(
    (docIds: string[]) =>
      run(
        {
          apiFn: apiRestorePapers,
          patch: patchField("trashed", false),
          errorCopy: "Couldn't restore that paper.",
          successToast: { message: "restored from Trash", variant: "info" },
        },
        docIds,
      ),
    [run],
  );

  const purge = useCallback(
    (docId: string) =>
      run({ apiFn: apiPurgeDoc, patch: removeRow, errorCopy: "Couldn't purge that paper." }, docId),
    [run],
  );

  return { trashPapers, restorePapers, purge };
}
