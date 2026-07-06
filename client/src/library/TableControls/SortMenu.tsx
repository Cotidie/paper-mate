import { createPortal } from "react-dom";
import { CaretDown, CaretUp, SortAscending } from "@phosphor-icons/react";
import { COLUMNS, type ColumnKey, type SortState } from "@/library/tableView";
import { usePopover } from "@/library/usePopover";
import "./TableControls.css";

const SORTABLE_COLUMNS = COLUMNS.filter((c) => c.sortable);

/**
 * Column + direction picker (AC-2). Picking a column sorts it ascending;
 * picking the already-active column toggles its direction; "Default order"
 * clears the sort (null - the backend response order). Stays open across
 * picks so asc/desc can be toggled without reopening; the active
 * column+direction is reflected inline with a caret (mirrors the header's).
 */
export default function SortMenu({
  sort,
  onChange,
}: {
  sort: SortState | null;
  onChange: (next: SortState | null) => void;
}) {
  const { open, anchor, buttonRef, popoverRef, toggle } = usePopover();

  function pick(column: ColumnKey) {
    if (sort?.column === column) {
      onChange({ column, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      onChange({ column, direction: "asc" });
    }
  }

  return (
    <div className="table-control">
      <button
        ref={buttonRef}
        type="button"
        className="toolbar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") e.stopPropagation();
        }}
      >
        <SortAscending aria-hidden />
        Sort
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="table-control__popover"
            role="menu"
            style={{ top: anchor.top, right: anchor.right }}
          >
            <button
              type="button"
              role="menuitem"
              className="table-control__item"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            >
              Default order
            </button>
            {SORTABLE_COLUMNS.map((col) => (
              <button
                key={col.key}
                type="button"
                role="menuitem"
                className="table-control__item"
                onClick={(e) => {
                  e.stopPropagation();
                  pick(col.key);
                }}
              >
                {col.label}
                {sort?.column === col.key &&
                  (sort.direction === "asc" ? <CaretUp aria-hidden /> : <CaretDown aria-hidden />)}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
