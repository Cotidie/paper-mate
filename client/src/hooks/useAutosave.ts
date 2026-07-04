// useAutosave — the dirty-flag, debounced, single-flight autosave scheduler
// (Story 3.4, AR-7/AD-7, H6). A PASSIVE OBSERVER of the annotation store: it
// only reads `docId`/`annotations`/`all()` and calls the api module. It adds
// NO new mutation path (AC-7) and `store/index.ts` stays untouched.
//
// Scheduler (see the story's Dev Notes for the precise state machine): the
// first effect run after mount (or after `docId` changes) is the BASELINE and
// never marks dirty, so an empty/pre-existing initial set never PUTs (AC-1).
// Every later annotations change marks dirty and (re)starts an 800ms debounce.
//
// Story 5.8 (doc-scope the store): the hook takes NO parameter — it reads
// `docId` reactively from the store instead, and `flush` reads BOTH the PUT
// target and its snapshot LIVE from the store at flush time, so they are
// always a consistent (doc, its-own-marks) pair by construction (atomic
// ownership, `store/index.ts`'s `openDoc`). This retires the `generationRef`
// cross-doc guard the previous design needed.
//
// Continuous single-flight (the design that lets the guard die, Trap 1 in the
// story's Dev Notes): `inFlightRef` is NEVER reset on a `docId` change — only
// `mountedRef`/`dirtyRef`/timers/`status` re-arm for the new doc. A PUT started
// for doc A that is still in flight when the store switches to doc B stays
// tracked, so doc B cannot start a second, CONCURRENT PUT; when A's PUT
// resolves, its `.finally` clears the flag (there is exactly one PUT in flight
// app-wide at any instant) and a dirty doc-B change then flushes for real,
// reading the store live (→ B → B). This is a STRENGTHENING of "single-flight
// per doc" to "single-flight app-wide" — it can never fire overlapping PUTs,
// so last-edit-wins still holds; the only behavioral change is timing on a
// mid-flight switch (a doc-B edit coalesces behind an in-flight doc-A PUT
// rather than racing it), which is unreachable through today's UI anyway
// (Trap 2: there is no live in-app doc switch yet).
//
// Story 6.1: unmount now also means "the user navigated away" (back-to-
// Library), a real event the pre-6.1 single-page app never had. The cleanup
// below flushes a pending debounce instead of dropping it (see its comment).
import { useEffect, useRef, useState } from "react";
import { useAnnotationStore } from "@/store";
import { putAnnotations } from "@/api/client";

export const DEBOUNCE_MS = 800;
export const SETTLE_MS = 1200;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutosave(): { status: SaveStatus } {
  const docId = useAnnotationStore((s) => s.docId);
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

  function flush() {
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
    // Read the target + its snapshot LIVE, together, at flush time: they are
    // always a consistent (doc, its-own-marks) pair (atomic store ownership),
    // so a doc's marks can only ever be PUT to that doc. `target` is non-null:
    // flush is only ever scheduled from the annotations effect below, which
    // gates on `docId` being truthy, and no in-app doc close exists yet
    // (Trap 2) to null it out again mid-flight.
    const { docId: target, all } = useAnnotationStore.getState();
    putAnnotations(target!, all())
      .then(() => {
        setStatus("saved");
        settleTimer.current = setTimeout(() => setStatus("idle"), SETTLE_MS);
        if (dirtyRef.current) {
          debounceTimer.current = setTimeout(() => flush(), 0);
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

  // Re-arm the baseline whenever the doc changes: whatever is hydrated in for
  // the NEW doc is not a change to save (AC-5). `inFlightRef` is deliberately
  // NOT reset here (continuous single-flight, see the header note) — an
  // A-PUT genuinely in flight must keep blocking a concurrent B-PUT.
  //
  // Story 6.1: the cleanup runs on a docId change AND on a real unmount (the
  // Reader now unmounts for real on back-to-Library navigation, unlike the
  // pre-6.1 single-page app). A PENDING debounce at that moment is a dirty
  // edit that hasn't been saved yet — clearing it silently would drop the
  // edit (Codex-reported HIGH finding), so flush it synchronously instead of
  // just cancelling it; `flush()` reads its target/snapshot live from the
  // store and its promise chain runs independent of this component's mount
  // state, so the save completes even though cleanup has already returned.
  useEffect(() => {
    mountedRef.current = false;
    dirtyRef.current = false;
    setStatus("idle");
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        flush();
      }
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    debounceTimer.current = setTimeout(() => flush(), DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, docId]);

  return { status };
}
