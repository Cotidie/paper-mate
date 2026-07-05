import { useRef, useState } from "react";
import "./EmptyDropzone.css";

/**
 * Library empty state. `{component.empty-dropzone}`: drag-drop one or more
 * PDFs, or browse. Keyboard-reachable via the browse button (it triggers a
 * hidden file input). Hands every dropped/picked file up; the parent owns
 * upload + state (Story 6.4: the bulk-upload machine).
 */
export default function EmptyDropzone({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function pick(files: FileList | null) {
    if (files && files.length > 0) onFiles(Array.from(files));
  }

  return (
    <div
      className={over ? "dropzone dropzone--over" : "dropzone"}
      data-testid="empty-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation(); // this component owns its own drop surface
        if (!disabled) setOver(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
    >
      <p className="dropzone__primary">Drop PDFs here</p>
      <button
        type="button"
        className="dropzone__browse"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        or browse…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="dropzone__input"
        data-testid="dropzone-input"
        onChange={(e) => {
          pick(e.target.files);
          // Reset so re-picking the same file(s) after a failure refires change.
          e.target.value = "";
        }}
      />
    </div>
  );
}
