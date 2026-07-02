// useLiveRef.ts — the "mirror the latest value into a ref so a document
// listener bound once can read it live" idiom, named. A stable-identity
// listener (bound on mount, never re-bound on every prop/state change) closes
// over a ref instead of the value itself, so `ref.current` always reads the
// LATEST value without the effect re-running. A ZERO-IMPORT leaf (mirrors
// `tools.ts`/`domFocus.ts`) so any component/hook can use it without an
// upward dependency (AD-9).

import { useRef } from "react";

export function useLiveRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
