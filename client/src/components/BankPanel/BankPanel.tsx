import { useEffect } from "react";
import { X, Highlighter, TextUnderline, PencilSimple, TextT, ChatCircle, type Icon } from "@phosphor-icons/react";
import { TYPE_LABEL, BANK_FILTER_TYPES, type BankItem } from "@/lib/bank";
import type { Annotation } from "@/api/client";
import { useBankView } from "./useBankView";
import "./BankPanel.css";

/** The rail's own per-tool glyph (ToolRail.tsx), reused so a Bank row reads as
 *  the same tool that made the mark. */
const TYPE_ICON: Record<BankItem["type"], Icon> = {
  highlight: Highlighter,
  underline: TextUnderline,
  pen: PencilSimple,
  memo: TextT,
  comment: ChatCircle,
};

/** Empty-state copy, adapted to the active filter (Story 8.2 AC #3). The
 *  comments-only default (the common case: an unread paper with no comments
 *  yet) gets its own line; any other selection reads generically so the
 *  message never needs to enumerate an arbitrary type subset. */
function emptyMessage(activeTypes: ReadonlySet<Annotation["type"]>): string {
  if (activeTypes.size === 1 && activeTypes.has("comment")) return "No comments yet.";
  return "No annotations match this filter.";
}

/**
 * `{component.annotation-bank-panel}` (Story 3.6) — the read-only review/recall
 * surface: a 320px right overlay listing every mark in the current document,
 * ordered in reading order (page, then on-page position, Story 8.3), click-to-jump. Mirrors `TocPanel` (open/close,
 * Esc, internal scroll, `<button>` rows, empty state) but the data is genuinely
 * store-owned (unlike ToC's App-owned outline), so this component subscribes
 * directly (AD-9: keeps `App` thin, the same idiom `AnnotationLayer` uses).
 */
export default function BankPanel({
  open,
  docId,
  onJump,
  onClose,
}: {
  open: boolean;
  docId: string;
  onJump: (item: BankItem) => void;
  onClose: () => void;
}) {
  const { rows, activeTypes, toggleType } = useBankView(open, docId);

  // Esc closes (UX-DR17), mirroring TocPanel verbatim. Listener mounted only
  // while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="bank-panel" data-testid="bank-panel" aria-label="Annotation bank">
      <div className="bank-panel__header">
        <span className="bank-panel__title">Annotations</span>
        <button
          type="button"
          className="bank-panel__close"
          aria-label="Close annotation bank"
          title="Close (Esc)"
          data-testid="bank-close"
          onClick={onClose}
        >
          <X aria-hidden />
        </button>
      </div>

      <div className="bank-panel__filter" role="group" aria-label="Filter by annotation type">
        {BANK_FILTER_TYPES.map((type) => {
          const ChipIcon = TYPE_ICON[type];
          const pressed = activeTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              className="bank-filter-chip"
              data-testid={`bank-filter-${type}`}
              aria-pressed={pressed}
              aria-label={TYPE_LABEL[type]}
              title={TYPE_LABEL[type]}
              onClick={() => toggleType(type)}
            >
              <ChipIcon aria-hidden className="bank-filter-chip__icon" />
              <span className="bank-filter-chip__label">{TYPE_LABEL[type]}</span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="bank-panel__empty" data-testid="bank-empty">
          {emptyMessage(activeTypes)}
        </p>
      ) : (
        <ul className="bank-panel__list">
          {rows.map((item) => {
            const RowIcon = TYPE_ICON[item.type];
            // The visible glyph is decorative; the accessible name always leads
            // with the TYPE + page so the row never reads as just the bare
            // snippet (Codex review finding: a placeholder like "Region" is not
            // the same word as its type "Highlight", so it must not replace the
            // type label). The snippet is appended only when it says something
            // the type label doesn't already (skips the redundant "Pen stroke,
            // page 2: Pen stroke" case).
            const name =
              item.snippet === TYPE_LABEL[item.type]
                ? `${TYPE_LABEL[item.type]}, page ${item.page}`
                : `${TYPE_LABEL[item.type]}, page ${item.page}: ${item.snippet}`;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="bank-row"
                  data-testid={`bank-row-${item.id}`}
                  aria-label={name}
                  onClick={() => onJump(item)}
                >
                  <RowIcon aria-hidden className="bank-row__icon" />
                  <span
                    className="bank-row__dot"
                    aria-hidden
                    style={{ backgroundColor: `var(--color-${item.colorToken})` }}
                  />
                  <span
                    className={
                      item.isPlaceholder ? "bank-row__snippet bank-row__snippet--placeholder" : "bank-row__snippet"
                    }
                  >
                    {item.snippet}
                  </span>
                  <span className="bank-row__page">p.{item.page}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
