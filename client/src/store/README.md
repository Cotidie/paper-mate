# store/

Zustand working copy of the annotation set (AD-7). Depends downward on the api
client types only.

Built in Story 2.2: an in-memory `Map` keyed by `id` (`useAnnotationStore`) with
an `addAnnotation` action and an `all()` selector ordered by `created_at`
ascending (the Bank order, AR-12).

Story 3.2 added the do/undo command stack (zundo) over this same Map. The dirty
flag + debounced single-flight autosave (Story 3.4) is NOT here: it is a
passive observer in `../useAutosave.ts`, reading `annotations`/`all()` and
calling the api module, so this module stays a pure working copy.

Story 3.5 added hydrate-on-open as the READ half of the persistence boundary:
the `hydrate` action replaces the working copy with a freshly loaded set, and
the `hydrateStore` free function calls it then clears zundo history so the
loaded set is the undo floor. The fetch stays in `../api/` (AD-9); App wires
`getAnnotations` → `hydrateStore` while the doc is still opening, so restore
becomes the autosave baseline (never PUT back) and is not undoable.
