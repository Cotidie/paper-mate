# store/

Zustand working copy of the annotation set (AD-7). Depends downward on the api
client types only.

Built in Story 2.2: an in-memory `Map` keyed by `id` (`useAnnotationStore`) with
an `addAnnotation` action and an `all()` selector ordered by `created_at`
ascending (the Bank order, AR-12).

Story 3.2 added the do/undo command stack (zundo) over this same Map. The dirty
flag + debounced single-flight autosave (Story 3.4) is NOT here: it is a
passive observer in `../useAutosave.ts`, reading `annotations`/`all()` and
calling the api module, so this module stays a pure working copy. Still not
here: hydrate-on-open (Story 3.5).
