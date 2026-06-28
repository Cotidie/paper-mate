# store/

Zustand working copy of the annotation set (AD-7). Depends downward on the api
client types only.

Built in Story 2.2: an in-memory `Map` keyed by `id` (`useAnnotationStore`) with
an `addAnnotation` action and an `all()` selector ordered by `created_at`
ascending (the Bank order, AR-12).

Still Epic 3 (NOT here): the command stack (do/undo) so mutations flow through
one path, the dirty flag, and debounced autosave + hydrate-on-open.
