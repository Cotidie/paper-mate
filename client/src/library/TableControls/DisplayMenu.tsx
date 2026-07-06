import { createPortal } from "react-dom";
import { Columns } from "@phosphor-icons/react";
import { COLUMNS, type ColumnKey } from "@/library/tableView";
import { usePopover } from "@/library/usePopover";
import "./TableControls.css";

const HIDEABLE_COLUMNS = COLUMNS.filter((c) => c.hideable);

/**
 * Column-visibility toggle (AC-1). Title is never offered - it carries the
 * Open button + inline-edit affordance, so hiding it would strand the only
 * way to open/rename a paper (see the story's "Divergence to record"). Stays
 * open across checkbox toggles so multiple columns can be flipped in one
 * pass; only Escape/outside-click/re-clicking the trigger closes it.
 */
export default function DisplayMenu({
  hiddenColumns,
  onToggleColumn,
}: {
  hiddenColumns: Set<ColumnKey>;
  onToggleColumn: (key: ColumnKey) => void;
}) {
  const { open, anchor, buttonRef, popoverRef, toggle } = usePopover();

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
        <Columns aria-hidden />
        Display
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="table-control__popover"
            role="menu"
            style={{ top: anchor.top, right: anchor.right }}
          >
            {HIDEABLE_COLUMNS.map((col) => (
              <label key={col.key} className="table-control__checkbox-item">
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(col.key)}
                  onChange={() => onToggleColumn(col.key)}
                />
                {col.label}
              </label>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
