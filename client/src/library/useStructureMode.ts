import { useCallback, useEffect, useState } from "react";
import {
  fetchStructureMode,
  setStructureMode,
  type StructureModeState,
  type StructureModeValue,
} from "@/api/client";
import { useSettlePolling } from "./useSettlePolling";

/** How often to re-check a mode change that is still in flight. */
const POLL_MS = 2000;
/** Safety cap: a hybrid model load is slow but bounded (the server gives up at
 *  120s), so ~2 minutes of polling is enough to never spin forever. */
const MAX_POLLS = 60;

/**
 * Owns the Library toggle's view of the runtime document-structure mode: read
 * it on mount, flip it, and poll while the backend is bringing the hybrid
 * server up or draining in-flight extractions.
 *
 * A failed flip is not thrown at the caller: the backend reverts to local and
 * reports `error`, which the toggle renders in place, so the control stays the
 * single place this state is visible.
 */
export function useStructureMode() {
  const [state, setState] = useState<StructureModeState | null>(null);

  const polling = useSettlePolling<StructureModeState>({
    fetch: fetchStructureMode,
    isSettled: (latest) => latest.transition === "idle",
    onResult: setState,
    intervalMs: POLL_MS,
    maxPolls: MAX_POLLS,
  });

  const start = polling.start;

  useEffect(() => {
    let cancelled = false;
    fetchStructureMode()
      .then((latest) => {
        if (cancelled) return;
        setState(latest);
        if (latest.transition !== "idle") start();
      })
      .catch(() => {
        // A backend that cannot report its mode leaves the toggle hidden rather
        // than showing a mode we cannot vouch for.
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [start]);

  const toggle = useCallback(() => {
    const current = state;
    if (!current || current.transition !== "idle") return;
    const next: StructureModeValue = current.mode === "hybrid" ? "local" : "hybrid";
    setStructureMode(next)
      .then((latest) => {
        setState(latest);
        if (latest.transition !== "idle") start();
      })
      .catch((err: Error) => {
        setState({ ...current, error: err.message });
      });
  }, [state, start]);

  return {
    state,
    busy: state !== null && state.transition !== "idle",
    failed: state !== null && state.error !== null && state.transition === "idle",
    toggle,
  };
}
