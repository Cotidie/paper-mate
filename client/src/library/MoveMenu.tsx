import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderSimple } from "@phosphor-icons/react";
import type { Folder } from "@/api/client";
import "./MoveMenu.css";

/**
 * The folder-picker affordance (Story 7.2, AC-3): a small popover listing
 * Uncategorized (clears membership) + every folder, used by `LibraryPage`'s
 * toolbar "Move" button (bulk move of the checked rows). Mirrors `AddMenu`'s
 * pattern (CLAUDE.md: don't reinvent a menu) - document-level
 * pointerdown/Escape dismiss, focus returns to the button on close. Every
 * click inside stops propagation.
 *
 * Portaled to `document.body` and positioned via `position: fixed` anchored
 * from the trigger button's own `getBoundingClientRect()` (a live-smoke
 * caught bug from this menu's first home, nested per-row in the table:
 * (1) a `position: absolute` popover in a table `<td>` was visually painted
 * on top but Chromium's table stacking model still routed clicks to a
 * SIBLING row's cell underneath, verified via `elementFromPoint` - table
 * cells layer positioned descendants separately from normal stacking, so no
 * z-index escapes it; (2) `position: fixed` alone still resolved against the
 * wrong containing block, because the hover-reveal wrapper it sat in used
 * `transform: translateY(-50%)` - a `transform` on ANY ancestor makes IT the
 * containing block for `position: fixed` descendants (CSS spec), not the
 * viewport). A portal sidesteps both, and the toolbar's own trigger button
 * (not nested in a table or a transformed ancestor) never hits either issue
 * in the first place - kept anyway since it's the more robust default.
 */
export default function MoveMenu({
  folders,
  onMove,
  onOpenChange,
  label = "Move to folder",
  disabled = false,
}: {
  folders: Folder[];
  onMove: (folderId: string | null) => void;
  onOpenChange?: (open: boolean) => void;
  label?: string;
  disabled?: boolean;
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
        className="toolbar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <FolderSimple aria-hidden />
        {label}
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
