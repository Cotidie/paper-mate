import { useEffect, useRef, useState } from "react";
import { X, ArrowCounterClockwise } from "@phosphor-icons/react";
import "./SettingsModal.css";
import { KEY_ACTIONS, ACTION_LABELS, formatBinding, type KeyAction, type KeyBinding } from "./keymap";
import { useSettingsStore } from "./store";

const REASON_COPY: Record<"conflict" | "reserved", string> = {
  conflict: "Already bound to another action.",
  reserved: "Reserved key, cannot be rebound.",
};

/**
 * `{component.settings-modal}` — the keybinding-rebinding dialog (Story 5.1,
 * AC-2/AC-3). Hand-rolled overlay (not native `<dialog>`; jsdom in this repo
 * does not implement `showModal()`, and this suite is the safety net — see
 * story Dev Notes "Modal approach"): a `role="dialog"` panel over a scrim,
 * with its own minimal focus-trap. Focus moves to the first row on open and
 * returns to the tool-rail Gear trigger on close (UX-DR17).
 *
 * Presentational + store-driving: reads/writes `useSettingsStore` directly
 * (the keymap is app-global, not App-owned state, unlike `tocOpen`/`bankOpen`
 * which are doc-view UI). `App` owns only `open`/`onClose`.
 *
 * Capture: clicking a row's chip arms capture for that action; the NEXT
 * keydown (via this component's OWN `onKeyDown`, never the document-level
 * tool-key handler, which App suppresses entirely while the modal is open)
 * becomes the candidate binding. `Escape` while capturing cancels the
 * capture only, leaving the modal open.
 */
export default function SettingsModal({
  open,
  onClose,
  version,
}: {
  open: boolean;
  onClose: () => void;
  /** App version (from `GET /api/health`), shown as a quiet footer line. `null`
   *  until the fetch resolves (or on failure), in which case the line is omitted. */
  version?: string | null;
}) {
  const keymap = useSettingsStore((s) => s.keymap);
  const rebind = useSettingsStore((s) => s.rebind);
  const resetKeymap = useSettingsStore((s) => s.resetKeymap);

  const [capturingAction, setCapturingAction] = useState<KeyAction | null>(null);
  const [errors, setErrors] = useState<Partial<Record<KeyAction, "conflict" | "reserved">>>({});

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus in on open, restore on close (UX-DR17). Also clears any in-flight
  // capture/error so reopening always starts clean.
  useEffect(() => {
    if (!open) {
      setCapturingAction(null);
      setErrors({});
      return;
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    firstFocusRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function startCapture(action: KeyAction) {
    setCapturingAction(action);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[action];
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (capturingAction) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturingAction(null);
        return;
      }
      // A bare modifier keydown (holding Ctrl before the letter) is not a
      // candidate binding on its own; wait for the real key.
      if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") return;
      const action = capturingAction;
      const binding: KeyBinding = { key: e.key, ctrl: e.ctrlKey };
      const result = rebind(action, binding);
      setCapturingAction(null);
      setErrors((prev) => {
        const next = { ...prev };
        if (result.ok) delete next[action];
        else next[action] = result.reason;
        return next;
      });
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "Tab") {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="settings-modal__scrim" data-testid="settings-scrim">
      <div
        ref={dialogRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-modal"
        onKeyDown={handleKeyDown}
      >
        <div className="settings-modal__header">
          <span className="settings-modal__title">Settings</span>
          <button
            type="button"
            className="settings-modal__close"
            aria-label="Close settings"
            title="Close (Esc)"
            data-testid="settings-close"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </div>

        <ul className="settings-modal__list">
          {KEY_ACTIONS.map((action, i) => (
            <li key={action} className="settings-modal__row">
              <div className="settings-modal__row-main">
                <span className="settings-modal__label">{ACTION_LABELS[action]}</span>
                <button
                  type="button"
                  ref={i === 0 ? firstFocusRef : undefined}
                  className="settings-modal__capture"
                  data-testid={`settings-capture-${action}`}
                  aria-label={`Rebind ${ACTION_LABELS[action]}, currently ${formatBinding(keymap[action])}`}
                  onClick={() => startCapture(action)}
                >
                  {capturingAction === action ? "Press a key" : formatBinding(keymap[action])}
                </button>
              </div>
              {errors[action] && (
                <span className="settings-modal__error" data-testid={`settings-error-${action}`}>
                  {REASON_COPY[errors[action] as "conflict" | "reserved"]}
                </span>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="settings-modal__reset"
          data-testid="settings-reset"
          onClick={() => {
            resetKeymap();
            setErrors({});
          }}
        >
          <ArrowCounterClockwise aria-hidden />
          Reset to defaults
        </button>

        {version && (
          <p className="settings-modal__version" data-testid="settings-version">
            Paper Mate v{version}
          </p>
        )}
      </div>
    </div>
  );
}
