"""Authors join/split leaf tests (Story 7.11, Task 1)."""

from app.authors import join_authors, split_authors


def test_join_authors_joins_with_delimiter() -> None:
    assert join_authors(["Alice Smith", "Bob Jones"]) == "Alice Smith, Bob Jones"


def test_join_authors_empty_list_is_none() -> None:
    assert join_authors([]) is None


def test_join_authors_drops_blanks_and_strips_whitespace() -> None:
    assert join_authors([" Alice ", "", "  ", "Bob"]) == "Alice, Bob"


def test_join_authors_all_blank_is_none() -> None:
    assert join_authors(["", "  "]) is None


def test_split_authors_splits_on_delimiter() -> None:
    assert split_authors("Alice Smith, Bob Jones") == ["Alice Smith", "Bob Jones"]


def test_split_authors_none_is_empty_list() -> None:
    assert split_authors(None) == []


def test_split_authors_empty_string_is_empty_list() -> None:
    assert split_authors("") == []


def test_split_authors_strips_whitespace_and_drops_blanks() -> None:
    assert split_authors("Alice ,  , Bob") == ["Alice", "Bob"]


def test_round_trip_join_then_split() -> None:
    authors = ["Alice Smith", "Bob Jones", "Carol Lee"]
    assert split_authors(join_authors(authors)) == authors
