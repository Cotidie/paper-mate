// useBankView — the Annotation Bank's client view-state, unified behind one
// composable model (Story 8.10). It owns the type-filter (Story 8.2) and
// composes it over the reading-order-sorted rows (Story 8.3), so `BankPanel`
// renders over a single view unit instead of re-composing `filterBankItems` and
// `bankItems` inline while also juggling the filter's `useState`/reset/toggle.
// The two derivations stay pure leaf functions in `lib/bank.ts`; this hook only
// owns where they COMPOSE plus the filter's lifecycle.

import { useLayoutEffect, useState } from "react";
import { useAnnotationStore } from "@/store";
import { bankItems, filterBankItems, DEFAULT_BANK_FILTER, type BankItem } from "@/lib/bank";
import type { Annotation } from "@/api/client";

export interface BankView {
  rows: BankItem[];
  activeTypes: ReadonlySet<Annotation["type"]>;
  toggleType: (type: Annotation["type"]) => void;
}

export function useBankView(open: boolean, docId: string): BankView {
  const annotations = useAnnotationStore((s) => s.annotations);
  const [activeTypes, setActiveTypes] = useState<ReadonlySet<Annotation["type"]>>(DEFAULT_BANK_FILTER);

  // `BankPanel` stays mounted across close/reopen (only its render output
  // disappears), so `useState`'s initial value alone would NOT reset the filter
  // on a reopen. Reset explicitly on the open transition (Story 8.2 AC #2: the
  // DEFAULT every time the Bank opens is comments only). `useLayoutEffect`, not
  // `useEffect`: a passive effect fires AFTER the browser paints, so the very
  // first open-transition frame would still show whatever filter was active
  // when the panel was last closed (a stale-rows flash) before snapping back to
  // comments-only.
  useLayoutEffect(() => {
    if (open) setActiveTypes(DEFAULT_BANK_FILTER);
  }, [open]);

  function toggleType(type: Annotation["type"]) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const rows = filterBankItems(bankItems(annotations.values(), docId), activeTypes);
  return { rows, activeTypes, toggleType };
}
