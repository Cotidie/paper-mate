// store/ — the Zustand working copy of the annotation set (AD-7). Annotations
// are kept in a Map keyed by `id`; the Annotation Bank reads them ordered by
// `created_at` ascending (AR-12).
//
// Scope: an in-memory keyed map + the annotation-mutation action surface (add,
// delete, recolor/restroke/realpha/retext/resizeMemo, and the Story 3.1 move/resize
// geometry edit). This IS the single command path every edit routes through (AD-7,
// AE-3) — no component mutates annotations outside it. The do/undo STACK is here
// (Story 3.2): zundo wraps the store, tracking only `annotations` in temporal
// history. The dirty flag + debounced single-flight autosave (3.4) is a passive
// observer in `useAutosave.ts`, NOT here (AC-7: no new mutation path). The store
// also owns `docId` (Story 5.8): opening/switching a doc sets `docId` and
// `annotations` atomically via the `openDoc` action + its `openDoc` free-function
// wrapper (which also clears zundo history so the loaded set is the undo floor),
// so autosave can bind its PUT target to `store.docId` instead of a defensive
// cross-doc generation guard. This is a LOAD, not a user edit — the ONLY
// non-mutation way the set is set wholesale. Dependency-clean per AD-9: imports
// `api/` types only.
//
// zundo (Story 3.2 / AE-1): `temporal` wraps the store and records the `annotations`
// Map on every mutating `set()`. Partialized to `{ annotations }` only — all other
// state (selectedId, hoveredId, dragPreview, flashId, active* defaults, actions) is
// excluded. Equality: `Object.is` on the Map reference — no-op actions that return
// the same `state` object produce no history entry (the existing no-op guards all
// return `state`, preserving the reference). Limit: 100 entries (cheap; Annotation
// objects are shared across Map snapshots so memory is bounded). Undo/redo is
// client-only, in-memory, discarded on reload (AR-7).
// Access: `useAnnotationStore.temporal.getState().{undo,redo,clear,pause,resume}`.
// Partialize exclusions: docId, selectedId, multiSelectedIds, hoveredId, dragPreview,
// groupDragPreview, flashId, hidden, activeColors, activeStrokeWidth,
// activeAlpha, activeMemoSize, and all action functions.

import { create } from "zustand";
import { temporal } from "zundo";
import type { Annotation } from "@/api/client";
import type { AnnotationTool } from "@/lib/tools";

/** The two tools whose marks carry a user-adjustable `style.alpha`: pen
 *  (Story 2.13) and memo (fix request, the memo twin). */
type AlphaTool = "pen" | "memo";

/** Which edit-frame handle drove a `dragPreview` (Story 10.4): the move grip or
 *  one of the four resize corners. Duplicated here (not imported from the
 *  gesture layer's `EditHandle`) to keep the store's downward-dependency rule
 *  (store sits BELOW gestures) — a renderer needs this to tell a collapsed
 *  memo's move-preview (extent must stay the persisted COLLAPSED size) apart
 *  from its resize-preview (extent IS the live evolving collapsed size). */
type DragPreviewHandle = "move" | "nw" | "ne" | "sw" | "se";

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

/** The SEED default memo size new memos land in: a small SQUARE (Story 3.1 — the
 *  preset SizeRow chooser was removed; memos resize via the edit frame's corner
 *  handles, so the default is just a compact starting box). Once the user resizes a
 *  memo, that size becomes the session default (`activeMemoSize`, last-resize-wins),
 *  so this is only the very first box. `key` stays "medium" for back-compat with
 *  `MemoSize`; the dimensions are independent of the legacy `MEMO_SIZES` presets.
 *  90 = 112 * 0.8 (user fix request: the original default read too large). */
export const DEFAULT_MEMO_SIZE: MemoSize = { key: "medium", width: 90, height: 90 };

export interface AnnotationStore {
  /** The currently open document's id, or `null` when no doc is open (Story
   *  5.8). Owned ATOMICALLY with `annotations` below: both are set together by
   *  `openDoc`, so there is never a window where `annotations` belongs to one
   *  doc while `docId` reads another (AR-6). Autosave (`useAutosave.ts`) binds
   *  its PUT target to this field, read live at flush time. Excluded from the
   *  zundo partialize: undo/redo must never revert which doc is open. */
  docId: string | null;
  /** All annotations, keyed by `id` (AD-7). */
  annotations: Map<string, Annotation>;
  /** The one selected annotation (AD-12), or `null` when nothing is selected.
   *  The single source of truth for SINGLE selection — no parallel field exists
   *  for this mode. UI affordances (the selected ring + selection quick-box) read
   *  this. Client-only; not persisted. Hover (`hoveredId`) is the transient
   *  sibling of this. Mutually exclusive with `multiSelectedIds` (below): setting
   *  one always clears the other, so exactly one selection mode is ever active. */
  selectedId: string | null;
  /** The marks caught by a box-select marquee drag (user feature request), or
   *  `[]` for none. A SEPARATE selection mode from `selectedId` (AD-12 governs
   *  single selection only): multi-select supports bulk Delete + bulk Move, not
   *  recolor/restroke/retext, so it deliberately does not reuse the single
   *  quick-box. Scoped to one page (the page the marquee was dragged on) by the
   *  gesture that populates it. Client-only, not persisted, excluded from the
   *  zundo partialize. */
  multiSelectedIds: string[];
  /** Replace the multi-selection and clear `selectedId` (mutual exclusion). */
  setMultiSelected: (ids: string[]) => void;
  /** Clear the multi-selection (sugar for `setMultiSelected([])`). */
  clearMultiSelection: () => void;
  /** The one hovered annotation, or `null`. Lives in the store (not local layer
   *  state) so a two-page highlight — two annotations in two per-page layers —
   *  outlines as ONE: every layer reads it and matches by `group_id`. Transient;
   *  never persisted, cleared on pointer-leave. */
  hoveredId: string | null;
  /** Global view-only "hide all annotations" flag (Story 5.5, FR-23): a
   *  transient UI toggle, the sibling of `selectedId`/`hoveredId`, NOT
   *  annotation data. When true, `AnnotationLayer` skips its render and
   *  `AnnotationInteraction` goes inert (no create/select/edit). It NEVER
   *  mutates `annotations` and is excluded from the zundo partialize (not
   *  undoable). Resets to `false` on `hydrate` (doc switch/reload) — see the
   *  "Persistence decision" in the story: this is a momentary view toggle,
   *  not a durable preference. */
  hidden: boolean;
  /** Set the hide-all flag directly. Hiding also clears the current selection
   *  (`selectedId` + `multiSelectedIds`) so a hidden mark can't stay selected
   *  behind the scenes; showing leaves selection untouched (there was none
   *  live to restore). Never touches `annotations`. */
  setHidden: (hidden: boolean) => void;
  /** Flip the hide-all flag (sugar for `setHidden(!hidden)`). */
  toggleHidden: () => void;
  /** The active annotation color, PER TOOL (Story 2.6, split per-tool by user
   *  request): the DEFAULT a new mark of that tool lands in. Each tool's entry is
   *  the LAST color chosen for THAT tool — set by its own rail sub-toolbox OR by
   *  recoloring an existing mark of that type (so editing a highlight updates only
   *  the highlight default, not underline/pen/memo/comment). Lives in the store
   *  because two unrelated subtrees write it (the rail's sub-toolbox and the
   *  overlay's recolor) and the create paths read it. Bare token names (DESIGN.md
   *  `{colors.annotation-*}`); client-only, not persisted. */
  activeColors: Record<AnnotationTool, string>;
  /** Set the active/default color for ONE tool (remembers the last choice for
   *  that tool only, for the session). */
  setActiveColor: (tool: AnnotationTool, color: string) => void;
  /** The active pen stroke width (Story 2.8): the DEFAULT new pen strokes land
   *  in, in scale-1.0 CSS px (the renderer multiplies by the current zoom). The
   *  stroke-width twin of `activeColors` — set by the Pen tool's stroke-width
   *  sub-toolbox OR by restroking an existing pen mark (last-choice-wins). Lives
   *  in the store for the same reason `activeColors` does (two writers + the create
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
  /** The active pen/memo alpha (Story 2.13; memo added by user feature request),
   *  PER TOOL (mirrors `activeColors` — split per-tool for the same reason:
   *  changing one tool's opacity must not silently change another's): the
   *  DEFAULT transparency new marks land in (0..1, where 1 is fully opaque/
   *  saturated). Set by each tool's own alpha sub-toolbox OR by re-alphaing an
   *  existing mark of that type (last-choice-wins). Default = 0.4 for both
   *  (highlighter-strength for pen; close to the memo's pre-feature fixed
   *  35% white-blend for memo). Client-only, not persisted. */
  activeAlpha: Record<AlphaTool, number>;
  /** Set the active/default alpha for ONE tool (remembers the last choice). */
  setActiveAlpha: (tool: AlphaTool, alpha: number) => void;
  /** Select an annotation by id, or clear with `null`. Also clears any active
   *  multi-selection (mutual exclusion with `multiSelectedIds`). */
  select: (id: string | null) => void;
  /** Clear the selection (sugar for `select(null)`). */
  clearSelection: () => void;
  /** Set (or clear) the hovered annotation. */
  setHovered: (id: string | null) => void;
  /** Transient live-drag preview (Story 3.1): while a move/resize gesture is in
   *  flight, the dragged mark's IN-PROGRESS anchor, so the layer renders it moving
   *  WITHOUT committing per-pointermove — the commit is ONE `setAnnotationGeometry`
   *  on release (so Story 3.2's zundo records one undo step, not N). UI-only state,
   *  never persisted; EXCLUDE from the zundo partialize like `selectedId`/
   *  `hoveredId`. Null = no drag in flight. */
  dragPreview: { id: string; anchor: Annotation["anchor"]; handle: DragPreviewHandle } | null;
  /** Set or clear the transient drag preview. */
  setDragPreview: (
    preview: { id: string; anchor: Annotation["anchor"]; handle: DragPreviewHandle } | null,
  ) => void;
  /** Transient live GROUP-drag preview: the `dragPreview` twin for a box-select
   *  multi-selection move (user feature request) — every member's IN-PROGRESS
   *  anchor while the group drag is in flight, so the layer renders the whole
   *  group moving without a per-pointermove commit. The ONE commit on release is
   *  `setAnnotationGeometries` (batched, one undo step for the whole group).
   *  UI-only, never persisted, excluded from the zundo partialize. Null = no
   *  group drag in flight. */
  groupDragPreview: { id: string; anchor: Annotation["anchor"] }[] | null;
  /** Set or clear the transient group-drag preview. */
  setGroupDragPreview: (preview: { id: string; anchor: Annotation["anchor"] }[] | null) => void;
  /** The one annotation to briefly emphasize (Annotation Bank jump, Story 3.6):
   *  a `--flash` ring `AnnotationLayer` renders, group-aware like hover/select.
   *  The transient sibling of `hoveredId`/`selectedId` — excluded from the zundo
   *  partialize and never part of `annotations` (AC-6: no new mutation surface). */
  flashId: string | null;
  /** Set (or clear) the flashed annotation. Prefer the free `flashAnnotation`
   *  helper below for the Bank's auto-clearing jump-flash; call this directly
   *  only to clear one early. */
  flash: (id: string | null) => void;
  /** Remove an annotation by id AND every annotation sharing its non-null
   *  `group_id` (a two-page highlight deletes both pages together, AR-4). If the
   *  removed set includes `selectedId`, the selection clears. This is the
   *  client-side delete SEED Story 3.3 reuses — no command stack / undo yet. */
  deleteAnnotation: (id: string) => void;
  /** Remove multiple annotations (by id) AND each one's group siblings, in ONE
   *  batch (so a box-select bulk delete is one undo step, mirroring
   *  `addAnnotations`) — the multi-select twin of `deleteAnnotation`. Clears
   *  `selectedId` if it was among the removed, and always clears
   *  `multiSelectedIds` (nothing is selected after a bulk delete). */
  deleteMany: (ids: string[]) => void;
  /** Insert (or replace by id) an annotation. */
  addAnnotation: (annotation: Annotation) => void;
  /** Insert multiple annotations atomically in a single `set()` so a grouped
   *  create (e.g. a two-page highlight that produces two annotations) lands as
   *  exactly ONE undo step (Story 3.2, AC-4). Single-element lists work too. */
  addAnnotations: (annotations: Annotation[]) => void;
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
  /** Re-alpha one or more pen/memo annotations (by id) to a new transparency and
   *  bump `updated_at` — the alpha twin of `restrokeAnnotation`, from the
   *  selection quick-box's alpha row. Guarded to `kind=path` (pen) or
   *  `kind=rect && type=memo` (alpha is pen/memo-only in the UI; do not write it
   *  onto text/region marks). Same creation-time-edit rationale: no command
   *  stack yet (Epic 3 folds it in). */
  realphaAnnotation: (ids: string[], alpha: number, now: string) => void;
  /** Set a memo's `body` text and bump `updated_at` — called on every keystroke
   *  via the temporal pause/resume coalescing (Story 3.2) so a full editing session
   *  collapses to one undo step. A no-op for an unknown id. */
  retextAnnotation: (id: string, body: string, now: string) => void;
  /** Set `body` on multiple annotations atomically (one `set()`) and bump
   *  `updated_at` — the batch twin of `retextAnnotation` for group-aware comment
   *  edits (Story 3.2). Used for the blur-commit when a comment has group siblings. */
  retextAnnotations: (ids: string[], body: string, now: string) => void;
  /** Flip one or more annotations' `type` + `body` together (Story 3.7, FR-27):
   *  the highlight <-> comment conversion command. Group-aware via the `ids` the
   *  caller passes (the forward/reverse actions resolve group siblings before
   *  calling, like `recolorAnnotation`). No anchor/kind change (AD-5: style/type
   *  only) — the same command path (patchAnnotations) gets undo/redo for free. */
  retypeAnnotation: (ids: string[], type: Annotation["type"], body: string | null, now: string) => void;
  /** Resize one or more memos (by id) to a new box size and bump `updated_at` —
   *  the size twin of `restrokeAnnotation`, from the memo selection quick-box's
   *  `SizeRow`. `size` is the new normalized width/height FRACTION of the page box
   *  (the caller converts the px preset against the memo's page); the top-left
   *  anchor is kept and the rect is regrown. Guarded to `kind=rect`+`type=memo`
   *  so a stale text/path id is never mutated (AR-5). Creation-time edit; no
   *  command stack yet. */
  resizeMemoAnnotation: (ids: string[], size: { w: number; h: number }, now: string) => void;
  /** Collapse/expand one or more memos (by id) and bump `updated_at` — the
   *  collapse twin of `resizeMemoAnnotation`, from the memo's own toggle chevron
   *  (user feature request). Persisted on `style.collapsed` (AD-8, additive
   *  optional field); `None`/`false` = expanded (default), `true` = show only
   *  the memo's first line. Guarded to `kind=rect`+`type=memo`, same as
   *  `resizeMemoAnnotation`. Routes through the normal command path, so it is
   *  undoable like every other restyle (AD-7) — no special-casing. */
  setMemoCollapsed: (ids: string[], collapsed: boolean, now: string) => void;
  /** Resize a comment's OWN note-popup bubble (user feature request) and bump
   *  `updated_at`. Single `id`, not group-aware (unlike recolor/retext): each
   *  page's own bubble is resized independently, since the popup is per-instance
   *  chrome, not shared page-anchored geometry. `size` is CSS px, persisted on
   *  `style.bubble_width`/`bubble_height` (additive optional fields, AD-8).
   *  Guarded to `type=comment` so a stale non-comment id is never mutated
   *  (AR-5). A no-op for an unknown id. */
  resizeCommentAnnotation: (id: string, size: { width: number; height: number }, now: string) => void;
  /** Resize a memo's COLLAPSED box WIDTH (Story 10.4; user decision: collapsed
   *  height is always exactly one intrinsic CSS line, never resizable/persisted
   *  — only width varies) and bump `updated_at`. Written to `style.collapsed_width`
   *  instead of the anchor rect: the anchor rect stays the EXPANDED width, which
   *  is what keeps the two sizes distinct (AC #2). Single `id`, per-instance
   *  (mirrors `resizeCommentAnnotation`, not a group batch). `width` is a
   *  normalized `[0,1]` page-fraction (NOT CSS px, unlike `resizeCommentAnnotation`'s
   *  bubble size) — the collapsed box is page-anchored and must ride zoom
   *  (NFR-3), like `anchor.rect`. Guarded to `kind=rect`+`type=memo`, same shape
   *  as `setMemoCollapsed`/`resizeMemoAnnotation` (AR-5). A no-op for an unknown
   *  id or non-memo (state unchanged, so zundo records no history step). Routes
   *  through the normal command path, so it is one undoable step (AR-7). */
  resizeCollapsedMemo: (id: string, width: number, now: string) => void;
  /** Reposition a comment's OWN note-popup bubble (Story 10.5, FR-31) and bump
   *  `updated_at`. Single `id`, not group-aware (mirrors `resizeCommentAnnotation`'s
   *  scope exactly): only one page's bubble is ever open/draggable at a time, so
   *  there is no sibling to broadcast to. `offset` is a CSS-px, scale-independent
   *  delta from the pin (same unit family as `bubble_width`/`bubble_height`, NOT
   *  a normalized page fraction like `collapsed_width`), persisted on
   *  `style.bubble_offset_x`/`bubble_offset_y` (additive optional fields, AD-8).
   *  Guarded to `type=comment` so a stale non-comment id is never mutated (AR-5).
   *  A no-op for an unknown id. Routes through the normal command path, so it is
   *  one undoable step (AR-7). */
  repositionCommentAnnotation: (id: string, offset: { x: number; y: number }, now: string) => void;
  /** Replace a mark's anchor GEOMETRY (a moved/resized rect or points) and bump
   *  `updated_at` — the Story 3.1 move/resize command-path action, shared by
   *  kind=rect (memo/region/comment-pin) and kind=path (pen). The CALLER (the edit
   *  gesture) computes the new anchor with the `anchor/` helpers (AD-9: the store
   *  does no coordinate math); the discriminator is PRESERVED — a geometry edit
   *  rewrites VALUES only, so a kind change is rejected as a no-op (AC-8). No-op for
   *  an unknown id. kind=text marks are not moved here (Story 3.8 re-resolves them). */
  setAnnotationGeometry: (id: string, anchor: Annotation["anchor"], now: string) => void;
  /** Batch twin of `setAnnotationGeometry`: commits every `{id, anchor}` pair in
   *  ONE `set()` (so a box-select group move is one undo step, mirroring
   *  `addAnnotations`/`retextAnnotations`). Same guards per entry (unknown id or
   *  a kind change is skipped, not written). The CALLER (the group-move gesture)
   *  computes each next anchor via the `anchor/` helpers — the store still does
   *  no coordinate math (AD-9). */
  setAnnotationGeometries: (updates: { id: string; anchor: Annotation["anchor"] }[], now: string) => void;
  /** Replace `docId` AND the whole working copy atomically (hydrate-on-open /
   *  doc-switch, Story 3.5 + 5.8). This is a LOAD, not a user edit — the ONLY
   *  non-mutation way the set is set wholesale. Builds the Map keyed by `id` and
   *  clears the transient UI fields (selection/hover/drag) so nothing from a
   *  prior doc's state survives. Callers use the free `openDoc` function
   *  (below), which also clears zundo history so the loaded set is the undo
   *  floor (AC-4). */
  openDoc: (docId: string, annotations: Annotation[]) => void;
  /** Every annotation, ordered by `created_at` ascending — the Bank order (AR-12). */
  all: () => Annotation[];
}

/** Expand a set of ids to include every sibling sharing a non-null `group_id`
 *  (AR-4: a two-page mark deletes/moves together). Shared by `deleteAnnotation`/
 *  `deleteMany`; unknown ids are ignored. */
function withGroupSiblings(annotations: Map<string, Annotation>, ids: string[]): Set<string> {
  const doomed = new Set<string>();
  for (const id of ids) {
    const target = annotations.get(id);
    if (!target) continue;
    doomed.add(id);
    if (target.group_id) {
      for (const a of annotations.values()) {
        if (a.group_id === target.group_id) doomed.add(a.id);
      }
    }
  }
  return doomed;
}

/** Apply a per-id patch across a set of annotations. For each id present in the
 *  map, `apply` either returns the next annotation (which the helper stamps with
 *  `updated_at`) or `null` to skip it (a failed kind/type guard, e.g. restroke on
 *  a non-pen mark — the mark is left untouched, not bumped). Unknown ids are ignored.
 *  Returns a NEW Map only when at least one annotation changed; returns the ORIGINAL
 *  reference when every `apply` returned null (preserving the Map ref so zundo's
 *  equality check suppresses a spurious history entry, Story 3.2). */
function patchAnnotations(
  annotations: Map<string, Annotation>,
  ids: string[],
  now: string,
  apply: (a: Annotation) => Annotation | null,
): Map<string, Annotation> {
  let next: Map<string, Annotation> | null = null;
  for (const id of ids) {
    const a = (next ?? annotations).get(id);
    if (!a) continue;
    const updated = apply(a);
    if (updated) {
      if (!next) next = new Map(annotations);
      next.set(id, { ...updated, updated_at: now });
    }
  }
  return next ?? annotations;
}

/**
 * Single-id STYLE patch (per-instance popup/box geometry — a comment bubble's
 * size/position, a collapsed memo's width — NOT group-shared geometry, unlike
 * `patchAnnotations`' ids-batch): merge `patch` into annotation `id`'s style,
 * bumping `updated_at`. `guard` narrows to the eligible type/kind; a failed
 * guard OR an unknown id is a reference-preserving no-op (returns the SAME Map),
 * so zundo's `a.annotations === b.annotations` equality records no history entry.
 * The three callers (`resizeCommentAnnotation`, `resizeCollapsedMemo`,
 * `repositionCommentAnnotation`) were byte-identical apart from this guard + the
 * written fields (Story 10.9 refactor).
 */
function patchStyle(
  annotations: Map<string, Annotation>,
  id: string,
  guard: (a: Annotation) => boolean,
  patch: Partial<Annotation["style"]>,
  now: string,
): Map<string, Annotation> {
  const a = annotations.get(id);
  if (!a || !guard(a)) return annotations;
  const next = new Map(annotations);
  next.set(id, { ...a, style: { ...a.style, ...patch }, updated_at: now });
  return next;
}

export const useAnnotationStore = create<AnnotationStore>()(
  temporal(
    (set, get) => ({
      docId: null,
      annotations: new Map(),
      selectedId: null,
      hoveredId: null,
      activeColors: {
        highlight: "annotation-default",
        underline: "annotation-default",
        pen: "annotation-default",
        memo: "annotation-default",
        comment: "annotation-default",
      },
      setActiveColor: (tool, color) =>
        set((state) => ({ activeColors: { ...state.activeColors, [tool]: color } })),
      // Default pen width = the medium step (scale-1.0 px); matches --pen-stroke-medium (8px).
      activeStrokeWidth: 8,
      setActiveStrokeWidth: (width) => set({ activeStrokeWidth: width }),
      // Default memo size = the medium preset (scale-1.0 px); see MEMO_SIZES.
      activeMemoSize: DEFAULT_MEMO_SIZE,
      setActiveMemoSize: (size) => set({ activeMemoSize: size }),
      // Default alpha = highlighter opacity (0.4) for both; mirrors
      // --annotation-highlight-opacity (pen) resp. the memo's old fixed 35% mix.
      activeAlpha: { pen: 0.4, memo: 0.4 },
      setActiveAlpha: (tool, alpha) =>
        set((state) => ({ activeAlpha: { ...state.activeAlpha, [tool]: alpha } })),
      // Mutual exclusion (AD-12 extended, user feature request): selecting one
      // mode always clears the other, so a stale selection can never linger in
      // both places (e.g. a leftover multi-selection ring surviving a plain
      // single click, or vice versa).
      select: (id) => set({ selectedId: id, multiSelectedIds: [] }),
      clearSelection: () => set({ selectedId: null, multiSelectedIds: [] }),
      multiSelectedIds: [],
      setMultiSelected: (ids) => set({ multiSelectedIds: ids, selectedId: null }),
      clearMultiSelection: () => set({ multiSelectedIds: [] }),
      setHovered: (id) => set({ hoveredId: id }),
      hidden: false,
      setHidden: (hidden) =>
        set(hidden ? { hidden, selectedId: null, multiSelectedIds: [] } : { hidden }),
      toggleHidden: () => get().setHidden(!get().hidden),
      dragPreview: null,
      setDragPreview: (preview) => set({ dragPreview: preview }),
      groupDragPreview: null,
      setGroupDragPreview: (preview) => set({ groupDragPreview: preview }),
      flashId: null,
      flash: (id) => set({ flashId: id }),
      deleteAnnotation: (id) =>
        set((state) => {
          const target = state.annotations.get(id);
          if (!target) return state;
          const doomed = withGroupSiblings(state.annotations, [id]);
          const next = new Map(state.annotations);
          for (const did of doomed) next.delete(did);
          const selectedId =
            state.selectedId && doomed.has(state.selectedId) ? null : state.selectedId;
          return { annotations: next, selectedId };
        }),
      deleteMany: (ids) =>
        set((state) => {
          const doomed = withGroupSiblings(state.annotations, ids);
          // Clear the multi-selection UNCONDITIONALLY, even if every id turned out
          // stale (doomed empty): deleteMany means "the multi-selection's bulk
          // delete action fired," so leaving a ghost selection behind on the
          // no-op path would strand its group frame with no live marks to ring.
          if (doomed.size === 0) return { multiSelectedIds: [] };
          const next = new Map(state.annotations);
          for (const did of doomed) next.delete(did);
          const selectedId =
            state.selectedId && doomed.has(state.selectedId) ? null : state.selectedId;
          return { annotations: next, selectedId, multiSelectedIds: [] };
        }),
      addAnnotation: (annotation) =>
        // New Map each mutation so Zustand sees a fresh reference and re-renders.
        set((state) => {
          const next = new Map(state.annotations);
          next.set(annotation.id, annotation);
          return { annotations: next };
        }),
      addAnnotations: (annotations) =>
        // Batch add: one new Map, one set() — one undo step for grouped creates (AC-4).
        set((state) => {
          const next = new Map(state.annotations);
          for (const a of annotations) next.set(a.id, a);
          return { annotations: next };
        }),
      recolorAnnotation: (ids, color, now) =>
        set((state) => ({
          // Recolor has no kind guard — every mark type carries a color.
          annotations: patchAnnotations(state.annotations, ids, now, (a) => ({
            ...a,
            style: { ...a.style, color },
          })),
        })),
      restrokeAnnotation: (ids, width, now) =>
        set((state) => ({
          // stroke_width is path-only style (AR-5): never write it onto a text/region
          // mark, even if a stale id is passed (Codex MED). The guard returns null
          // (skip, no updated_at bump) for a non-path mark.
          annotations: patchAnnotations(state.annotations, ids, now, (a) =>
            a.anchor.kind === "path" ? { ...a, style: { ...a.style, stroke_width: width } } : null,
          ),
        })),
      realphaAnnotation: (ids, alpha, now) =>
        set((state) => ({
          // alpha is pen/memo-only style: never write it onto a text/region-
          // highlight/comment mark, even if a stale id is passed. Guard skips
          // anything else untouched.
          annotations: patchAnnotations(state.annotations, ids, now, (a) =>
            a.anchor.kind === "path" || (a.anchor.kind === "rect" && a.type === "memo")
              ? { ...a, style: { ...a.style, alpha } }
              : null,
          ),
        })),
      retextAnnotation: (id, body, now) =>
        set((state) => {
          const a = state.annotations.get(id);
          if (!a) return state;
          const next = new Map(state.annotations);
          next.set(id, { ...a, body, updated_at: now });
          return { annotations: next };
        }),
      retextAnnotations: (ids, body, now) =>
        // Batch retext: one set() for a group of comment siblings (AC-4).
        set((state) => {
          const next = new Map(state.annotations);
          for (const id of ids) {
            const a = next.get(id);
            if (a) next.set(id, { ...a, body, updated_at: now });
          }
          return { annotations: next };
        }),
      retypeAnnotation: (ids, type, body, now) =>
        set((state) => ({
          // No kind/anchor guard, like recolor — the caller (forward/reverse
          // conversion action) already resolves the correct text-mark group.
          annotations: patchAnnotations(state.annotations, ids, now, (a) => ({ ...a, type, body })),
        })),
      resizeMemoAnnotation: (ids, size, now) =>
        set((state) => ({
          // Size is memo-only geometry (AR-5): only a rect-anchored memo has a box to
          // regrow, even if a stale text/path id is passed. Guard skips others; the
          // top-left anchor is kept and the rect regrown, clamped to the page (<=1).
          annotations: patchAnnotations(state.annotations, ids, now, (a) => {
            if (a.anchor.kind !== "rect" || a.type !== "memo") return null;
            const { x0, y0 } = a.anchor.rect;
            const rect = { x0, y0, x1: Math.min(1, x0 + size.w), y1: Math.min(1, y0 + size.h) };
            return { ...a, anchor: { ...a.anchor, rect } };
          }),
        })),
      setMemoCollapsed: (ids, collapsed, now) =>
        set((state) => ({
          // Collapsed is memo-only style (AR-5), same guard shape as resizeMemoAnnotation.
          annotations: patchAnnotations(state.annotations, ids, now, (a) =>
            a.anchor.kind === "rect" && a.type === "memo"
              ? { ...a, style: { ...a.style, collapsed } }
              : null,
          ),
        })),
      // Three per-instance single-id style patches (Story 10.9: one `patchStyle`
      // helper, guard + fields differ). The bubble/collapsed size is a per-
      // instance popup geometry, not group-shared — mirrors retextAnnotation's
      // single-id scope, not retextAnnotations' group batch. Each returns the SAME
      // root `state` on a no-op (unchanged Map ref), not `{ annotations: sameMap }`
      // — a new root object would make Zustand notify whole-store subscribers on a
      // guarded/unknown-id no-op (the old inline bodies returned `state`).
      resizeCommentAnnotation: (id, size, now) =>
        set((state) => {
          const annotations = patchStyle(
            state.annotations,
            id,
            (a) => a.type === "comment",
            { bubble_width: size.width, bubble_height: size.height },
            now,
          );
          return annotations === state.annotations ? state : { annotations };
        }),
      resizeCollapsedMemo: (id, width, now) =>
        set((state) => {
          const annotations = patchStyle(
            state.annotations,
            id,
            (a) => a.anchor.kind === "rect" && a.type === "memo",
            { collapsed_width: width },
            now,
          );
          return annotations === state.annotations ? state : { annotations };
        }),
      repositionCommentAnnotation: (id, offset, now) =>
        set((state) => {
          const annotations = patchStyle(
            state.annotations,
            id,
            (a) => a.type === "comment",
            { bubble_offset_x: offset.x, bubble_offset_y: offset.y },
            now,
          );
          return annotations === state.annotations ? state : { annotations };
        }),
      setAnnotationGeometry: (id, anchor, now) =>
        set((state) => {
          const a = state.annotations.get(id);
          // No-op for an unknown id OR a kind change: a geometry edit rewrites the
          // anchor's VALUES (rect/points), never its discriminator (AC-8).
          if (!a || anchor.kind !== a.anchor.kind) return state;
          const next = new Map(state.annotations);
          next.set(id, { ...a, anchor, updated_at: now });
          return { annotations: next };
        }),
      setAnnotationGeometries: (updates, now) =>
        set((state) => {
          let next: Map<string, Annotation> | null = null;
          for (const { id, anchor } of updates) {
            const a = (next ?? state.annotations).get(id);
            // Same guards as setAnnotationGeometry: unknown id or a kind change skips.
            if (!a || anchor.kind !== a.anchor.kind) continue;
            if (!next) next = new Map(state.annotations);
            next.set(id, { ...a, anchor, updated_at: now });
          }
          return next ? { annotations: next } : state;
        }),
      openDoc: (docId, annotations) =>
        // A LOAD, not a user edit: set docId + the annotations Map keyed by id
        // TOGETHER in one update (atomic ownership, AC-1) and clear all transient
        // UI state so nothing from a prior doc's state survives (Story 3.5 + 5.8).
        set(() => ({
          docId,
          annotations: new Map(annotations.map((a) => [a.id, a])),
          selectedId: null,
          multiSelectedIds: [],
          hoveredId: null,
          hidden: false,
          dragPreview: null,
          groupDragPreview: null,
          flashId: null,
        })),
      all: () =>
        [...get().annotations.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }),
    {
      // Track only the annotation set. Excludes docId, selectedId, hoveredId,
      // dragPreview, active* defaults, and all action functions from undo
      // history (AC-5) — undo/redo must never revert which doc is open (5.8).
      partialize: (s) => ({ annotations: s.annotations }),
      // 100 entries: generous for normal sessions, bounded so the singleton's memory
      // stays finite (Map snapshots share unchanged Annotation objects, so each entry
      // is cheap — just one new Map and a few changed object references).
      limit: 100,
      // Skip a set() that returns the same Map reference (no-op guard). Every action's
      // no-op branch returns `state` unchanged, preserving the Map ref, so this
      // correctly suppresses spurious history entries (e.g. restroke on a text mark).
      equality: (a, b) => a.annotations === b.annotations,
    },
  ),
);

/**
 * Open a doc into the store: set `docId` + a freshly loaded annotation set
 * atomically, then drop undo history (Story 3.5 hydrate-on-open + Story 5.8
 * doc-scoping). Two steps: (1) the `openDoc` action replaces `docId` and the
 * working copy TOGETHER, so there is never a window where one belongs to the
 * new doc and the other to the old; (2) `temporal.getState().clear()` wipes
 * zundo's past/future so the loaded set is the undo FLOOR — `Ctrl+Z`
 * immediately after opening cannot remove restored marks (AC-4/AC-5).
 * Encapsulating the temporal clear here keeps zundo knowledge inside the store
 * module (the caller in App just calls `openDoc`). Must run BEFORE the reader
 * mounts: with `store.docId` still null, `useAutosave` is inert, so this LOAD
 * becomes the autosave baseline and is never PUT back (AC-5).
 */
export function openDoc(docId: string, annotations: Annotation[]): void {
  useAnnotationStore.getState().openDoc(docId, annotations);
  useAnnotationStore.temporal.getState().clear();
}

/**
 * Idle time (ms) a Bank-jumped mark stays flashed before auto-clearing (Story
 * 3.6, AC-4) — a behavioral timing constant, not a design token (mirrors
 * `Reader.REPAINT_DEBOUNCE`). Exported so tests assert against the real value
 * instead of a duplicated magic number.
 */
export const FLASH_MS = 600;

/** The pending auto-clear timer, module-level so a second `flashAnnotation`
 *  call can cancel the first (below) rather than racing it. */
let flashClearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Flash an annotation (Annotation Bank row click, Story 3.6), then auto-clear
 * it after `FLASH_MS` — the `openDoc` sibling: a free function + side
 * effect that keeps the timer out of `App` and out of React render. Cancels
 * any prior pending clear FIRST, so a rapid second row click retargets the
 * flash to the new mark instead of stranding it unflashed or double-firing a
 * clear on the new one.
 */
export function flashAnnotation(id: string): void {
  if (flashClearTimer) clearTimeout(flashClearTimer);
  useAnnotationStore.getState().flash(id);
  flashClearTimer = setTimeout(() => {
    flashClearTimer = null;
    useAnnotationStore.getState().flash(null);
  }, FLASH_MS);
}
