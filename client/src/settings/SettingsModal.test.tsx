import { useState } from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SettingsModal from "./SettingsModal";
import { useSettingsStore } from "./store";
import { DEFAULT_KEYMAP } from "./keymap";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ keymap: DEFAULT_KEYMAP });
});

// A trigger + toggled modal, mirroring how App actually wires it (a Gear
// button owns open/closed) so focus-in-on-open / focus-return-on-close can be
// exercised against a real "previously focused" element.
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Gear
      </button>
      <SettingsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function openViaTrigger() {
  render(<Harness />);
  const trigger = screen.getByTestId("trigger");
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

describe("SettingsModal", () => {
  it("renders nothing while closed", () => {
    render(<SettingsModal open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("settings-modal")).toBeNull();
  });

  it("focus moves to the first row's capture control on open (UX-DR17)", () => {
    openViaTrigger();
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("settings-capture-cursor"));
  });

  it("Esc closes the modal and returns focus to the trigger (UX-DR17)", () => {
    const trigger = openViaTrigger();
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "Escape" });
    expect(screen.queryByTestId("settings-modal")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("the close button also closes the modal", () => {
    openViaTrigger();
    fireEvent.click(screen.getByTestId("settings-close"));
    expect(screen.queryByTestId("settings-modal")).toBeNull();
  });

  it("shows the current binding as the capture control's label", () => {
    openViaTrigger();
    expect(screen.getByTestId("settings-capture-highlight").textContent).toBe("H");
    expect(screen.getByTestId("settings-capture-toggleBank").textContent).toBe("Ctrl B");
  });

  it("clicking a capture control arms capture mode ('Press a key')", () => {
    openViaTrigger();
    fireEvent.click(screen.getByTestId("settings-capture-highlight"));
    expect(screen.getByTestId("settings-capture-highlight").textContent).toBe("Press a key");
  });

  it("a valid capture rebinds the action and persists to the store", () => {
    openViaTrigger();
    fireEvent.click(screen.getByTestId("settings-capture-highlight"));
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "g" });
    expect(screen.getByTestId("settings-capture-highlight").textContent).toBe("G");
    expect(useSettingsStore.getState().keymap.highlight).toEqual({ key: "g", ctrl: false });
  });

  it("a conflicting capture is rejected with an inline reason, binding unchanged", () => {
    openViaTrigger();
    fireEvent.click(screen.getByTestId("settings-capture-cursor"));
    // "h" is already bound to highlight.
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "h" });
    expect(screen.getByTestId("settings-error-cursor").textContent).toBe(
      "Already bound to another action.",
    );
    expect(useSettingsStore.getState().keymap.cursor).toEqual(DEFAULT_KEYMAP.cursor);
    // Capture mode exits (no longer "Press a key").
    expect(screen.getByTestId("settings-capture-cursor").textContent).toBe("V");
  });

  it("a reserved capture is rejected with an inline reason, binding unchanged", () => {
    openViaTrigger();
    fireEvent.click(screen.getByTestId("settings-capture-highlight"));
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "F5" });
    expect(screen.getByTestId("settings-error-highlight").textContent).toBe(
      "Reserved key, cannot be rebound.",
    );
    expect(useSettingsStore.getState().keymap.highlight).toEqual(DEFAULT_KEYMAP.highlight);
  });

  it("Escape while capturing cancels the capture only, modal stays open", () => {
    openViaTrigger();
    fireEvent.click(screen.getByTestId("settings-capture-cursor"));
    expect(screen.getByTestId("settings-capture-cursor").textContent).toBe("Press a key");
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "Escape" });
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
    expect(screen.getByTestId("settings-capture-cursor").textContent).toBe("V");
    expect(useSettingsStore.getState().keymap.cursor).toEqual(DEFAULT_KEYMAP.cursor);
  });

  it("Reset to defaults restores the whole keymap after a rebind", () => {
    openViaTrigger();
    fireEvent.click(screen.getByTestId("settings-capture-highlight"));
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "g" });
    expect(useSettingsStore.getState().keymap.highlight).toEqual({ key: "g", ctrl: false });
    fireEvent.click(screen.getByTestId("settings-reset"));
    expect(useSettingsStore.getState().keymap).toEqual(DEFAULT_KEYMAP);
    expect(screen.getByTestId("settings-capture-highlight").textContent).toBe("H");
  });

  it("Tab from the last focusable control (Reset) wraps to the first (Close), focus-trap", () => {
    openViaTrigger();
    const reset = screen.getByTestId("settings-reset");
    reset.focus();
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("settings-close"));
  });

  it("Shift+Tab from the first focusable control (Close) wraps to the last (Reset), focus-trap", () => {
    openViaTrigger();
    const close = screen.getByTestId("settings-close");
    close.focus();
    fireEvent.keyDown(screen.getByTestId("settings-modal"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("settings-reset"));
  });
});
