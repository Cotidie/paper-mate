import { useEffect, useRef, useState } from "react";

export interface PopoverAnchor {
  top: number;
  right: number;
}

/**
 * The shared popover behavior behind `MoveMenu` (Story 7.2) - factored out
 * for the three Story 7.4 table controls (CLAUDE.md: adopt stable solutions,
 * don't paste the same popover three more times). Owns: `position: fixed`
 * anchoring off the trigger button's own `getBoundingClientRect()` (a portal
 * escapes the table's stacking/paint model and any transformed ancestor -
 * see `MoveMenu`'s doc comment for the live-smoke bugs this avoids),
 * document-level pointerdown/Escape dismiss, and focus return to the trigger
 * on close. The caller renders the trigger `<button ref={buttonRef}>` and,
 * when `anchor` is non-null, portals a popover `<div ref={popoverRef}>` to
 * `document.body` positioned at `{ top: anchor.top, right: anchor.right }`.
 */
export function usePopover() {
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;

  function openPopover() {
    const rect = buttonRef.current!.getBoundingClientRect();
    setAnchor({ top: rect.bottom, right: window.innerWidth - rect.right });
  }

  function close() {
    setAnchor(null);
    buttonRef.current?.focus();
  }

  function toggle() {
    if (open) setAnchor(null);
    else openPopover();
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { open, anchor, buttonRef, popoverRef, toggle, close };
}
