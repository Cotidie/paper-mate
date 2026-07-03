# store/

Zustand working copy of the annotation set (AD-7). Depends downward on the api
client types only.

Built in Story 2.2: an in-memory `Map` keyed by `id` (`useAnnotationStore`) with
an `addAnnotation` action and an `all()` selector ordered by `created_at`
ascending (the Bank order, AR-12).

Story 3.2 added the do/undo command stack (zundo) over this same Map. The dirty
flag + debounced single-flight autosave (Story 3.4) is NOT here: it is a
passive observer in `../hooks/useAutosave.ts`, reading `annotations`/`all()` and
calling the api module, so this module stays a pure working copy.

Story 3.5 added hydrate-on-open as the READ half of the persistence boundary.
Story 5.8 made it doc-scoped: the store owns `(docId, annotations)` as one
atomic unit. The `openDoc(docId, annotations)` action replaces `docId` AND the
working copy together in a single `set()` (no window where they disagree), and
the free `openDoc` function calls it then clears zundo history so the loaded
set is the undo floor. The fetch stays in `../api/` (AD-9); App wires
`getAnnotations` → `openDoc` while the doc is still opening, so restore
becomes the autosave baseline (never PUT back) and is not undoable. Autosave
(`../hooks/useAutosave.ts`) binds its PUT target to `store.docId` read live at
flush time, so a mid-flight doc switch can never write one doc's marks to
another (no more per-story defensive cross-doc guard, AE-4).
