from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tools.common.yaml_io import DataIssue, load_yaml


@dataclass
class ObjectRecord:
    object_id: str
    object_type: str
    status: str
    path: Path
    data: dict[str, Any]


def iter_object_files(objects_root: Path):
    for sub in ("fact", "skill", "claim"):
        d = objects_root / sub
        if not d.exists():
            continue
        for p in sorted(d.rglob("*.y*ml")):
            if p.is_file():
                yield p


def load_object_records(objects_root: Path) -> tuple[list[ObjectRecord], list[DataIssue]]:
    records: list[ObjectRecord] = []
    issues: list[DataIssue] = []

    for path in iter_object_files(objects_root):
        data, errs = load_yaml(path)
        issues.extend(errs)
        if not isinstance(data, dict):
            continue

        object_id = str(data.get("id", "")).strip() or path.stem
        object_type = str(data.get("type", "")).strip()
        status = str(data.get("status", "")).strip()
        records.append(ObjectRecord(object_id=object_id, object_type=object_type, status=status, path=path, data=data))

    return records, issues


def build_object_index(objects_root: Path) -> tuple[dict[str, ObjectRecord], list[DataIssue]]:
    records, issues = load_object_records(objects_root)
    index: dict[str, ObjectRecord] = {}
    for r in records:
        if r.object_id in index:
            issues.append(DataIssue(r.path, "id", f"duplicate object id: {r.object_id}"))
            continue
        index[r.object_id] = r
    return index, issues
