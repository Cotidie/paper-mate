import { describe, it, expect, vi, afterEach } from "vitest";

import { useRegionFlashStore, flashRegionAt, REGION_FLASH_FALLBACK_MS } from "./regionFlash";

const rect = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.3 };

afterEach(() => {
  useRegionFlashStore.getState().clear();
});

describe("regionFlash", () => {
  it("flashRegionAt sets the region and holds it until the fallback lifetime (the on-screen pulse clear is owned by the layer)", async () => {
    vi.useFakeTimers();
    try {
      flashRegionAt(2, rect);
      expect(useRegionFlashStore.getState().region).toEqual({ pageIndex: 2, rect });
      // Still set well before the never-arrives fallback.
      await vi.advanceTimersByTimeAsync(REGION_FLASH_FALLBACK_MS - 1);
      expect(useRegionFlashStore.getState().region).toEqual({ pageIndex: 2, rect });
      // The fallback clears it if the page was never reached.
      await vi.advanceTimersByTimeAsync(1);
      expect(useRegionFlashStore.getState().region).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second flashRegionAt cancels the first fallback timer (retargets, no premature clear)", async () => {
    vi.useFakeTimers();
    try {
      flashRegionAt(0, rect);
      await vi.advanceTimersByTimeAsync(REGION_FLASH_FALLBACK_MS / 2);
      const rect2 = { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.6 };
      flashRegionAt(1, rect2);
      // The first timer's original deadline passes; since it was cancelled, the
      // region is still the retargeted one (not cleared early).
      await vi.advanceTimersByTimeAsync(REGION_FLASH_FALLBACK_MS / 2);
      expect(useRegionFlashStore.getState().region).toEqual({ pageIndex: 1, rect: rect2 });
      // The second timer's own full duration then clears it.
      await vi.advanceTimersByTimeAsync(REGION_FLASH_FALLBACK_MS / 2);
      expect(useRegionFlashStore.getState().region).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
