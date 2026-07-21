"""Persisted app settings (`settings.json` under the data root).

Only key today: `structure_mode`, written by the runtime mode toggle so the
choice survives a container restart.
"""

import json

import pytest

from app import storage
from app.storage.errors import StorageError


def test_read_returns_none_when_no_settings_file(data_root):
    assert storage.read_structure_mode() is None


def test_write_then_read_round_trips(data_root):
    storage.write_structure_mode("hybrid")
    assert storage.read_structure_mode() == "hybrid"


def test_write_lands_in_settings_json_beside_library(data_root):
    storage.write_structure_mode("hybrid")
    path = data_root / "settings.json"
    assert json.loads(path.read_text()) == {"structure_mode": "hybrid"}


def test_write_preserves_unknown_keys(data_root):
    (data_root / "settings.json").write_text(json.dumps({"future_key": 1}))
    storage.write_structure_mode("hybrid")
    assert json.loads((data_root / "settings.json").read_text()) == {
        "future_key": 1,
        "structure_mode": "hybrid",
    }


def test_read_returns_none_for_corrupt_json(data_root):
    (data_root / "settings.json").write_text("{not json")
    assert storage.read_structure_mode() is None


def test_read_returns_none_when_value_is_not_a_string(data_root):
    (data_root / "settings.json").write_text(json.dumps({"structure_mode": 7}))
    assert storage.read_structure_mode() is None


def test_write_wraps_filesystem_failure_as_storage_error(data_root, monkeypatch):
    def boom(*args, **kwargs):
        raise StorageError("disk full")

    monkeypatch.setattr("app.storage.settings_store.atomic_write", boom)
    with pytest.raises(StorageError):
        storage.write_structure_mode("hybrid")
