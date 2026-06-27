# store/

Zustand working copy + command stack (AD-7). All annotation mutations flow
through one do/undo command path → store → dirty flag → debounced autosave.
Depends downward on the api client only.

Empty placeholder in Story 1.1 — built in Epic 3.
