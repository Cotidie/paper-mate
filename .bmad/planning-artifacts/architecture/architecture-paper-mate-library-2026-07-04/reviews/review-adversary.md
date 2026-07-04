# Review — Adversary lens

**Verdict:** One critical hole (fixed with new AD-L7) + two minor fixes. Attack = construct two units obeying every AD that still diverge.

## Findings

1. **[CRITICAL → fixed via AD-L7] Concurrent `library.json` writers with no serialization.**
   Two units, each obeying every AD, that diverge:
   - Unit A: the **background extraction task** (AD-L2) completes and, through storage (AD-9), refreshes the `library.json` display cache (title/authors).
   - Unit B: a **user `move`/`trash`/`restore` op** (AD-L6) that, through storage (AD-9), writes folder membership / trash in `library.json`.
   Both are legal (both go through the sole-writer storage module). But AD-L2 deliberately runs extraction as a **background task concurrent with user actions** (the client polls *while* extraction runs), so the inherited AD-6 "single user, **no concurrency**" no longer holds for the collection index. With whole-file writes and no lock, A and B interleave → last-writer clobbers the other (a folder move is lost, or the cache goes stale). Same race on a duplicate-in-one-batch upload (identical bytes → identical `doc_id` → two concurrent `{doc_id}/` creates).
   Failure scenario: user drops 10 PDFs; while row 3 extracts, user drags row 3 into a folder; extraction finishes a beat later and writes back the pre-move index → the folder move vanishes.
   Fix: **AD-L7** — storage serializes all `library.json` mutations as read-modify-write under a process lock (the collection-index analogue of the inherited AD-7 single-flight autosave); narrows AD-6's "no concurrency" to "single user, but intra-process background concurrency exists; the index write path is concurrency-safe."

2. **[MEDIUM → fixed] Folder identity not pinned.** AD-L5 makes membership authoritative in `library.json` but never says a folder has a **stable id** independent of its name. A rename endpoint keying folders by *name* and a membership map keyed by *name* diverge on FR-12 rename → orphaned membership. Fix: convention row — folder id = UUIDv4, name is mutable.

3. **[LOW → fixed] `order` over-specified.** AD-L1 gives `library.json` authority over paper "order," but no FR asks for manual paper reordering; FR-5 sorts client-side by column. Two units could disagree on whether persisted order or client sort wins. Fix: clarify `order` is folder ordering + insertion order only; paper table ordering is the client sort (FR-5, AD-L3).

4. **[LOW → noted] Note identity deferred.** FR-17 reserves a Note file-type, but `doc_id` = SHA-256 of *PDF bytes* (AD-8) does not define identity for a non-PDF note. Note *authoring* is out of scope this sprint (nothing creates a note), so no live hole; Deferred now records that Note identity is defined with note authoring.

5. **[LOW → story-level] Poll never terminates if a task dies.** AD-L4 "poll until statuses settle" spins forever if an extraction task crashes leaving `status: extracting`. Robustness detail for the extraction story (terminal timeout → `parse-failed`), not a spine invariant.
