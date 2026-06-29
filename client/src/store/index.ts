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

/** A memo box-size preset (Story 2.9). The box dimensions ARE the memo's size:
 *  the rect the placement bakes (and `resizeMemoAnnotation` rewrites) carries
 *  them, so there is NO contract field for size (AD-5). `width`/`height` are
 *  scale-1.0 CSS px; `key` identifies the armed step in `SizeRow`. */
export interface MemoSize {
  key: "small" | "medium" | "large";
  width: number;
  height: number;
}

/** The three memo box sizes the `SizeRow` offers, in scale-1.0 CSS px. Shared by
 *  the placement gesture (bakes the rect), the rail/quick-box `SizeRow`, and the
 *  store default — the single list so the steps and the actual box stay in step. */
export const MEMO_SIZES: MemoSize[] = [
  { key: "small", width: 160, height: 64 },
  { key: "medium", width: 220, height: 88 },
  { key: "large", width: 300, height: 120 },
];

/** The default memo size new memos land in (`activeMemoSize` seed) = medium. */
export const DEFAULT_MEMO_SIZE: MemoSize = MEMO_SIZES[1];

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
  /** The active annotation color (Story 2.6): the DEFAULT new marks land in. It
   *  is the LAST color the user chose — set by the Highlight color sub-toolbox OR
   *  by recoloring an existing mark (so editing a highlight updates the default
   *  too). Lives in the store because two unrelated subtrees write it (the rail's
   *  sub-toolbox and the overlay's recolor) and the create path reads it. A bare
   *  token name (DESIGN.md `{colors.annotation-*}`); client-only, not persisted. */
  activeColor: string;
  /** Set the active/default color (remembers the last choice for the session). */
  setActiveColor: (color: string) => void;
  /** The active pen stroke width (Story 2.8): the DEFAULT new pen strokes land
   *  in, in scale-1.0 CSS px (the renderer multiplies by the current zoom). The
   *  stroke-width twin of `activeColor` — set by the Pen tool's stroke-width
   *  sub-toolbox OR by restroking an existing pen mark (last-choice-wins). Lives
   *  in the store for the same reason `activeColor` does (two writers + the create
   *  path reads it); client-only, not persisted. */
  activeStrokeWidth: number;
  /** Set the active/default pen stroke width (remembers the last choice). */
  setActiveStrokeWidth: (width: number) => void;
  /** The active memo box size (Story 2.9): the DEFAULT new memos land in, in
   *  scale-1.0 CSS px. The size twin of `activeStrokeWidth` — set by the Memo
   *  tool's size sub-toolbox OR by resizing an existing memo from the selection
   *  quick-box (last-choice-wins). Page-independent (px, not a fraction); the
   *  placement gesture converts it to a normalized rect against the target page.
   *  Client-only, not persisted. */
  activeMemoSize: MemoSize;
  /** Set the active/default memo size (remembers the last choice). */
  setActiveMemoSize: (size: MemoSize) => void;
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
  /** Restroke one or more pen annotations (by id) to a new stroke width and bump
   *  `updated_at` — the stroke-width twin of `recolorAnnotation`, from the pen
   *  selection quick-box's stroke-width row. Width is scale-1.0 CSS px. Same
   *  creation-time-edit rationale: no command stack yet (Epic 3 folds it in). */
  restrokeAnnotation: (ids: string[], width: number, now: string) => void;
  /** Set a memo's `body` text and bump `updated_at` — the body twin of
   *  `recolorAnnotation`, called as the user types into the memo's textarea. This
   *  is CREATION-time editing (the memo was just placed in the same gesture), so
   *  no command stack yet (Epic 3 folds it in). A no-op for an unknown id. */
  retextAnnotation: (id: string, body: string, now: string) => void;
  /** Resize one or more memos (by id) to a new box size and bump `updated_at` —
   *  the size twin of `restrokeAnnotation`, from the memo selection quick-box's
   *  `SizeRow`. `size` is the new normalized width/height FRACTION of the page box
   *  (the caller converts the px preset against the memo's page); the top-left
   *  anchor is kept and the rect is regrown. Guarded to `kind=rect`+`type=memo`
   *  so a stale text/path id is never mutated (AR-5). Creation-time edit; no
   *  command stack yet. */
  resizeMemoAnnotation: (ids: string[], size: { w: number; h: number }, now: string) => void;
  /** Flip a `kind=rect` mark's `type` between `highlight` and `comment` and bump
   *  `updated_at`. Sets `body=""` when switching to comment (the bubble edits it)
   *  and `null` when switching back to highlight (no body for a highlight). Guarded
   *  to `anchor.kind === "rect"` so a stale text/path id is never mutated (AR-5).
   *  A no-op for unknown ids. Used by the region quick-box (Story 2.11). */
  retypeRegion: (id: string, type: "highlight" | "comment", now: string) => void;
  /** Every annotation, ordered by `created_at` ascending — the Bank order (AR-12). */
  all: () => Annotation[];
}

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  annotations: new Map(),
  selectedId: null,
  hoveredId: null,
  activeColor: "annotation-default",
  setActiveColor: (color) => set({ activeColor: color }),
  // Default pen width = the medium step (scale-1.0 px); matches --pen-stroke-medium.
  activeStrokeWidth: 4,
  setActiveStrokeWidth: (width) => set({ activeStrokeWidth: width }),
  // Default memo size = the medium preset (scale-1.0 px); see MEMO_SIZES.
  activeMemoSize: DEFAULT_MEMO_SIZE,
  setActiveMemoSize: (size) => set({ activeMemoSize: size }),
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
  restrokeAnnotation: (ids, width, now) =>
    set((state) => {
      const next = new Map(state.annotations);
      for (const id of ids) {
        const a = next.get(id);
        // stroke_width is path-only style (AR-5): never write it onto a text/region
        // mark, even if a stale id is passed (Codex MED).
        if (a && a.anchor.kind === "path") {
          next.set(id, { ...a, style: { ...a.style, stroke_width: width }, updated_at: now });
        }
      }
      return { annotations: next };
    }),
  retextAnnotation: (id, body, now) =>
    set((state) => {
      const a = state.annotations.get(id);
      if (!a) return state;
      const next = new Map(state.annotations);
      next.set(id, { ...a, body, updated_at: now });
      return { annotations: next };
    }),
  retypeRegion: (id, type, now) =>
    set((state) => {
      const a = state.annotations.get(id);
      // Guard: only rect marks can be retyped (AR-5); unknown ids are a no-op.
      if (!a || a.anchor.kind !== "rect") return state;
      const next = new Map(state.annotations);
      next.set(id, {
        ...a,
        type,
        body: type === "comment" ? "" : null,
        updated_at: now,
      });
      return { annotations: next };
    }),
  resizeMemoAnnotation: (ids, size, now) =>
    set((state) => {
      const next = new Map(state.annotations);
      for (const id of ids) {
        const a = next.get(id);
        // Size is memo-only geometry (AR-5): only a rect-anchored memo has a box
        // to regrow, even if a stale text/path id is passed.
        if (a && a.anchor.kind === "rect" && a.type === "memo") {
          const { x0, y0 } = a.anchor.rect;
          const rect = { x0, y0, x1: Math.min(1, x0 + size.w), y1: Math.min(1, y0 + size.h) };
          next.set(id, { ...a, anchor: { ...a.anchor, rect }, updated_at: now });
        }
      }
      return { annotations: next };
    }),
  all: () =>
    [...get().annotations.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
}));
