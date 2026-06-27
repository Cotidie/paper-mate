"""Storage layer — the ONLY code that touches ``~/.paper-mate`` (AD-8, AD-9).

Empty in Story 1.1. Later stories add: doc_id hashing (SHA-256 of PDF bytes),
atomic writes (temp + rename), and the ``library/{doc_id}/`` layout. Routes must
never touch the filesystem directly.
"""
