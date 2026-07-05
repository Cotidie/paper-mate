import { useCallback, useEffect, useRef } from "react";

export interface UseSettlePollingOptions<T> {
  /** Refetch the polled resource (e.g. `getLibrary`). */
  fetch: () => Promise<T>;
  /** True once the latest result no longer needs polling. */
  isSettled: (latest: T) => boolean;
  /** Hand every fetched result up so the caller can update state in place. */
  onResult: (latest: T) => void;
  /** Fires once when polling stops because the result settled (not on cap). */
  onSettled?: (latest: T) => void;
  intervalMs: number;
  /** Safety cap: stop after this many polls even if never settled (a stuck
   *  status must not spin forever). */
  maxPolls: number;
}

/**
 * A small, unmount-safe interval poller (Story 6.5). While `!isSettled`, it
 * refetches every `intervalMs` and hands each result up, stopping the moment
 * it settles or after `maxPolls`. `start()` is idempotent: a second call while
 * already polling is a no-op, so a new batch rides the existing loop rather
 * than stacking timers. Options are read through a ref, so the loop always
 * uses the latest closures without restarting.
 */
export function useSettlePolling<T>(options: UseSettlePollingOptions<T>) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollsRef = useRef(0);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    clearTimer();
  }, [clearTimer]);

  // A ref so the setTimeout callback can re-arm itself without a stale closure.
  const scheduleRef = useRef<() => void>(() => {});
  scheduleRef.current = () => {
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      if (!runningRef.current || !mountedRef.current) return;
      const { fetch, isSettled, onResult, onSettled, maxPolls } = optionsRef.current;
      pollsRef.current += 1;
      const atCap = pollsRef.current >= maxPolls;
      let latest: T;
      try {
        latest = await fetch();
      } catch {
        // A transient fetch failure keeps the loop alive until the cap.
        if (runningRef.current && mountedRef.current && !atCap) scheduleRef.current();
        else runningRef.current = false;
        return;
      }
      if (!runningRef.current || !mountedRef.current) return;
      onResult(latest);
      if (isSettled(latest)) {
        runningRef.current = false;
        onSettled?.(latest);
        return;
      }
      if (atCap) {
        runningRef.current = false;
        return;
      }
      scheduleRef.current();
    }, optionsRef.current.intervalMs);
  };

  const start = useCallback(() => {
    if (runningRef.current) return; // already polling — a new batch rides it
    runningRef.current = true;
    pollsRef.current = 0;
    scheduleRef.current();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  return { start, stop };
}
