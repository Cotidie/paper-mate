import { useEffect, useRef, useState } from "react";

/**
 * A folder name's inline `<input>` (Story 7.1): create-time naming AND
 * rename share this one editor. Reuses `CollectionTable/EditableCell`'s
 * `committedRef` double-fire guard (Enter/Esc unmount the input, which fires
 * `onBlur` during teardown, so without the guard a naive `onBlur=commit` would
 * silently re-commit after an Esc cancel). A blank/whitespace commit (Enter
 * or blur) is treated as a cancel, not a doomed empty-name request.
 */
export default function FolderNameEditor({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commitOrCancel(raw: string) {
    const trimmed = raw.trim();
    if (trimmed) onCommit(trimmed);
    else onCancel();
  }

  return (
    <input
      ref={inputRef}
      className="folder-panel__name-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          committedRef.current = true;
          commitOrCancel(value);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!committedRef.current) {
          committedRef.current = true;
          commitOrCancel(value);
        }
      }}
    />
  );
}
