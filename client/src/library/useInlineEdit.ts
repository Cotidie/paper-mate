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

/** `CollectionRow`'s type per editable field: `year` is numeric, the rest
 *  are strings. The table always reports a string (or `null`); `year`'s
 *  string is parsed here, at the one boundary that already knows about
 *  `DocPatch`'s real types. */
type FieldValue = string | number | null;

function parseFieldValue(field: EditableField, value: string | null): FieldValue | "invalid" {
  if (field !== "year") return value;
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : "invalid";
}

function withField(row: CollectionRow, field: EditableField, next: FieldValue): CollectionRow {
  return { ...row, [field]: next };
}

/**
 * The inline title/authors/venue/year edit lifecycle (Story 6.6, AC-5;
 * venue/year added by a Story 7.9 fix request): optimistic write +
 * revert-on-failure. The table reports the committed gesture (always a
 * string or `null`, even for `year`); this hook owns the `PATCH`, the
 * string->number parse for `year`, and the row's state. A functional
 * `setLibrary` keeps it safe alongside the fetch/settle machine (idle for
 * settled rows, so no concurrent writer touches this field). `editSeqRef`
 * additionally guards two overlapping edits to the SAME field: only the
 * most-recently-issued request may reconcile/revert, so a slow older
 * request can't clobber a faster newer one.
 *
 * This per-doc field-edit family (with `useAuthorsEdit`) stays SEPARATE from
 * the set-based org seam `useOptimisticLibraryOp` (Story 7.12 AC-3): those
 * reconcile from the whole returned `Library` and revert a captured row-set;
 * these reconcile from a single `Doc` and revert one value under a keyed
 * `editSeqRef` Map, so one seam would only leak a union type.
 */
export function useInlineEdit({ library, setLibrary, onToast }: UseInlineEditOptions) {
  // Per-field monotonic sequence (keyed "docId:field").
  const editSeqRef = useRef<Map<string, number>>(new Map());

  return useCallback(
    (docId: string, field: EditableField, value: string | null) => {
      // An unparseable year (e.g. "abc") is silently discarded: the editor
      // already closed on commit, so the cell just reverts to its prior
      // value rather than surfacing a malformed-input error toast for a
      // free-text field with no format hint.
      const next = parseFieldValue(field, value);
      if (next === "invalid") return;

      const seqKey = `${docId}:${field}`;
      const seq = (editSeqRef.current.get(seqKey) ?? 0) + 1;
      editSeqRef.current.set(seqKey, seq);
      const isLatest = () => editSeqRef.current.get(seqKey) === seq;

      const prior = library?.papers.find((p) => p.doc_id === docId)?.[field] ?? null;
      setLibrary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          papers: prev.papers.map((p) => (p.doc_id === docId ? withField(p, field, next) : p)),
        };
      });
      const patch = { [field]: next } as DocPatch;
      patchDoc(docId, patch)
        .then((doc: Doc) => {
          if (!isLatest()) return; // a newer edit to this field superseded this request
          setLibrary((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              papers: prev.papers.map((p) =>
                p.doc_id === docId ? withField(p, field, doc[field] ?? null) : p,
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
              papers: prev.papers.map((p) => (p.doc_id === docId ? withField(p, field, prior) : p)),
            };
          });
          onToast("Couldn't save that change.", "error");
        });
    },
    [library, setLibrary, onToast],
  );
}
