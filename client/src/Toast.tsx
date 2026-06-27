import { useEffect } from "react";
import "./Toast.css";

/**
 * `{component.toast}` — transient bottom-center dark surface for load/save
 * failures. Keyboard-reachable + Esc-dismissable (UX-DR13, UX-DR17). Reused by
 * Epic 3 save-failure copy.
 */
export default function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="toast" role="status" data-testid="toast">
      <span className="toast__message">{message}</span>
      <button
        type="button"
        className="toast__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
