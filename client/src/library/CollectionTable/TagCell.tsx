import TagEditor from "./TagEditor";

/**
 * The Author `<td>` (Story 7.11): each author renders as a distinct, uniform
 * chip. Mirrors `EditableCell`'s arm→edit lifecycle:
 *
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
  onCommit,
  onCancel,
}: {
  authors: string[];
  editable: boolean;
  armed: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onArm: () => void;
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
        <span key={author} className="tag-chip">
          {author}
        </span>
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
