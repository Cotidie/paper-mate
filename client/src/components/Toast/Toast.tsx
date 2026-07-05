import { useEffect } from "react";
import "./Toast.css";

/**
 * `{component.toast}` — transient bottom-center notice. Keyboard-reachable +
 * Esc-dismissable (UX-DR13, UX-DR17). Two variants: `error` (default, dark
 * surface — load/save failures, Epic 3 save copy) and `info` (a muted/light
 * surface — the Story 6.5 enrich-skipped notice, visually distinct from an
 * error). `error` is the default so every existing call-site is unchanged.
 */
export default function Toast({
  message,
  onDismiss,
  variant = "error",
}: {
  message: string;
  onDismiss: () => void;
  variant?: "error" | "info";
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className={`toast toast--${variant}`} role="status" data-testid="toast">
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
