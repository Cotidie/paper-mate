"""Storage package — the ONLY code that touches the data root (AD-8, AD-9).

Owns: PDF identity (``doc_id`` = SHA-256 hex of the raw bytes), the
``library/{doc_id}/`` layout, ``meta.json`` (storage-owned schema), the
``library.json`` collection index, ``annotations.json``, and atomic writes
(temp file in the same dir + ``os.replace``). Routes never call the filesystem
directly; they go through this facade.

This ``__init__`` is a thin facade over the package's focused modules:

- ``errors``            — the ``StorageError`` taxonomy.
- ``paths``             — data-root resolution + the library-root escape guard.
- ``atomic``            — the temp+rename atomic-write primitive.
- ``pdf``               — the pypdf validation that gates every import.
- ``meta_store``        — the per-document ``meta.json`` read/write.
- ``library_index``     — the ``library.json`` index (AL-7 single serialized
                          writer) + the shared meta-write/reindex core.
- ``annotations_store`` — the per-document ``annotations.json`` read/write.
- ``documents``         — the public per-document operations (import, source
                          path, meta read, the three meta mutators).

The public surface below is the storage boundary; nothing outside the package
imports a submodule directly (call sites use ``storage.<name>``).
"""

from app.storage.annotations_store import (
    ANNOTATIONS_SCHEMA_VERSION,
    read_annotations,
    write_annotations,
)
from app.storage.documents import (
    apply_extraction,
    import_pdf,
    read_meta,
    source_path,
    touch_last_opened,
    update_doc_meta,
)
from app.storage.errors import (
    CorruptAnnotationsError,
    CorruptLibraryError,
    CorruptMetadataError,
    DocumentNotFoundError,
    FolderNotFoundError,
    InvalidPDFError,
    StorageError,
    UnsupportedSchemaError,
)
from app.storage.library_index import (
    LIBRARY_SCHEMA_VERSION,
    create_folder,
    delete_folder,
    move_papers,
    read_library,
    reconcile_library,
    rename_folder,
)
from app.storage.meta_store import META_SCHEMA_VERSION

__all__ = [
    # Schema versions.
    "META_SCHEMA_VERSION",
    "ANNOTATIONS_SCHEMA_VERSION",
    "LIBRARY_SCHEMA_VERSION",
    # Error taxonomy.
    "StorageError",
    "InvalidPDFError",
    "UnsupportedSchemaError",
    "CorruptMetadataError",
    "CorruptAnnotationsError",
    "DocumentNotFoundError",
    "CorruptLibraryError",
    "FolderNotFoundError",
    # Collection index.
    "read_library",
    "reconcile_library",
    "create_folder",
    "rename_folder",
    "delete_folder",
    "move_papers",
    # Per-document operations.
    "source_path",
    "read_meta",
    "import_pdf",
    "apply_extraction",
    "update_doc_meta",
    "touch_last_opened",
    # Annotations store.
    "write_annotations",
    "read_annotations",
]
