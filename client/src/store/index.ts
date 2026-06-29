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
  /** The one selected annotation (AD-12), or `null` when nothing is selected.
   *  The single source of truth for selection — no parallel field exists. UI
   *  affordances (the selected ring + selection quick-box) read this. Client-only;
   *  not persisted. Hover (`hoveredId`) is the transient sibling of this. */
  selectedId: string | null;
  /** The one hovered annotation, or `null`. Lives in the store (not local layer
   *  state) so a two-page highlight — two annotations in two per-page layers —
   *  outlines as ONE: every layer reads it and matches by `group_id`. Transient;
   *  never persisted, cleared on pointer-leave. */
  hoveredId: string | null;
  /** Select an annotation by id, or clear with `null`. */
  select: (id: string | null) => void;
  /** Clear the selection (sugar for `select(null)`). */
  clearSelection: () => void;
  /** Set (or clear) the hovered annotation. */
  setHovered: (id: string | null) => void;
  /** Remove an annotation by id AND every annotation sharing its non-null
   *  `group_id` (a two-page highlight deletes both pages together, AR-4). If the
   *  removed set includes `selectedId`, the selection clears. This is the
   *  client-side delete SEED Story 3.3 reuses — no command stack / undo yet. */
  deleteAnnotation: (id: string) => void;
  /** Insert (or replace by id) an annotation. */
  addAnnotation: (annotation: Annotation) => void;
  /** Recolor one or more annotations (by id) and bump `updated_at`. This is the
   *  CREATION-time recolor from the highlight quick-box's swatch row (the mark
   *  was just made in the same gesture), NOT post-hoc editing — so it needs no
   *  command stack. Epic 3 (Story 3.1) routes restyle-of-existing-marks through
   *  the do/undo command path and will fold this in. */
  recolorAnnotation: (ids: string[], color: string, now: string) => void;
  /** Every annotation, ordered by `created_at` ascending — the Bank order (AR-12). */
  all: () => Annotation[];
}

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  annotations: new Map(),
  selectedId: null,
  hoveredId: null,
  select: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),
  setHovered: (id) => set({ hoveredId: id }),
  deleteAnnotation: (id) =>
    set((state) => {
      const target = state.annotations.get(id);
      if (!target) return state;
      // Gather the id plus every sibling sharing a non-null group_id (AR-4).
      const doomed = new Set<string>([id]);
      if (target.group_id) {
        for (const a of state.annotations.values()) {
          if (a.group_id === target.group_id) doomed.add(a.id);
        }
      }
      const next = new Map(state.annotations);
      for (const did of doomed) next.delete(did);
      const selectedId =
        state.selectedId && doomed.has(state.selectedId) ? null : state.selectedId;
      return { annotations: next, selectedId };
    }),
  addAnnotation: (annotation) =>
    // New Map each mutation so Zustand sees a fresh reference and re-renders.
    set((state) => {
      const next = new Map(state.annotations);
      next.set(annotation.id, annotation);
      return { annotations: next };
    }),
  recolorAnnotation: (ids, color, now) =>
    set((state) => {
      const next = new Map(state.annotations);
      for (const id of ids) {
        const a = next.get(id);
        if (a) next.set(id, { ...a, style: { ...a.style, color }, updated_at: now });
      }
      return { annotations: next };
    }),
  all: () =>
    [...get().annotations.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
}));
