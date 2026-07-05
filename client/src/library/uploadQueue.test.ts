import { describe, it, expect } from "vitest";
import { runWithConcurrency, createSemaphore } from "@/library/uploadQueue";

/** A promise plus its external resolve/reject, for gating worker completion. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runWithConcurrency", () => {
  it("never runs more than `limit` workers at once, and all items complete even if some reject", async () => {
    const ITEMS = 10;
    const LIMIT = 4;
    const items = Array.from({ length: ITEMS }, (_, i) => i);
    const gates = items.map(() => deferred<void>());

    let live = 0;
    let maxLive = 0;
    const started: number[] = [];
    const finished: number[] = [];

    const run = runWithConcurrency(items, LIMIT, async (item) => {
      started.push(item);
      live++;
      maxLive = Math.max(maxLive, live);
      try {
        await gates[item].promise;
      } finally {
        live--;
        finished.push(item);
      }
    });

    // Let the first wave of workers start.
    await Promise.resolve();
    await Promise.resolve();
    expect(started.length).toBe(LIMIT);
    expect(maxLive).toBe(LIMIT);

    // Reject a couple, resolve the rest, out of start order.
    gates[2].reject(new Error("boom"));
    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Release everything else, including ones that have not started yet.
    for (let i = 0; i < ITEMS; i++) {
      if (i !== 2 && i !== 0) gates[i].resolve();
    }

    await run;

    expect(finished.sort((a, b) => a - b)).toEqual(items);
    expect(maxLive).toBeLessThanOrEqual(LIMIT);
    expect(maxLive).toBe(LIMIT);
  });

  it("runs a single item to completion", async () => {
    let ran = false;
    await runWithConcurrency([1], 4, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("handles an empty item list", async () => {
    let calls = 0;
    await runWithConcurrency([], 4, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});

describe("createSemaphore", () => {
  it("gates acquire() to at most `limit` holders, releasing hands off to the next waiter", async () => {
    const sem = createSemaphore(2);
    const order: string[] = [];

    await sem.acquire();
    order.push("a-acquired");
    await sem.acquire();
    order.push("b-acquired");

    let cAcquired = false;
    const cPromise = sem.acquire().then(() => {
      cAcquired = true;
      order.push("c-acquired");
    });

    await Promise.resolve();
    expect(cAcquired).toBe(false); // both slots held by a and b

    sem.release(); // frees a's slot, hands off to c
    await cPromise;
    expect(cAcquired).toBe(true);
    expect(order).toEqual(["a-acquired", "b-acquired", "c-acquired"]);
  });

  it("lets a third acquire proceed immediately once a slot is released with no waiters", async () => {
    const sem = createSemaphore(1);
    await sem.acquire();
    sem.release();
    let acquired = false;
    await sem.acquire().then(() => {
      acquired = true;
    });
    expect(acquired).toBe(true);
  });
});
