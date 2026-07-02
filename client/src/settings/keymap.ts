// settings/keymap.ts — the keymap-as-data enabler (Story 5.1, AC-1). A leaf
// module (zero imports beyond its own types) so both App's document keydown
// handler and the SettingsModal capture UI depend on it without an upward
// dependency (AD-9). `Escape` is deliberately NOT a `KeyAction`: it stays a
// hard-coded reserved dismiss/deselect in App, never routed through the
// keymap (see App.tsx's unified keydown effect).

export type KeyAction =
  | "cursor"
  | "highlight"
  | "underline"
  | "pen"
  | "memo"
  | "comment"
  | "boxHighlight"
  | "toggleRail"
  | "toggleBank";

/** Iteration order for the Settings modal's keybinding pane rows. */
export const KEY_ACTIONS: KeyAction[] = [
  "cursor",
  "highlight",
  "underline",
  "pen",
  "memo",
  "comment",
  "boxHighlight",
  "toggleRail",
  "toggleBank",
];

/** shift/alt/meta are not user-settable in v1 — only a single key + optional
 *  ctrl chord. */
export interface KeyBinding {
  key: string;
  ctrl?: boolean;
}

export const DEFAULT_KEYMAP: Record<KeyAction, KeyBinding> = {
  cursor: { key: "v" },
  highlight: { key: "h" },
  underline: { key: "u" },
  pen: { key: "d" },
  memo: { key: "t" },
  comment: { key: "c" },
  boxHighlight: { key: "m" },
  toggleRail: { key: "[" },
  toggleBank: { key: "b", ctrl: true },
};

/** Human labels for the Settings modal's keybinding pane rows. */
export const ACTION_LABELS: Record<KeyAction, string> = {
  cursor: "Cursor",
  highlight: "Highlight",
  underline: "Underline",
  pen: "Pen",
  memo: "Memo",
  comment: "Comment",
  boxHighlight: "Box highlight",
  toggleRail: "Toggle tool rail",
  toggleBank: "Toggle annotation bank",
};

/** Single characters compare case-insensitively (so both "h" and "H" match a
 *  lowercase binding); multi-char key names (`"PageUp"`, `"["`, `" "`) compare
 *  as-is. */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  return normalizeKey(a.key) === normalizeKey(b.key) && !!a.ctrl === !!b.ctrl;
}

/** Resolve a keydown event to the bound action, or null if nothing matches. */
export function matchAction(
  keymap: Record<KeyAction, KeyBinding>,
  e: Pick<KeyboardEvent, "key" | "ctrlKey">,
): KeyAction | null {
  const pressed: KeyBinding = { key: e.key, ctrl: e.ctrlKey };
  for (const action of KEY_ACTIONS) {
    if (bindingsEqual(keymap[action], pressed)) return action;
  }
  return null;
}

/** Reserved capture targets (AC-3): never assignable to any action regardless
 *  of the current keymap. Mirrors what `Reader.tsx` (zoom/pan/page-nav) and
 *  the store's undo/redo already own, plus browser/OS-critical chords.
 *  `Escape` is included defensively even though it is never a keymap
 *  candidate in the first place. */
export function isReserved(binding: KeyBinding): boolean {
  const key = binding.key.toLowerCase();
  if (key === "escape") return true;
  // PgUp/PgDn move a page regardless of a Ctrl chord (Reader.tsx handleKeyDown).
  if (key === "pageup" || key === "pagedown") return true;
  if (/^f([1-9]|1[0-2])$/.test(key)) return true;
  if (binding.ctrl) {
    // Ctrl +/-/0 (also "=" as the unshifted "+") zoom; Ctrl Z undo/redo;
    // Ctrl W/T/N/R/L are browser/OS-critical chords. "i" is blocked
    // unconditionally because capture/match drop shiftKey (KeyBinding has no
    // shift field, v1), so Ctrl+Shift+I (devtools, AC-3) is indistinguishable
    // from Ctrl+I at this layer — reserving the bare key is the only way to
    // also block the shifted chord.
    if (["+", "=", "-", "0", "z", "w", "t", "n", "r", "l", "i"].includes(key)) return true;
    // Ctrl Up/Down are the page-nav aliases (Reader.tsx ctrlArrow).
    if (key === "arrowup" || key === "arrowdown") return true;
  } else {
    // Bare Space is the reader's hold-to-pan key.
    if (key === " ") return true;
  }
  return false;
}

/** The action (if any) already bound to `binding`, excluding `exclude` itself
 *  (so rebinding an action to its OWN current key is never reported as a
 *  conflict with itself). */
export function findConflict(
  keymap: Record<KeyAction, KeyBinding>,
  binding: KeyBinding,
  exclude: KeyAction,
): KeyAction | null {
  for (const action of KEY_ACTIONS) {
    if (action === exclude) continue;
    if (bindingsEqual(keymap[action], binding)) return action;
  }
  return null;
}

/** Render a binding as its capture-chip label, e.g. `{ key: "b", ctrl: true }`
 *  → "Ctrl B". Single letters are upper-cased for display only (the stored
 *  binding itself stays lower-case, matched case-insensitively). */
export function formatBinding(binding: KeyBinding): string {
  const key = binding.key === " " ? "Space" : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  return binding.ctrl ? `Ctrl ${key}` : key;
}
