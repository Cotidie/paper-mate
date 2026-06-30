// useAutosave — the dirty-flag, debounced, single-flight autosave scheduler
// (Story 3.4, AR-7/AD-7, H6). A PASSIVE OBSERVER of the annotation store: it
// only reads `annotations`/`all()` and calls the api module. It adds NO new
// mutation path (AC-7) and `store/index.ts` stays untouched.
//
// Scheduler (see the story's Dev Notes for the precise state machine): the
// first effect run after mount (or after `docId` changes) is the BASELINE and
// never marks dirty, so an empty/pre-existing initial set never PUTs (AC-1).
// Every later annotations change marks dirty and (re)starts an 800ms debounce.
// At most one PUT is in flight per doc; a change that arrives mid-flight stays
// dirty and is flushed once, right after the in-flight PUT resolves (H6) — so
// every PUT is a full, current snapshot and last-edit-wins holds.
import { useEffect, useRef, useState } from "react";
import { useAnnotationStore } from "./store";
import { putAnnotations } from "./api/client";

export const DEBOUNCE_MS = 800;
export const SETTLE_MS = 1200;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutosave(docId: string): { status: SaveStatus } {
  const annotations = useAnnotationStore((s) => s.annotations);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const mountedRef = useRef(false);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }

  function flush(forDocId: string) {
    if (inFlightRef.current) return; // coalesce; the resolve handler re-checks
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    inFlightRef.current = true;
    // A fresh save supersedes any pending settle-to-idle from a prior one.
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    setStatus("saving");
    putAnnotations(forDocId, useAnnotationStore.getState().all())
      .then(() => {
        setStatus("saved");
        settleTimer.current = setTimeout(() => setStatus("idle"), SETTLE_MS);
        if (dirtyRef.current) {
          debounceTimer.current = setTimeout(() => flush(forDocId), 0);
        }
      })
      .catch(() => {
        setStatus("error");
        dirtyRef.current = true; // keep dirty: retried on the next change (AC-5)
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }

  // Reset every ref + status whenever the doc changes (and on unmount), so a
  // doc switch starts a fresh baseline instead of inheriting stale scheduler
  // state from the previous document.
  useEffect(() => {
    mountedRef.current = false;
    dirtyRef.current = false;
    inFlightRef.current = false;
    setStatus("idle");
    return () => {
      clearTimers();
    };
  }, [docId]);

  useEffect(() => {
    if (!docId) return;
    if (!mountedRef.current) {
      // The baseline run: whatever the set is right now, it is not a NEW
      // change to save (AC-1).
      mountedRef.current = true;
      return;
    }
    dirtyRef.current = true;
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => flush(docId), DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, docId]);

  return { status };
}
