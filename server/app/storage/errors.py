"""Storage-layer error taxonomy (AR-11).

One base ``StorageError`` plus precise subclasses so a route can map the common
faults to their status codes (``DocumentNotFoundError`` -> 404, every other
``StorageError`` -> the single 500 envelope) without leaking a raw exception
past the ``{ detail }`` contract.
"""


class StorageError(Exception):
    """Base class for storage-layer failures."""


class InvalidPDFError(StorageError):
    """The uploaded bytes are not a readable PDF."""


class UnsupportedSchemaError(StorageError):
    """An on-disk file carries a ``schema_version`` this code cannot handle."""


class CorruptMetadataError(StorageError):
    """An on-disk ``meta.json`` is unreadable or has an invalid shape."""


class CorruptAnnotationsError(StorageError):
    """An on-disk ``annotations.json`` is unreadable or has an invalid shape.

    A distinct fault from ``CorruptMetadataError`` (a precise taxonomy for
    future logging/handling); both are ``StorageError`` so the route maps them
    to the single 500 envelope with no extra handling.
    """


class CorruptStructureError(StorageError):
    """An on-disk ``structure.json`` is unreadable or has an invalid shape.

    A distinct fault from ``CorruptAnnotationsError`` (a precise taxonomy);
    both are ``StorageError`` so the route maps them to the single 500 envelope.
    """


class DocumentNotFoundError(StorageError):
    """No imported document (or its ``source.pdf``) exists for the given ``doc_id``."""


class CorruptLibraryError(StorageError):
    """An on-disk ``library.json`` is unreadable or has an invalid shape."""


class FolderNotFoundError(StorageError):
    """No folder exists for the given ``folder_id`` (create's ``parent_id``,
    or rename/delete's target)."""
