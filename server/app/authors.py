"""Authors join/split leaf (Story 7.11).

The single definition of the ``authors_list`` <-> ``authors`` (display string)
delimiter. Imported by ``models.py`` (the ``DocMeta`` validators), the
extraction route, and the PATCH route -- never re-spelled elsewhere.

Round-trip caveat: ``join`` -> ``split`` is exact only when no author name
itself contains the delimiter (rare, e.g. "Smith, Jr."). This is a
best-effort back-compat bridge for un-edited legacy rows; the moment a user
edits authors via chips, the real list is stored and future reads are exact.
"""

#: The one join delimiter, used by both directions.
AUTHOR_JOIN = ", "


def join_authors(authors: list[str]) -> str | None:
    """Join a list of authors into the display string, dropping blanks."""
    cleaned = [a.strip() for a in authors if a.strip()]
    return AUTHOR_JOIN.join(cleaned) or None


def split_authors(joined: str | None) -> list[str]:
    """Split a display string back into a list of authors, dropping blanks."""
    if not joined:
        return []
    return [a.strip() for a in joined.split(AUTHOR_JOIN) if a.strip()]
