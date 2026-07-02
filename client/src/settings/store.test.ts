import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "./store";
import { DEFAULT_KEYMAP } from "./keymap";

// Gotcha #1 (Dev Notes): the `persist` middleware writes localStorage, which
// leaks across tests. Reset the store AND clear localStorage so a rebind in
// one test can't poison the next.
beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ keymap: DEFAULT_KEYMAP });
});

describe("useSettingsStore", () => {
  it("starts with the default keymap", () => {
    expect(useSettingsStore.getState().keymap).toEqual(DEFAULT_KEYMAP);
  });

  it("rebind applies a free binding and returns ok", () => {
    const result = useSettingsStore.getState().rebind("highlight", { key: "g" });
    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().keymap.highlight).toEqual({ key: "g" });
  });

  it("rebind leaves the rest of the keymap untouched", () => {
    useSettingsStore.getState().rebind("highlight", { key: "g" });
    expect(useSettingsStore.getState().keymap.underline).toEqual(DEFAULT_KEYMAP.underline);
  });

  it("rebind rejects a conflicting binding without applying it", () => {
    const result = useSettingsStore.getState().rebind("cursor", { key: "h" });
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(useSettingsStore.getState().keymap.cursor).toEqual(DEFAULT_KEYMAP.cursor);
  });

  it("rebind rejects a reserved binding without applying it", () => {
    const result = useSettingsStore.getState().rebind("highlight", { key: "Escape" });
    expect(result).toEqual({ ok: false, reason: "reserved" });
    expect(useSettingsStore.getState().keymap.highlight).toEqual(DEFAULT_KEYMAP.highlight);
  });

  it("rebind allows an action to keep its own current key (no self-conflict)", () => {
    const result = useSettingsStore.getState().rebind("highlight", { key: "h" });
    expect(result).toEqual({ ok: true });
  });

  it("resetKeymap restores the defaults after a rebind", () => {
    useSettingsStore.getState().rebind("highlight", { key: "g" });
    useSettingsStore.getState().resetKeymap();
    expect(useSettingsStore.getState().keymap).toEqual(DEFAULT_KEYMAP);
  });

  it("persists the keymap to localStorage under the versioned key", () => {
    useSettingsStore.getState().rebind("highlight", { key: "g" });
    const raw = localStorage.getItem("paper-mate:settings");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(1);
    expect(parsed.state.keymap.highlight).toEqual({ key: "g" });
  });
});
