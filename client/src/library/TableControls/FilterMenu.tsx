import { useState } from "react";
import { createPortal } from "react-dom";
import { Funnel } from "@phosphor-icons/react";
import { COLUMNS, type ColumnFilter, type ColumnKey } from "@/library/tableView";
import { usePopover } from "@/library/usePopover";
import "./TableControls.css";

/**
 * Column + value narrower (AC-4). The column picker and value input are
 * local draft state so a column can be chosen before typing a value without
 * emitting a filter yet; an empty/whitespace value emits `null` (no active
 * filter, all rows return). Re-filters on every keystroke - LNFR-4 is a
 * plain array `.filter()` over the display cache, well within budget.
 */
export default function FilterMenu({
  filter,
  onChange,
}: {
  filter: ColumnFilter | null;
  onChange: (next: ColumnFilter | null) => void;
}) {
  const { open, anchor, buttonRef, popoverRef, toggle } = usePopover();
  const [column, setColumn] = useState<ColumnKey>(filter?.column ?? COLUMNS[0].key);
  const [query, setQuery] = useState(filter?.query ?? "");

  function emit(nextColumn: ColumnKey, nextQuery: string) {
    onChange(nextQuery.trim() === "" ? null : { column: nextColumn, query: nextQuery });
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
        <Funnel aria-hidden />
        Filter
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="table-control__popover table-control__popover--filter"
            style={{ top: anchor.top, right: anchor.right }}
          >
            <select
              className="table-control__select"
              aria-label="Filter column"
              value={column}
              onChange={(e) => {
                const next = e.target.value as ColumnKey;
                setColumn(next);
                emit(next, query);
              }}
            >
              {COLUMNS.map((col) => (
                <option key={col.key} value={col.key}>
                  {col.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="table-control__input"
              aria-label="Filter value"
              placeholder="Filter value"
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                emit(column, next);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
