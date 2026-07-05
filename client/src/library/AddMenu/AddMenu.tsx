import { useEffect, useRef, useState } from "react";
import { Plus, FileArrowUp, FolderOpen } from "@phosphor-icons/react";
import "./AddMenu.css";

/**
 * The Library's Add control (Library layout redesign): a button that opens a
 * small dropdown offering "File upload" (one or more PDFs) or "Folder upload"
 * (every PDF in a chosen folder). Dismiss mirrors `ToolRail`'s flyout pattern:
 * document-level pointerdown/Escape close the menu (CLAUDE.md: bind
 * interaction handlers at document level), and closing returns focus to the
 * button. Presentational: never touches `uploadFiles` itself, just reports
 * which action the user picked via the two callbacks.
 */
export default function AddMenu({
  onFileUpload,
  onFolderUpload,
}: {
  onFileUpload: () => void;
  onFolderUpload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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
  }, [open]);

  return (
    <div className="add-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="add-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus aria-hidden />
        Add
      </button>
      {open && (
        <div className="add-menu__popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="add-menu__item"
            onClick={() => {
              close();
              onFileUpload();
            }}
          >
            <FileArrowUp aria-hidden />
            File upload
          </button>
          <button
            type="button"
            role="menuitem"
            className="add-menu__item"
            onClick={() => {
              close();
              onFolderUpload();
            }}
          >
            <FolderOpen aria-hidden />
            Folder upload
          </button>
        </div>
      )}
    </div>
  );
}
