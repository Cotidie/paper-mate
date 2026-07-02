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
//
// generationRef (Codex review, Story 3.4): the scheduler refs below are
// shared, not doc-scoped, so a PUT started for the previous doc can still be
// in flight when `docId` switches. Every async continuation (`.then`/
// `.catch`/`.finally`) captures the generation live at SCHEDULE time and
// bails out without touching shared state if a doc switch (or unmount) has
// since bumped it — otherwise a stale doc-A response could write doc-B's
// snapshot to doc A, or clear `inFlightRef` while doc B's own PUT is
// genuinely in flight, breaking single-flight (H6) across the switch.
import { useEffect, useRef, useState } from "react";
import { useAnnotationStore } from "@/store";
import { putAnnotations } from "@/api/client";

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
  const generationRef = useRef(0);

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

  function flush(forDocId: string, gen: number) {
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
        if (generationRef.current !== gen) return; // stale: doc switched mid-flight
        setStatus("saved");
        settleTimer.current = setTimeout(() => setStatus("idle"), SETTLE_MS);
        if (dirtyRef.current) {
          debounceTimer.current = setTimeout(() => flush(forDocId, gen), 0);
        }
      })
      .catch(() => {
        if (generationRef.current !== gen) return; // stale: doc switched mid-flight
        setStatus("error");
        dirtyRef.current = true; // keep dirty: retried on the next change (AC-5)
      })
      .finally(() => {
        if (generationRef.current !== gen) return; // stale: don't clear the NEW doc's flag
        inFlightRef.current = false;
      });
  }

  // Reset every ref + status whenever the doc changes (and on unmount). The
  // generation bump happens in the CLEANUP (runs on a docId change AND on
  // unmount) so any already-in-flight PUT's callbacks see a stale `gen` and
  // no-op, regardless of which case ended its doc.
  useEffect(() => {
    mountedRef.current = false;
    dirtyRef.current = false;
    inFlightRef.current = false;
    setStatus("idle");
    return () => {
      generationRef.current += 1;
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
    const gen = generationRef.current;
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => flush(docId, gen), DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, docId]);

  return { status };
}
