// useUndoRedo — document-level Ctrl+Z / Ctrl+Shift+Z keybindings (Story 3.2).
// A standalone handler (NOT folded into useSelection) because useSelection
// early-returns on e.ctrlKey and requires a current selection; undo must work
// with nothing selected and IS a ctrl chord (per AP-1 + CLAUDE.md).
// Phase-gated (`enabled`). Only EDITABLE fields are exempt (not buttons), so
// Ctrl+Z inside a memo/comment textarea does the browser's native text undo,
// while Ctrl+Z right after a create — when the selection quick-box has focused
// its first swatch <button> — still undoes the annotation.

import { useEffect } from "react";
import { useAnnotationStore } from "@/store";
import { isEditableTarget } from "@/lib/domFocus";

export function useUndoRedo({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const isZ = e.key === "z" || e.key === "Z";
      const isY = e.key === "y" || e.key === "Y";
      if (!isZ && !isY) return;

      if (isZ && !e.shiftKey) {
        // Ctrl+Z / Cmd+Z → undo
        e.preventDefault();
        useAnnotationStore.temporal.getState().undo();
      } else if ((isZ && e.shiftKey) || isY) {
        // Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y → redo
        e.preventDefault();
        useAnnotationStore.temporal.getState().redo();
      } else {
        return;
      }

      // Reconcile: if the selected annotation was removed by undo, clear the selection
      // so no stale ring or quick-box shows (AC-5).
      const { selectedId, annotations } = useAnnotationStore.getState();
      if (selectedId && !annotations.has(selectedId)) {
        useAnnotationStore.getState().clearSelection();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
