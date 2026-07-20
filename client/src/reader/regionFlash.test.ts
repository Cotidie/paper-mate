import { describe, it, expect, vi, afterEach } from "vitest";

import { FLASH_MS } from "@/store";
import { useRegionFlashStore, flashRegionAt } from "./regionFlash";

const rect = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.3 };

afterEach(() => {
  useRegionFlashStore.getState().clear();
});

describe("regionFlash", () => {
  it("flashRegionAt sets the region then auto-clears after FLASH_MS", async () => {
    vi.useFakeTimers();
    try {
      flashRegionAt(2, rect);
      expect(useRegionFlashStore.getState().region).toEqual({ pageIndex: 2, rect });
      await vi.advanceTimersByTimeAsync(FLASH_MS);
      expect(useRegionFlashStore.getState().region).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second flashRegionAt before the first clears cancels the first timer (retargets, no premature clear)", async () => {
    vi.useFakeTimers();
    try {
      flashRegionAt(0, rect);
      await vi.advanceTimersByTimeAsync(FLASH_MS / 2);
      const rect2 = { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.6 };
      flashRegionAt(1, rect2);
      // The first timer's original deadline passes; since it was cancelled,
      // the region must still be the retargeted one (not cleared early).
      await vi.advanceTimersByTimeAsync(FLASH_MS / 2);
      expect(useRegionFlashStore.getState().region).toEqual({ pageIndex: 1, rect: rect2 });
      // The second timer's own full duration then clears it.
      await vi.advanceTimersByTimeAsync(FLASH_MS / 2);
      expect(useRegionFlashStore.getState().region).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
