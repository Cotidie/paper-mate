import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";

/**
 * The armed Author cell's tag editor (Story 7.11): a create-only "select or
 * create" affordance (no cross-collection author list is surfaced this
 * story, so there is nothing to "select" from yet - typing always creates).
 * Each existing author is a chip with its own remove control; typing a name
 * and pressing Enter (or blurring the input) adds it to the draft. The whole
 * draft list commits ONCE, on blur/close (Enter just appends, keeping the
 * editor open for more) - Esc discards the draft entirely. Mirrors
 * `InlineEditor`'s `committedRef` double-fire guard (`EditableCell.tsx`) so
 * an Escape-triggered unmount's resulting blur doesn't also re-commit.
 */
export default function TagEditor({
  authors,
  onCommit,
  onCancel,
}: {
  authors: string[];
  onCommit: (authors: string[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(authors);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function addFromInput() {
    const trimmed = inputValue.trim();
    if (trimmed && !draftRef.current.includes(trimmed)) {
      setDraft((prev) => [...prev, trimmed]);
    }
    setInputValue("");
    return trimmed;
  }

  function removeAuthor(author: string) {
    setDraft((prev) => prev.filter((a) => a !== author));
  }

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = inputValue.trim();
    const finalList = trimmed && !draftRef.current.includes(trimmed) ? [...draftRef.current, trimmed] : draftRef.current;
    onCommit(finalList);
  }

  function cancel() {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  }

  // The commit-on-blur lives on the CONTAINER, not the input (Codex review,
  // Med): a plain `<input onBlur>` fires the instant Tab moves focus to a
  // sibling remove button, closing/committing the editor before that Tab
  // keypress ever lands there - the remove buttons were effectively
  // mouse-only. `relatedTarget` is the element about to RECEIVE focus; if
  // it's still inside this editor (the input, or a remove button), focus
  // only moved WITHIN the editor, not away from it, so this isn't a real
  // blur yet - only commit once focus actually leaves.
  function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
    commit();
  }

  return (
    <div className="tag-editor" onClick={(e) => e.stopPropagation()} onBlur={handleContainerBlur}>
      {draft.length > 0 && (
        <div className="tag-editor__chips">
          {draft.map((author) => (
            <span key={author} className="tag-chip tag-chip--editable">
              {author}
              <button
                type="button"
                className="tag-chip__remove"
                aria-label={`Remove ${author}`}
                // A mouse click would otherwise shift focus onto this button
                // (browser default), and removing it immediately re-shifts
                // focus again as the node unmounts - preventDefault keeps
                // focus on the input throughout a mouse-driven removal, so
                // only a genuine Tab-away (keyboard) ever exercises the
                // container's `relatedTarget` blur check below.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeAuthor(author)}
              >
                <X aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="tag-editor__input"
        value={inputValue}
        placeholder="Add author"
        aria-label="Add author"
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            e.preventDefault();
            addFromInput();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          } else if (e.key === "Backspace" && inputValue === "" && draft.length > 0) {
            removeAuthor(draft[draft.length - 1]);
          }
        }}
      />
    </div>
  );
}
