// render/config.ts — the SINGLE home for pdf.js asset URLs. `loadDocument` in
// index.ts is the only consumer; it spreads this into the one getDocument(...)
// call. No asset URL is hand-authored anywhere else (AD-2, AD-9). Pure, DOM-free,
// annotation-agnostic — same boundary as the rest of render/.
//
// The URLs point at pdf.js's OWN bundled decoder/cmap/icc/standard-font assets,
// emitted into dist/pdfjs/ by the vite-plugin-static-copy step in vite.config.ts
// and served same-origin by FastAPI (AD-10) — never an external CDN.

// One prefix, shared with the Vite copy `dest` in vite.config.ts. Built from
// Vite's BASE_URL so a future non-root base still resolves (today "/"→"/pdfjs/").
// If this string changes, change the copy `dest` in vite.config.ts to match.
const base = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * pdf.js asset URLs — a subset of `DocumentInitParameters`. EVERY URL ends with
 * a trailing slash: pdf.js builds requests by concatenating the URL with a
 * filename (`cMapUrl + "Adobe-Japan1-UCS2.bcmap"`, `wasmUrl + "openjpeg.wasm"`),
 * so a missing slash 404s silently and the decoders never load. The config.test
 * trailing-slash assertion guards this.
 */
export const PDFJS_ASSET_CONFIG = Object.freeze({
  wasmUrl: `${base}wasm/`,
  cMapUrl: `${base}cmaps/`,
  // The bundled cmaps are binary `.bcmap` (also pdf.js's default; set explicitly
  // so the config is self-documenting and decoupled from the default).
  cMapPacked: true,
  iccUrl: `${base}iccs/`,
  standardFontDataUrl: `${base}standard_fonts/`,
});
