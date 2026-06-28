/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Dev: Vite serves the SPA with HMR and proxies /api → FastAPI (AD-10).
// Prod: `vite build` emits dist/, which FastAPI serves same-origin.
const API_TARGET = process.env.PAPER_MATE_API_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [
    react(),
    // Emit pdf.js's own bundled decoder/cmap/icc/standard-font assets into
    // dist/pdfjs/<name>/ — matching the URLs in src/render/config.ts — so the
    // worker can fetch them by name at runtime, served same-origin (AD-10). The
    // plugin also serves these targets via dev-server middleware, so the same
    // /pdfjs/ URLs resolve in `npm run dev` and the built dist/ with no per-mode
    // branching. If a `dest` changes, change the matching URL in config.ts.
    // `src` is relative to project root; `dest` relative to build.outDir. The
    // plugin ALWAYS preserves src directory structure, so without `stripBase`
    // the full `node_modules/pdfjs-dist/<name>/` path is recreated under dest.
    // `rename: { stripBase: true }` strips the glob base so files land flat at
    // dist/pdfjs/<name>/ — exactly the URLs in src/render/config.ts.
    viteStaticCopy({
      targets: [
        { src: "node_modules/pdfjs-dist/wasm/*", dest: "pdfjs/wasm", rename: { stripBase: true } },
        { src: "node_modules/pdfjs-dist/cmaps/*", dest: "pdfjs/cmaps", rename: { stripBase: true } },
        { src: "node_modules/pdfjs-dist/iccs/*", dest: "pdfjs/iccs", rename: { stripBase: true } },
        { src: "node_modules/pdfjs-dist/standard_fonts/*", dest: "pdfjs/standard_fonts", rename: { stripBase: true } },
      ],
    }),
  ],
  server: {
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
  },
});
