"""Tiny text-normalization helper shared by ``extract`` and ``crossref``.

Homed here (not in either module) so neither the pure-PDF ``extract`` nor the
network ``crossref`` enricher has to import the other just to normalize a
string value.
"""


def clean(value: object) -> str | None:
    """Normalize a metadata value: blank/whitespace-only is *absent*, not ``""``."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None
