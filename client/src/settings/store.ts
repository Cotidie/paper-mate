// settings/store.ts — app-global preferences (AD-8: a DIFFERENT persistence
// tier than the doc-scoped `~/.paper-mate` annotation working copy in
// `store/`, which is zundo-wrapped and has no `persist` middleware). A
// rebinding is neither doc-scoped nor undoable, so it lives here, in its own
// Zustand store, persisted to `localStorage`.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_KEYMAP, findConflict, isReserved, type KeyAction, type KeyBinding } from "./keymap";

export type RebindResult = { ok: true } | { ok: false; reason: "conflict" | "reserved" };

interface SettingsStore {
  keymap: Record<KeyAction, KeyBinding>;
  /** Applies the reserved + conflict guards; only mutates `keymap` on success.
   *  Returns a discriminated result so the modal can show why a capture was
   *  rejected. */
  rebind: (action: KeyAction, binding: KeyBinding) => RebindResult;
  resetKeymap: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      keymap: DEFAULT_KEYMAP,
      rebind(action, binding) {
        if (isReserved(binding)) return { ok: false, reason: "reserved" };
        if (findConflict(get().keymap, binding, action)) return { ok: false, reason: "conflict" };
        set((state) => ({ keymap: { ...state.keymap, [action]: binding } }));
        return { ok: true };
      },
      resetKeymap() {
        set({ keymap: DEFAULT_KEYMAP });
      },
    }),
    {
      name: "paper-mate:settings",
      version: 1,
      partialize: (state) => ({ keymap: state.keymap }),
    },
  ),
);
