# src/

Entry + composition root at the top level (`main.tsx`, `App.tsx`/`App.css`,
`index.css`, `vite-env.d.ts`) plus the cross-cutting guard suites
(`no-raw-values.test.ts`, `focus-ring.test.ts`), which stay here because both
are path-coupled to root-level files (`index.css`, `App.css`).

Story 5.4 foldered the flat root files (38 of them) into a scaffold-react-style
layout, adapted to this Vite + TS + Zustand stack:

- `components/<Name>/`: the 9 reusable UI components (`Reader`, `BankPanel`,
  `SaveIndicator`, `EmptyDropzone`, `Toast`, `TocPanel`, `ToolRail`,
  `ToolFlyout`, `ZoomControl`), each colocated with its `.css`/`.test.tsx`.
  App is the composition root and is the top importer of all but `ToolFlyout`
  (which `ToolRail` imports).
- `hooks/`: `useAutosave` (dirty-flag, debounced, single-flight autosave) and
  `useLiveRef` (mirror-latest-value ref helper).
- `lib/`: zero-import-leaf-style helpers reachable by any layer without
  creating an upward import (AD-9): `tools.ts`, `uuid.ts`, `domFocus.ts` (true
  zero-import) and `bank.ts` (the Annotation Bank's pure derivation; imports
  only `api/` types + the `anchor/` bbox helper, no store/DOM).

The pre-existing AD-9 layer dirs are untouched by this refactor, since they
already ARE the modular boundaries: `anchor/`, `annotations/`, `api/`,
`reader/`, `render/`, `settings/`, `store/`, `theme/` (each with its own
README where present). Strict downward layering:
`render → anchor → annotation/tool → store → api-client`, with `components/`
sitting above `annotations/` as the App-level composition/shell layer, and
`lib/` leaves reachable from any layer.
