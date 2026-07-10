import { useEffect, useRef, useState } from "react";
import type { CollectionRow } from "@/api/client";

const EMPTY_SELECTED: Set<string> = new Set();

/**
 * The one selection model (fix request: this used to be two disjoint pieces
 * of state - a table-local single `selectedId` for a plain-click arm, and a
 * lifted `checkedIds` for Ctrl/Cmd+click multi-select - that never synced).
 * Owns the ONE `selectedIds` set (controlled-or-uncontrolled like
 * `<input value onChange>`), the Shift-range `anchorRef`, the empty-set anchor
 * reset, and the blur-vs-click `suppressClickRef` discipline.
 *
 * Three gestures write the set: a plain row click REPLACES it with just that
 * row (or clears it, if that row was already the sole selection - a toggle-off),
 * and moves the anchor to that row; Ctrl/Cmd+click toggles ONE row's membership
 * (moving the anchor only on a toggle-ON); Shift+click REPLACES the set with the
 * inclusive range between the anchor and the clicked row (by index into the
 * rendered `rows` order), without moving the anchor, so successive Shift+clicks
 * re-range from the same pivot (Finder/Explorer semantics). All three are
 * intercepted at the row's CAPTURE phase so they never also arm/edit/open the
 * row; Shift+click also `preventDefault`s to suppress the browser's native
 * shift-extends-text-selection sweep.
 */
export function useRowSelection({
  rows,
  selectedIds: controlledSelectedIds,
  onSelectionChange,
}: {
  rows: CollectionRow[];
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}) {
  // Controlled-or-uncontrolled (like `<input value onChange>`): when the
  // caller doesn't pass `selectedIds`, the table owns the set itself so
  // isolated tests of the arm/edit flow don't need to wire a selection
  // controller they don't care about.
  const [internalSelected, setInternalSelected] = useState<Set<string>>(EMPTY_SELECTED);
  const selectedIds = controlledSelectedIds ?? internalSelected;
  function commitSelected(next: Set<string>) {
    if (controlledSelectedIds === undefined) setInternalSelected(next);
    onSelectionChange?.(next);
  }
  // The Shift+click range pivot: the row last plain-clicked or Ctrl/Cmd
  // toggled-on. A ref, not state - read synchronously inside the click
  // handler and never needs to trigger its own render (the visible selection
  // re-renders via `selectedIds`). Table-local because a range is defined
  // over the CURRENTLY RENDERED `rows` order, which only the table has.
  const anchorRef = useRef<string | null>(null);
  // `LibraryPage` clears `selectedIds` from outside (folder switch, post-move)
  // - the table can't know to drop its pivot except by observing the
  // emptied set, so without a stale anchor could range from a paper that is
  // no longer where the user thinks it is.
  useEffect(() => {
    if (selectedIds.size === 0) anchorRef.current = null;
  }, [selectedIds]);

  // A click that lands elsewhere while a cell is being edited blurs the
  // InlineEditor (auto-committing it) BEFORE the click event itself is
  // dispatched — without a guard, the SAME click that closes one field's
  // edit would immediately arm/edit/open whatever it landed on (fix
  // request: clicking away should only finish editing, not chain into a
  // new action). Set true only inside the actual blur-commit path
  // (`commitEdit(..., viaBlur=true)`) — never on a bare mousedown, which
  // would also fire for an unrelated mousedown *inside* the still-focused
  // input (e.g. repositioning the caret) and could then wrongly swallow a
  // later, unrelated keyboard-triggered action (no mousedown precedes a
  // keyboard Enter/Space activation, so a mousedown-based guard could go
  // stale and eat it). Consumed (checked-and-reset) by the gesture handlers.
  const suppressClickRef = useRef(false);

  /** Arm the one-shot blur-commit suppression (called by `commitEdit`/
   *  `commitAuthors` when they close a cell via blur). */
  function suppressNextClick() {
    suppressClickRef.current = true;
  }

  // Consume a pending blur-commit suppression: true means "this gesture is the
  // click that just finished an edit; swallow it once". Returns whether it was
  // suppressed so the caller can bail.
  function consumeSuppressedClick(): boolean {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }

  // A plain click always REPLACES the selection with just this row (fix
  // request: previously this only updated a separate `selectedId`, leaving
  // any Ctrl/Cmd-checked rows from a prior multi-select still highlighted).
  // Clicking the row that is already the sole selection toggles it off.
  function handleRowClick(docId: string) {
    if (consumeSuppressedClick()) return;
    const isSoleSelected = selectedIds.size === 1 && selectedIds.has(docId);
    if (isSoleSelected) {
      anchorRef.current = null;
      commitSelected(new Set());
    } else {
      anchorRef.current = docId;
      commitSelected(new Set([docId]));
    }
  }

  // Ctrl/Cmd+click toggles multi-select; Shift+click replaces the selection
  // with the inclusive range from the anchor. Both fire in the CAPTURE phase
  // (before the Title/Authors cells' own bubble-phase click handlers), so
  // `stopPropagation` here keeps them from ALSO arming the row, entering edit
  // mode, or opening the reader.
  function handleRowClickCapture(e: React.MouseEvent<HTMLTableRowElement>, docId: string) {
    // The DOI cell's link is a plain external-link gesture (AC-6): a
    // modifier-click on it must open/copy the link like any other anchor,
    // not ALSO toggle/range-select the row. This runs in the CAPTURE phase
    // (before the link's own bubble-phase stopPropagation), so it must bail
    // out here rather than relying on the link's handler to undo it.
    if ((e.target as HTMLElement).closest("a")) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // The Title/Authors <td> is tabIndex=0 (EditableCell's Enter-to-edit
      // keyboard path). The browser's native mousedown default already
      // focused it, if the click landed there, before this click handler
      // ever runs - preventDefault/stopPropagation on the click event can't
      // retroactively undo a mousedown-time focus change. Left alone, a
      // modifier-click leaves a stray focus ring on the cell, and a later
      // bare Enter on it would fire onArm() and collapse the whole
      // selection back to one row (armed is false during a multi-select, so
      // EditableCell's onKeyDown treats Enter as "arm", not "edit"). Blur
      // it back off, scoped to this row so an unrelated focused element
      // elsewhere on the page is never touched.
      const active = document.activeElement;
      if (active instanceof HTMLElement && e.currentTarget.contains(active)) active.blur();
    }
    if (e.shiftKey) {
      e.stopPropagation();
      // Browser default: Shift+click extends the native text selection to
      // the click point, which across table cells paints an ugly blue sweep.
      // `stopPropagation` doesn't stop it (it's the browser default action,
      // not a React handler) - `preventDefault` does.
      e.preventDefault();
      const anchorIdx =
        anchorRef.current === null ? -1 : rows.findIndex((r) => r.doc_id === anchorRef.current);
      if (anchorIdx === -1) {
        // No pivot, or the pivot was filtered out of the current view:
        // degrade to a plain single-select rather than a no-op.
        anchorRef.current = docId;
        commitSelected(new Set([docId]));
        return;
      }
      const targetIdx = rows.findIndex((r) => r.doc_id === docId);
      const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
      // Anchor never moves here (AC-2): successive Shift+clicks re-range
      // from the same pivot.
      commitSelected(new Set(rows.slice(start, end + 1).map((r) => r.doc_id)));
      return;
    }
    if (!e.ctrlKey && !e.metaKey) return;
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(docId)) {
      next.delete(docId);
    } else {
      next.add(docId);
      anchorRef.current = docId;
    }
    commitSelected(next);
  }

  return {
    selectedIds,
    commitSelected,
    handleRowClick,
    handleRowClickCapture,
    consumeSuppressedClick,
    suppressNextClick,
  };
}
