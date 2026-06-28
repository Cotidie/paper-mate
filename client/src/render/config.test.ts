import { describe, it, expect } from "vitest";

import { PDFJS_ASSET_CONFIG } from "./config";

// Locks the asset-config invariants into CI. The real decode proof is the
// runtime live smoke (Task 5) — jsdom can't exercise WASM decode or worker
// fetch — so this file guards only the config shape, chiefly the #1 footgun:
// a missing trailing slash makes pdf.js request `/pdfjs/cmapsFoo.bcmap` → 404.
describe("PDFJS_ASSET_CONFIG", () => {
  const urlKeys = ["wasmUrl", "cMapUrl", "iccUrl", "standardFontDataUrl"] as const;

  it("packs cmaps (binary .bcmap)", () => {
    expect(PDFJS_ASSET_CONFIG.cMapPacked).toBe(true);
  });

  it("defines all four asset URLs", () => {
    for (const key of urlKeys) {
      expect(PDFJS_ASSET_CONFIG[key]).toBeDefined();
      expect(typeof PDFJS_ASSET_CONFIG[key]).toBe("string");
    }
  });

  it("ends every URL with a trailing slash (the silent-404 footgun)", () => {
    for (const key of urlKeys) {
      expect(PDFJS_ASSET_CONFIG[key].endsWith("/")).toBe(true);
    }
  });

  it("shares the one pdfjs/ prefix across all URLs", () => {
    for (const key of urlKeys) {
      expect(PDFJS_ASSET_CONFIG[key]).toContain("pdfjs/");
    }
  });
});
