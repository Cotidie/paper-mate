import { describe, it, expect } from "vitest";
import { DEFAULT_KEYMAP, matchAction, isReserved, findConflict, formatBinding } from "./keymap";

describe("matchAction", () => {
  it("matches a plain single-key binding", () => {
    expect(matchAction(DEFAULT_KEYMAP, { key: "h", ctrlKey: false })).toBe("highlight");
  });

  it("is case-insensitive for letter keys", () => {
    expect(matchAction(DEFAULT_KEYMAP, { key: "H", ctrlKey: false })).toBe("highlight");
    expect(matchAction(DEFAULT_KEYMAP, { key: "v", ctrlKey: false })).toBe("cursor");
    expect(matchAction(DEFAULT_KEYMAP, { key: "V", ctrlKey: false })).toBe("cursor");
  });

  it("matches a ctrl chord", () => {
    expect(matchAction(DEFAULT_KEYMAP, { key: "b", ctrlKey: true })).toBe("toggleBank");
  });

  it("does not match the chord's bare key without ctrl", () => {
    expect(matchAction(DEFAULT_KEYMAP, { key: "b", ctrlKey: false })).toBeNull();
  });

  it("does not match a plain binding's key when ctrl is also held", () => {
    expect(matchAction(DEFAULT_KEYMAP, { key: "h", ctrlKey: true })).toBeNull();
  });

  it("returns null for an unbound key", () => {
    expect(matchAction(DEFAULT_KEYMAP, { key: "q", ctrlKey: false })).toBeNull();
  });

  it("matches the non-letter '[' binding literally", () => {
    expect(matchAction(DEFAULT_KEYMAP, { key: "[", ctrlKey: false })).toBe("toggleRail");
  });
});

describe("isReserved", () => {
  it("rejects Escape", () => {
    expect(isReserved({ key: "Escape" })).toBe(true);
  });

  it("rejects PageUp/PageDown regardless of ctrl", () => {
    expect(isReserved({ key: "PageUp" })).toBe(true);
    expect(isReserved({ key: "PageDown" })).toBe(true);
    expect(isReserved({ key: "PageUp", ctrl: true })).toBe(true);
  });

  it("rejects Ctrl zoom keys (+ = - 0)", () => {
    for (const key of ["+", "=", "-", "0"]) {
      expect(isReserved({ key, ctrl: true })).toBe(true);
    }
  });

  it("allows the bare (non-ctrl) zoom-adjacent keys", () => {
    expect(isReserved({ key: "0" })).toBe(false);
  });

  it("rejects Ctrl Z (undo/redo)", () => {
    expect(isReserved({ key: "z", ctrl: true })).toBe(true);
  });

  it("rejects Ctrl Up/Down (page-nav aliases)", () => {
    expect(isReserved({ key: "ArrowUp", ctrl: true })).toBe(true);
    expect(isReserved({ key: "ArrowDown", ctrl: true })).toBe(true);
  });

  it("allows bare Up/Down (no ctrl)", () => {
    expect(isReserved({ key: "ArrowUp" })).toBe(false);
  });

  it("rejects Ctrl browser/OS chords (w t n r l)", () => {
    for (const key of ["w", "t", "n", "r", "l"]) {
      expect(isReserved({ key, ctrl: true })).toBe(true);
    }
  });

  it("allows those same letters without ctrl", () => {
    for (const key of ["w", "t", "n", "r", "l"]) {
      expect(isReserved({ key })).toBe(false);
    }
  });

  it("rejects F1..F12", () => {
    expect(isReserved({ key: "F1" })).toBe(true);
    expect(isReserved({ key: "F5" })).toBe(true);
    expect(isReserved({ key: "F12" })).toBe(true);
  });

  it("allows F13 (not a real reserved key)", () => {
    expect(isReserved({ key: "F13" })).toBe(false);
  });

  it("rejects bare Space (hold-to-pan)", () => {
    expect(isReserved({ key: " " })).toBe(true);
  });

  it("allows an ordinary free letter", () => {
    expect(isReserved({ key: "g" })).toBe(false);
    expect(isReserved({ key: "g", ctrl: true })).toBe(false);
  });
});

describe("findConflict", () => {
  it("finds the action already bound to a key", () => {
    expect(findConflict(DEFAULT_KEYMAP, { key: "h" }, "cursor")).toBe("highlight");
  });

  it("excludes the action being rebound (no self-conflict)", () => {
    expect(findConflict(DEFAULT_KEYMAP, { key: "h" }, "highlight")).toBeNull();
  });

  it("returns null when the binding is free", () => {
    expect(findConflict(DEFAULT_KEYMAP, { key: "g" }, "cursor")).toBeNull();
  });

  it("treats a ctrl chord as distinct from its bare key", () => {
    expect(findConflict(DEFAULT_KEYMAP, { key: "b" }, "cursor")).toBeNull();
    expect(findConflict(DEFAULT_KEYMAP, { key: "b", ctrl: true }, "cursor")).toBe("toggleBank");
  });
});

describe("formatBinding", () => {
  it("upper-cases a plain single-letter binding", () => {
    expect(formatBinding({ key: "h" })).toBe("H");
  });

  it("prefixes a ctrl chord with 'Ctrl '", () => {
    expect(formatBinding({ key: "b", ctrl: true })).toBe("Ctrl B");
  });

  it("renders Space by name", () => {
    expect(formatBinding({ key: " " })).toBe("Space");
  });

  it("leaves a non-letter key as-is", () => {
    expect(formatBinding({ key: "[" })).toBe("[");
  });
});
