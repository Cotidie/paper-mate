import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderSimple } from "@phosphor-icons/react";
import type { Folder } from "@/api/client";
import "./MoveMenu.css";

/**
 * The per-row "Move to folder" affordance (Story 7.2, AC-3): a small popover
 * listing Uncategorized (clears membership) + every folder. Mirrors
 * `AddMenu`'s pattern (CLAUDE.md: don't reinvent a menu) - document-level
 * pointerdown/Escape dismiss, focus returns to the button on close. Every
 * click inside stops propagation so opening/choosing never also
 * arms/selects/opens the row underneath.
 *
 * Portaled to `document.body` and positioned via `position: fixed` anchored
 * from the trigger button's own `getBoundingClientRect()` (live-smoke caught
 * a two-layer bug): (1) a `position: absolute` popover nested inside a table
 * `<td>` visually painted on top but Chromium's table stacking model still
 * routed clicks to a SIBLING row's cell underneath (verified via
 * `elementFromPoint`) - table cells layer positioned descendants separately
 * from normal stacking, so no z-index escapes it; (2) switching to
 * `position: fixed` alone still resolved against the wrong containing block,
 * because `.collection-table__row-actions` (the hover-reveal wrapper) sets
 * `transform: translateY(-50%)` - a `transform` on ANY ancestor makes IT the
 * containing block for `position: fixed` descendants (CSS spec), not the
 * viewport. A portal sidesteps both: rendered as a child of `document.body`,
 * the popover is never a descendant of the table or the transformed wrapper.
 * The anchor is measured once at open (not re-tracked), so a scroll of the
 * table while the menu is open can visually detach it from its row until the
 * next outside click/Escape closes it - a minor, acceptable edge case (same
 * tradeoff `AddMenu` and `FolderPanel`'s menus already accept).
 */
export default function MoveMenu({
  folders,
  onMove,
  onOpenChange,
}: {
  folders: Folder[];
  onMove: (folderId: string | null) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const open = anchor !== null;

  function setOpen(value: boolean) {
    if (value) {
      const rect = buttonRef.current!.getBoundingClientRect();
      setAnchor({ top: rect.bottom, right: window.innerWidth - rect.right });
    } else {
      setAnchor(null);
    }
    onOpenChange?.(value);
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
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

  return (
    <div className="move-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="move-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <FolderSimple aria-hidden />
        Move to folder
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="move-menu__popover"
            role="menu"
            style={{ top: anchor.top, right: anchor.right }}
          >
            <button
              type="button"
              role="menuitem"
              className="move-menu__item"
              onClick={(e) => {
                e.stopPropagation();
                close();
                onMove(null);
              }}
            >
              Uncategorized
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                role="menuitem"
                className="move-menu__item"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  onMove(folder.id);
                }}
              >
                {folder.name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
