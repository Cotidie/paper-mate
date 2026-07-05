import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type { EditableField } from "@/library/row";
import {
  patchDoc,
  type CollectionRow,
  type Doc,
  type DocPatch,
  type Library,
} from "@/api/client";

interface UseInlineEditOptions {
  /** The current collection (to read a field's prior value before overwriting). */
  library: Library | null;
  /** Reconcile a single row optimistically (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level error toast when a save fails. */
  onToast: (message: string, variant: "error" | "info") => void;
}

/**
 * The inline title/authors edit lifecycle (Story 6.6, AC-5): optimistic write
 * + revert-on-failure. The table reports the committed gesture; this hook owns
 * the `PATCH` and the row's state. A functional `setLibrary` keeps it safe
 * alongside the fetch/settle machine (idle for settled rows, so no concurrent
 * writer touches this field). `editSeqRef` additionally guards two overlapping
 * edits to the SAME field: only the most-recently-issued request may
 * reconcile/revert, so a slow older request can't clobber a faster newer one.
 */
export function useInlineEdit({ library, setLibrary, onToast }: UseInlineEditOptions) {
  // Per-field monotonic sequence (keyed "docId:field").
  const editSeqRef = useRef<Map<string, number>>(new Map());

  return useCallback(
    (docId: string, field: EditableField, value: string | null) => {
      const seqKey = `${docId}:${field}`;
      const seq = (editSeqRef.current.get(seqKey) ?? 0) + 1;
      editSeqRef.current.set(seqKey, seq);
      const isLatest = () => editSeqRef.current.get(seqKey) === seq;

      const prior = library?.papers.find((p) => p.doc_id === docId)?.[field] ?? null;
      const withField = (row: CollectionRow, next: string | null): CollectionRow =>
        field === "title" ? { ...row, title: next } : { ...row, authors: next };
      setLibrary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          papers: prev.papers.map((p) => (p.doc_id === docId ? withField(p, value) : p)),
        };
      });
      const patch: DocPatch = field === "title" ? { title: value } : { authors: value };
      patchDoc(docId, patch)
        .then((doc: Doc) => {
          if (!isLatest()) return; // a newer edit to this field superseded this request
          setLibrary((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              papers: prev.papers.map((p) =>
                p.doc_id === docId ? withField(p, doc[field] ?? null) : p,
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
              papers: prev.papers.map((p) => (p.doc_id === docId ? withField(p, prior) : p)),
            };
          });
          onToast("Couldn't save that change.", "error");
        });
    },
    [library, setLibrary, onToast],
  );
}
