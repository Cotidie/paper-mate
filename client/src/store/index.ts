// store/ — the Zustand working copy of the annotation set (AD-7). Annotations
// are kept in a Map keyed by `id`; the Annotation Bank reads them ordered by
// `created_at` ascending (AR-12).
//
// Scope (Story 2.2): an in-memory keyed map + an add action only. The command
// stack (do/undo), dirty flag, debounced autosave, and hydrate-on-open are
// Epic 3 — NOT here. Dependency-clean per AD-9: imports `api/` types only, never
// `anchor/`, `annotations/`, or `render/`.

import { create } from "zustand";
import type { Annotation } from "../api/client";

export interface AnnotationStore {
  /** All annotations, keyed by `id` (AD-7). */
  annotations: Map<string, Annotation>;
  /** Insert (or replace by id) an annotation. */
  addAnnotation: (annotation: Annotation) => void;
  /** Every annotation, ordered by `created_at` ascending — the Bank order (AR-12). */
  all: () => Annotation[];
}

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  annotations: new Map(),
  addAnnotation: (annotation) =>
    // New Map each mutation so Zustand sees a fresh reference and re-renders.
    set((state) => {
      const next = new Map(state.annotations);
      next.set(annotation.id, annotation);
      return { annotations: next };
    }),
  all: () =>
    [...get().annotations.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
}));
