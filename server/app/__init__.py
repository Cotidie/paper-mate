"""Paper Mate backend package.

Two layers only (ARCHITECTURE-SPINE Design Paradigm): ``routes`` → ``storage``.
``storage`` is the sole disk writer; routes never touch the filesystem (AD-9).
"""
