import { useRef, useState } from "react";
import "./EmptyDropzone.css";

/**
 * S0 empty state. `{component.empty-dropzone}`: drag-drop a PDF or browse.
 * Keyboard-reachable via the browse button (it triggers a hidden file input).
 * Picks the first PDF and hands it up; the parent owns upload + state.
 */
export default function EmptyDropzone({
  onFile,
  disabled = false,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      className={over ? "dropzone dropzone--over" : "dropzone"}
      data-testid="empty-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
    >
      <p className="dropzone__primary">Drop a PDF here</p>
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
        className="dropzone__input"
        data-testid="dropzone-input"
        onChange={(e) => {
          pick(e.target.files);
          // Reset so re-selecting the same file after a failure refires change.
          e.target.value = "";
        }}
      />
    </div>
  );
}
