// domFocus.ts — shared "should a global document-level handler skip this
// event because the focused/clicked target already owns it?" predicates.
// Two shapes, because a plain BUTTON has different native semantics for
// clicks/Space vs. arbitrary letter/Ctrl hotkeys: a click or Space on a
// focused button IS the button's own action (so pointer-gesture starts and
// the Reader's hold-Space-to-pan handler must skip BUTTON/SELECT too), but a
// letter or Ctrl chord has no native meaning on a plain button (so keyboard
// hotkey handlers must NOT skip it — otherwise the last-clicked tool-rail
// button, or a selection quick-box swatch, silently swallows every later
// hotkey until the user clicks elsewhere). A ZERO-IMPORT leaf (mirrors
// `tools.ts`) so Reader/App/annotations can all import it without an upward
// dependency (AD-9).

/** Editable text fields only. For keyboard-hotkey handlers (undo/redo, the
 *  tool-rail hotkeys, Escape): a focused BUTTON has no native typing/text-undo
 *  behavior to defer to, so hotkeys must still fire. */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/** Editable fields + interactive controls (BUTTON/SELECT). For pointer-gesture
 *  starts and the Space-to-pan handler: a click/Space IS the control's own
 *  action, so it must not also arm a drag or pan. */
export function isControlTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || el.isContentEditable
  );
}
