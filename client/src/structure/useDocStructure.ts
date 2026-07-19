// structure/useDocStructure — fetch + hold the open doc's structure layer.
//
// Mirrors how the reader hydrates annotations on open: fetch once per doc, hold
// it, expose loading state. Kept standalone (not folded into the annotation
// store) because structure is read-only, import-time, and has no consumer UI
// yet (10-2..10-6 are the consumers). A fetch failure degrades to the empty
// structure — the layer is best-effort end to end (AD-13), never a reader error.

import { useEffect, useState } from "react";

import { type DocStructure, getStructure } from "@/api/client";
import { EMPTY_STRUCTURE } from "@/structure";

export interface DocStructureState {
  structure: DocStructure;
  loading: boolean;
}

/** Fetch + hold `docId`'s structure. Re-fetches when `docId` changes; a null
 *  `docId` (no open doc) holds the empty structure without a request. */
export function useDocStructure(docId: string | null): DocStructureState {
  const [structure, setStructure] = useState<DocStructure>(EMPTY_STRUCTURE);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docId) {
      setStructure(EMPTY_STRUCTURE);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Clear the previous doc's structure IMMEDIATELY on a doc switch, so B never
    // renders A's elements during the in-flight fetch (they are page-anchored to
    // a different document).
    setStructure(EMPTY_STRUCTURE);
    setLoading(true);
    void (async () => {
      try {
        const s = await getStructure(docId);
        if (!cancelled) setStructure(s);
      } catch {
        // Best-effort: a fetch failure holds the empty structure, no throw.
        if (!cancelled) setStructure(EMPTY_STRUCTURE);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  return { structure, loading };
}
