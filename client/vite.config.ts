/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite serves the SPA with HMR and proxies /api → FastAPI (AD-10).
// Prod: `vite build` emits dist/, which FastAPI serves same-origin.
const API_TARGET = process.env.PAPER_MATE_API_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
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
