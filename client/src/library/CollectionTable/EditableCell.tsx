import { useEffect, useRef, useState } from "react";
import type { EditableField } from "@/library/row";

const EDIT_ARIA_LABEL: Record<EditableField, string> = {
  title: "Edit title",
  venue: "Edit venue",
  year: "Edit year",
};

/**
 * The `<input>` for an in-progress cell edit (Story 6.6). Owns its draft text
 * and autofocus/select-all on mount; a `committedRef` guards the classic
 * inline-edit double-fire (Enter/Esc unmount the input, which fires `onBlur`
 * during teardown — without the guard a naive `onBlur=commit` would silently
 * re-commit after an Esc cancel). `onCommit`'s second argument distinguishes
 * an explicit Enter from an auto-commit-on-blur: only the latter is caused by
 * a click landing elsewhere, which the caller must not also treat as a fresh
 * arm/edit/open gesture (see `suppressClickRef` in `CollectionTable`).
 */
function InlineEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string, viaBlur: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="collection-table__edit-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          committedRef.current = true;
          onCommit(value, false);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!committedRef.current) {
          committedRef.current = true;
          onCommit(value, true);
        }
      }}
    />
  );
}

/**
 * A Title/Authors `<td>`: the static ellipsis cell, or (when this
 * `{docId, field}` is the one being edited) the `InlineEditor`. Editable only
 * for settled rows (AC-8); a click or Enter on the cell enters edit ONLY once
 * the row is already armed (`armed` prop) — an unarmed cell's click/Enter
 * instead arms the row (bubbling to the `<tr>`'s own click, or calling
 * `onArm` for the keyboard path), matching every other cell's first-click
 * behavior rather than editing immediately.
 */
export default function EditableCell({
  className,
  title,
  field,
  editable,
  armed,
  isEditing,
  seedValue,
  children,
  onStartEdit,
  onArm,
  onCommit,
  onCancel,
}: {
  className: string;
  title?: string;
  field: EditableField;
  editable: boolean;
  armed: boolean;
  isEditing: boolean;
  seedValue: string;
  children: React.ReactNode;
  onStartEdit: () => void;
  onArm: () => void;
  onCommit: (value: string, viaBlur: boolean) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <td className={className}>
        <InlineEditor initialValue={seedValue} onCommit={onCommit} onCancel={onCancel} />
      </td>
    );
  }
  if (!editable) {
    return (
      <td className={className} title={title}>
        {children}
      </td>
    );
  }
  return (
    <td
      className={className}
      title={title}
      tabIndex={0}
      aria-label={EDIT_ARIA_LABEL[field]}
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
      {children}
    </td>
  );
}
