import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { type CollectionRow, type Library } from "@/api/client";

type Toast = (message: string, variant: "error" | "info") => void;

/**
 * The optimistic delta for one op invocation: the `Library` to show
 * immediately (`next`), plus how to undo it (`revert`) if the request fails.
 * `revert` receives whatever the library is AT FAILURE time and returns it with
 * only this op's change rolled back, leaving any newer row untouched — the
 * captured-`prior`-map behavior the org hooks each hand-rolled before.
 */
export interface OptimisticPatch {
  next: Library;
  revert: (current: Library) => Library;
}

/** One org verb's config: its API call, its optimistic patch, its copy. */
export interface OptimisticOp<TArg> {
  /** The API call for this verb; resolves to the whole reconciled `Library`. */
  apiFn: (arg: TArg) => Promise<Library>;
  /** Compute the optimistic `Library` + its revert from the current one + arg. */
  patch: (prev: Library, arg: TArg) => OptimisticPatch;
  /** Toast raised on failure (error variant). */
  errorCopy: string;
  /** Optional toast raised on success (e.g. restore's "restored from Trash"). */
  successToast?: { message: string; variant: "error" | "info" };
}

/**
 * The shared optimistic-org-op seam (Story 7.12 AC-3): the machinery every
 * set-based paper-org verb (move/trash/restore/star/unstar + purge) repeated —
 * a StrictMode-safe `mountedRef`, ONE monotonic `opSeqRef`, and the optimistic
 * patch -> `apiFn` -> reconcile-from-returned-`Library` -> revert-on-failure +
 * error-toast skeleton. Adding the next org op is registering one
 * {@link OptimisticOp} descriptor, not copying another near-twin hook.
 *
 * Returns a stable `run(op, arg)`. Verbs that MUST NOT clobber each other (a
 * slow trash vs a faster later restore of the same paper; star vs unstar) call
 * ONE `run` from a single `useOptimisticLibraryOp()` — they then share the one
 * `opSeqRef`, so the latest invocation always wins and a stale slow response is
 * dropped. The per-doc field-edit hooks (`useInlineEdit`/`useAuthorsEdit`) are
 * a related but distinct family: they reconcile from a single `Doc`, revert a
 * value, and guard with a keyed `editSeqRef` Map, so they stay separate.
 */
export function useOptimisticLibraryOp({
  setLibrary,
  onToast,
}: {
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  onToast: Toast;
}) {
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

  return useCallback(
    <TArg>(op: OptimisticOp<TArg>, arg: TArg) => {
      const seq = ++opSeqRef.current;
      let revert: ((current: Library) => Library) | null = null;

      setLibrary((prev) => {
        if (!prev) return prev;
        const patch = op.patch(prev, arg);
        revert = patch.revert;
        return patch.next;
      });

      op.apiFn(arg)
        .then((library: Library) => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary(library);
          if (op.successToast) onToast(op.successToast.message, op.successToast.variant);
        })
        .catch(() => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary((prev) => (prev && revert ? revert(prev) : prev));
          onToast(op.errorCopy, "error");
        });
    },
    [setLibrary, onToast],
  );
}

/**
 * A {@link OptimisticOp.patch} for the flag-flip verbs: set one `CollectionRow`
 * field to `value` on every row in the `doc_id` set, capturing each row's prior
 * value so the revert restores exactly those rows (and no newer one).
 */
export function patchField<K extends keyof CollectionRow>(field: K, value: CollectionRow[K]) {
  const withField = (row: CollectionRow, v: CollectionRow[K]): CollectionRow =>
    ({ ...row, [field]: v }) as CollectionRow;
  return (prev: Library, docIds: string[]): OptimisticPatch => {
    const idSet = new Set(docIds);
    const prior = new Map<string, CollectionRow[K]>();
    const next: Library = {
      ...prev,
      papers: prev.papers.map((p) => {
        if (!idSet.has(p.doc_id)) return p;
        prior.set(p.doc_id, p[field]);
        return withField(p, value);
      }),
    };
    const revert = (current: Library): Library => ({
      ...current,
      papers: current.papers.map((p) => (prior.has(p.doc_id) ? withField(p, prior.get(p.doc_id)!) : p)),
    });
    return { next, revert };
  };
}

/**
 * A {@link OptimisticOp.patch} for `purge`: drop the one row for `docId`,
 * capturing its value + index so the revert splices it back where it was
 * (clamped to the current length). A no-op patch if the row is already gone.
 */
export function removeRow(prev: Library, docId: string): OptimisticPatch {
  const removedIndex = prev.papers.findIndex((p) => p.doc_id === docId);
  if (removedIndex === -1) return { next: prev, revert: (current) => current };
  const removedRow = prev.papers[removedIndex];
  const next: Library = { ...prev, papers: prev.papers.filter((p) => p.doc_id !== docId) };
  const revert = (current: Library): Library => {
    const papers = [...current.papers];
    papers.splice(Math.min(removedIndex, papers.length), 0, removedRow);
    return { ...current, papers };
  };
  return { next, revert };
}
