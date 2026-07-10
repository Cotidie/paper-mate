import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { patchDoc, type CollectionRow, type Doc, type Library } from "@/api/client";

interface UseAuthorsEditOptions {
  /** The current collection (to read the prior list before overwriting, for
   *  a no-op guard and a revert-on-failure snapshot). */
  library: Library | null;
  /** Reconcile a single row optimistically (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level error toast when a save fails. */
  onToast: (message: string, variant: "error" | "info") => void;
}

function withAuthorsList(row: CollectionRow, authorsList: string[]): CollectionRow {
  return { ...row, authors_list: authorsList, authors: authorsList.join(", ") || null };
}

/**
 * The Author tag editor's commit lifecycle (Story 7.11, AC-4): a thin sibling
 * of `useInlineEdit`, same optimistic-write / revert-on-failure / per-doc
 * monotonic-sequence shape, sized for a `string[]` FULL-LIST replacement
 * instead of `useInlineEdit`'s single string/number field. The commit is
 * already the complete intended author list (the editor computed add/remove
 * client-side), so `PATCH /api/docs/{id}` with `{ authors_list }` can never
 * silently lose an author. The optimistic row writes BOTH `authors_list` and
 * a locally-joined `authors` display string so the cell/sort key never shows
 * a stale value while the request is in flight; the server's own derived
 * `authors` join (from `doc.authors_list`) reconciles it on resolve.
 */
export function useAuthorsEdit({ library, setLibrary, onToast }: UseAuthorsEditOptions) {
  const editSeqRef = useRef<Map<string, number>>(new Map());

  return useCallback(
    (docId: string, authorsList: string[]) => {
      const prior = library?.papers.find((p) => p.doc_id === docId)?.authors_list ?? [];
      // AC-6-style no-op guard (mirrors `useInlineEdit`/`commitEdit`): an
      // editor closed with no actual change skips the round-trip entirely.
      if (prior.length === authorsList.length && prior.every((a, i) => a === authorsList[i])) return;

      const seq = (editSeqRef.current.get(docId) ?? 0) + 1;
      editSeqRef.current.set(docId, seq);
      const isLatest = () => editSeqRef.current.get(docId) === seq;

      setLibrary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          papers: prev.papers.map((p) => (p.doc_id === docId ? withAuthorsList(p, authorsList) : p)),
        };
      });
      patchDoc(docId, { authors_list: authorsList })
        .then((doc: Doc) => {
          if (!isLatest()) return; // a newer edit to this doc superseded this request
          setLibrary((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              papers: prev.papers.map((p) =>
                p.doc_id === docId ? withAuthorsList(p, doc.authors_list) : p,
              ),
            };
          });
        })
        .catch(() => {
          if (!isLatest()) return; // a newer edit already superseded this failed request
          setLibrary((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              papers: prev.papers.map((p) => (p.doc_id === docId ? withAuthorsList(p, prior) : p)),
            };
          });
          onToast("Couldn't save that change.", "error");
        });
    },
    [library, setLibrary, onToast],
  );
}
