import TagEditor from "./TagEditor";

/**
 * The Author `<td>` (Story 7.11): each author renders as a distinct,
 * uniform, click-to-filter chip. Mirrors `EditableCell`'s arm→edit lifecycle
 * (see the story's Dev Notes, "the chip-click vs cell-arm interaction"), but
 * a chip click is a THIRD, always-available gesture that never arms or
 * edits, in any state:
 *
 * - Chip click (any state): `stopPropagation` → `onFilterByAuthor`.
 * - Cell background click, UNARMED: bubbles to the `<tr>` → arms the row
 *   (same as `EditableCell`'s unarmed path).
 * - Cell background click, ARMED (lone selection): opens the tag editor
 *   directly (no separate isEditing click-again step - mirrors
 *   `EditableCell`'s armed→edit path via the shared `editingField` cursor).
 */
export default function TagCell({
  authors,
  editable,
  armed,
  isEditing,
  onStartEdit,
  onArm,
  onFilterByAuthor,
  onCommit,
  onCancel,
}: {
  authors: string[];
  editable: boolean;
  armed: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onArm: () => void;
  onFilterByAuthor: (author: string) => void;
  onCommit: (authors: string[]) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <td className="collection-table__authors">
        <TagEditor authors={authors} onCommit={onCommit} onCancel={onCancel} />
      </td>
    );
  }

  const chips = (
    <div className="tag-cell__chips">
      {authors.map((author) => (
        <button
          key={author}
          type="button"
          className="tag-chip"
          onClick={(e) => {
            e.stopPropagation();
            onFilterByAuthor(author);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {author}
        </button>
      ))}
    </div>
  );

  if (!editable) {
    return (
      <td className="collection-table__authors" title={authors.join(", ") || undefined}>
        {chips}
      </td>
    );
  }

  return (
    <td
      className="collection-table__authors"
      title={authors.join(", ") || undefined}
      tabIndex={0}
      aria-label="Edit authors"
      onClick={(e) => {
        if (armed) {
          e.stopPropagation();
          onStartEdit();
        }
        // else: not intercepted; the click bubbles to the <tr>'s own
        // onClick, which arms the row exactly like any other cell.
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.stopPropagation();
        if (armed) {
          onStartEdit();
        } else {
          onArm();
        }
      }}
    >
      {chips}
    </td>
  );
}
