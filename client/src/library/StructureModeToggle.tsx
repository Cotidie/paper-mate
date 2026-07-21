import type { StructureModeState } from "@/api/client";
import { useStructureMode } from "./useStructureMode";
import "./StructureModeToggle.css";

const TOGGLE_TITLE =
  "Hybrid: higher fidelity, slower imports. Applies to papers imported after the switch.";

/** The one line of status under the label, derived from the backend state. */
function statusLabel(state: StructureModeState): string {
  if (state.transition === "starting") return "Starting hybrid...";
  if (state.transition === "stopping") return "Stopping hybrid...";
  if (state.error) return "Hybrid failed";
  return state.mode === "hybrid" ? "Hybrid" : "Local";
}

/**
 * The document-structure extraction mode toggle, pinned in the folder panel's
 * footer. Self-contained: it owns its own fetch/flip/poll through
 * `useStructureMode` rather than threading state through `LibraryPage`, because
 * nothing else on the page reads or writes the mode.
 *
 * Switching affects papers imported after the flip; already-extracted structure
 * is untouched, which the tooltip says out loud. A failed start is rendered in
 * place (the backend has already reverted to local) instead of raising a toast,
 * so the control stays the single home for this state.
 */
export default function StructureModeToggle() {
  const { state, busy, failed, toggle } = useStructureMode();
  if (!state) return null;

  return (
    <div className="structure-mode-toggle">
      <div className="structure-mode-toggle__row">
        <span className="structure-mode-toggle__label">Structure</span>
        <button
          type="button"
          role="switch"
          aria-checked={state.mode === "hybrid"}
          aria-label="Hybrid structure extraction"
          title={failed && state.error ? state.error : TOGGLE_TITLE}
          disabled={busy}
          onClick={toggle}
          className="structure-mode-toggle__switch"
          data-testid="structure-mode-switch"
        >
          <span className="structure-mode-toggle__knob" />
        </button>
      </div>
      <span
        className="structure-mode-toggle__status"
        data-failed={failed ? "true" : undefined}
        data-testid="structure-mode-status"
      >
        {statusLabel(state)}
      </span>
    </div>
  );
}
