from __future__ import annotations

import os
from pathlib import Path


def get_core_root() -> Path:
    return Path(__file__).resolve().parents[1]


def get_data_root(cli_data_root: str | None = None) -> Path:
    value = cli_data_root or os.environ.get("PKOS_DATA_ROOT")
    if value and value.strip():
        return Path(value).expanduser().resolve()
    return get_core_root()


def get_data_root_source(cli_data_root: str | None = None) -> str:
    if cli_data_root:
        return "cli"
    value = os.environ.get("PKOS_DATA_ROOT")
    if value and value.strip():
        return "env"
    return "default"


def _resolve(base: Path, parts: tuple[object, ...]) -> Path:
    path = Path(*[str(p) for p in parts])
    if path.is_absolute():
        return path
    return base / path


def resolve_data_path(*parts: object) -> Path:
    return _resolve(get_data_root(), parts)


def resolve_core_path(*parts: object) -> Path:
    return _resolve(get_core_root(), parts)


def display_data_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(get_data_root()).as_posix()
    except ValueError:
        return path.as_posix()
