import "./SaveIndicator.css";
import type { SaveStatus } from "../../hooks/useAutosave";

/**
 * `{component.save-indicator}` (Story 3.4, AC-4) — text-only, top bar adjacent
 * to the filename. `error` renders nothing here; the save-failure toast
 * (App) carries that copy.
 */
const TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "",
};

export default function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span
      className={`save-indicator${status === "saved" ? " save-indicator--saved" : ""}`}
      role="status"
      aria-live="polite"
      data-testid="save-indicator"
    >
      {TEXT[status]}
    </span>
  );
}
