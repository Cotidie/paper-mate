// Framework-free concurrency-limited runner (CLAUDE.md: adopt-a-primitive-
// underneath, hand-roll only the ~20-line seam). No React, no api/ import —
// unit-testable in isolation, reused by useBulkUpload's upload pool.

/**
 * Runs `worker` over `items` with at most `limit` in flight at once. Every
 * worker settles independently: a rejecting worker is caught and does not
 * abort the others (no `Promise.all` short-circuit). Resolves once all
 * items have settled (resolved or rejected).
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;

  async function runOne(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        await worker(items[index], index);
      } catch {
        // A single item's failure must not stop the others; the worker is
        // responsible for reporting its own outcome to its caller.
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(workers);
}

/**
 * A counting semaphore: gates access to `limit` concurrent slots across
 * calls made at different times, unlike `runWithConcurrency`'s cap (which
 * only holds within one call). `useBulkUpload` holds one instance for its
 * whole lifetime so two overlapping `uploadFiles()` batches share the same
 * `UPLOAD_CONCURRENCY` budget instead of each getting their own.
 */
export function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve));
  }

  function release(): void {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      active--;
    }
  }

  return { acquire, release };
}
