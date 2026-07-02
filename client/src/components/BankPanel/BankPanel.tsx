import { useEffect } from "react";
import { X, Highlighter, TextUnderline, PencilSimple, TextT, ChatCircle, type Icon } from "@phosphor-icons/react";
import { useAnnotationStore } from "../../store";
import { bankItems, TYPE_LABEL, type BankItem } from "../../bank";
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

/**
 * `{component.annotation-bank-panel}` (Story 3.6) — the read-only review/recall
 * surface: a 320px right overlay listing every mark in the current document,
 * ordered `created_at` ascending, click-to-jump. Mirrors `TocPanel` (open/close,
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
  const annotations = useAnnotationStore((s) => s.annotations);

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

  const rows = bankItems(annotations.values(), docId);

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

      {rows.length === 0 ? (
        <p className="bank-panel__empty" data-testid="bank-empty">
          No annotations yet.
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
