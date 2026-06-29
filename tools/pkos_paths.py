from __future__ import annotations

import os
from pathlib import Path


def get_core_root() -> Path:
    return Path(__file__).resolve().parents[1]


def get_data_root() -> Path:
    value = os.environ.get("PKOS_DATA_ROOT")
    if value and value.strip():
        return Path(value).expanduser().resolve()
    return get_core_root()


def _resolve(base: Path, parts: tuple[object, ...]) -> Path:
    path = Path(*[str(p) for p in parts])
    if path.is_absolute():
        return path
    return base / path


def resolve_data_path(*parts: object) -> Path:
    return _resolve(get_data_root(), parts)


def resolve_core_path(*parts: object) -> Path:
    return _resolve(get_core_root(), parts)
