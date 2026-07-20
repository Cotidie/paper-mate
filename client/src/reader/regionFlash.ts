// reader/regionFlash — a tiny standalone store for briefly flashing a
// structure-layer REGION (not an annotation), generalizing the Story 3.6
// `flashAnnotation` idiom (store/index.ts) beyond annotation ids.
//
// Why a separate store: AD-9 keeps `store/` the annotation working copy; a
// synthesized ToC heading (Story 10.2) or a Figures/Tables entry (Story 10.3,
// its own future consumer) is not an annotation, so it has no id in that
// store. This store holds at most one transient `{pageIndex, rect}` region,
// rendered by `RegionFlashLayer` on whichever page card matches.

import { create } from "zustand";
import type { Rect } from "@/api/client";
import { FLASH_MS } from "@/store";

export interface FlashedRegion {
  pageIndex: number;
  rect: Rect;
}

interface RegionFlashStore {
  region: FlashedRegion | null;
  flash: (region: FlashedRegion) => void;
  clear: () => void;
}

export const useRegionFlashStore = create<RegionFlashStore>()((set) => ({
  region: null,
  flash: (region) => set({ region }),
  clear: () => set({ region: null }),
}));

/** The pending auto-clear timer, module-level so a second `flashRegionAt` call
 *  can cancel the first rather than racing it (mirrors `flashAnnotation`'s
 *  `flashClearTimer` in store/index.ts). */
let regionFlashClearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Flash a page-anchored region (a ToC/index jump target), then auto-clear it
 * after `FLASH_MS`. Cancels any prior pending clear FIRST, so a rapid second
 * jump retargets the flash to the new region instead of stranding it
 * unflashed or double-firing a clear on the new one.
 */
export function flashRegionAt(pageIndex: number, rect: Rect): void {
  if (regionFlashClearTimer) clearTimeout(regionFlashClearTimer);
  useRegionFlashStore.getState().flash({ pageIndex, rect });
  regionFlashClearTimer = setTimeout(() => {
    regionFlashClearTimer = null;
    useRegionFlashStore.getState().clear();
  }, FLASH_MS);
}
