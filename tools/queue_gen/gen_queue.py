"""Generate minimal PKOS SRS queues.

Usage:
  python -m tools.queue_gen.gen_queue
  python -m tools.queue_gen.gen_queue --objects objects --review review
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"
DEFAULT_SRS = {
    "due_at": "1970-01-01T00:00:00Z",
    "interval_days": 1,
    "ease": 2.5,
    "last_reviewed_at": "",
}


@dataclass
class QueueItem:
    obj_id: str
    obj_type: str
    title: str
    due_at: str
    path: Path


def _parse_scalar(text: str) -> Any:
    value = text.strip()
    if value in {"", "null", "~"}:
        return "" if value == "" else None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value == "[]":
        return []
    if value == "{}":
        return {}
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    # simple number parse
    try:
        if "." in value:
            return float(value)
        return int(value)
    except Exception:
        return value


def _simple_yaml_load(text: str) -> dict[str, Any] | None:
    root: dict[str, Any] = {}
    stack: list[tuple[int, Any]] = [(-1, root)]

    lines = text.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        i += 1
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue

        indent = len(raw) - len(raw.lstrip(" "))
        if indent % 2 != 0:
            return None
        line = raw.strip()

        while stack and indent <= stack[-1][0]:
            stack.pop()
        if not stack:
            return None
        container = stack[-1][1]

        if line.startswith("- "):
            if not isinstance(container, list):
                return None
            container.append(_parse_scalar(line[2:]))
            continue

        if ":" not in line or not isinstance(container, dict):
            return None

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()

        if value == "":
            next_non_empty = None
            j = i
            while j < len(lines):
                cand = lines[j]
                if cand.strip() and not cand.lstrip().startswith("#"):
                    next_non_empty = cand
                    break
                j += 1

            if next_non_empty is not None:
                next_indent = len(next_non_empty) - len(next_non_empty.lstrip(" "))
                next_line = next_non_empty.strip()
                if next_indent > indent and next_line.startswith("- "):
                    container[key] = []
                elif next_indent > indent:
                    container[key] = {}
                else:
                    container[key] = ""
            else:
                container[key] = ""

            if isinstance(container[key], (dict, list)):
                stack.append((indent, container[key]))
        else:
            container[key] = _parse_scalar(value)

    return root


def _dump_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    # quote if contains special chars
    if s == "" or any(ch in s for ch in [":", "#", "[", "]", "{", "}"]):
        return f'"{s}"'
    return s


def _dump_yaml(value: Any, indent: int = 0) -> list[str]:
    lines: list[str] = []
    space = " " * indent

    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{space}{k}:")
                lines.extend(_dump_yaml(v, indent + 2))
            else:
                lines.append(f"{space}{k}: {_dump_scalar(v)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{space}-")
                lines.extend(_dump_yaml(item, indent + 2))
            else:
                lines.append(f"{space}- {_dump_scalar(item)}")
    return lines


def _load_object(path: Path) -> dict[str, Any] | None:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return None
    return _simple_yaml_load(text)


def _save_object(path: Path, data: dict[str, Any]) -> None:
    key_order = [
        "id",
        "type",
        "status",
        "title",
        "summary",
        "source",
        "anchors",
        "created_at",
        "updated_at",
        "srs",
    ]
    ordered: dict[str, Any] = {}
    for k in key_order:
        if k in data:
            ordered[k] = data[k]
    for k in sorted(data.keys()):
        if k not in ordered:
            ordered[k] = data[k]

    lines = _dump_yaml(ordered)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _parse_iso(value: str) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.strptime(value, ISO_FMT).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _ensure_srs(path: Path, obj: dict[str, Any], now: datetime) -> tuple[dict[str, Any], bool]:
    changed = False
    srs = obj.get("srs")
    if not isinstance(srs, dict):
        srs = dict(DEFAULT_SRS)
        # default due_at to a far-future date to avoid accidental queue noise
        srs["due_at"] = "2099-01-01T00:00:00Z"
        obj["srs"] = srs
        changed = True

    for key, default_value in DEFAULT_SRS.items():
        if key not in srs:
            srs[key] = default_value
            changed = True

    if not _parse_iso(str(srs.get("due_at", ""))):
        srs["due_at"] = "2099-01-01T00:00:00Z"
        changed = True

    if changed:
        _save_object(path, obj)
    return obj, changed


def _collect_items(objects_root: Path, now: datetime) -> tuple[list[QueueItem], list[QueueItem], list[str]]:
    daily: list[QueueItem] = []
    weekly: list[QueueItem] = []
    notes: list[str] = []

    for path in sorted(objects_root.rglob("*.y*ml")):
        obj = _load_object(path)
        if not isinstance(obj, dict):
            notes.append(f"skip invalid yaml: {path.as_posix()}")
            continue

        obj_type = str(obj.get("type", "")).strip()
        obj_id = str(obj.get("id", path.stem)).strip() or path.stem

        obj, changed = _ensure_srs(path, obj, now)
        if changed:
            notes.append(f"srs defaulted: {path.as_posix()}")

        due_at = str(obj.get("srs", {}).get("due_at", ""))
        due_dt = _parse_iso(due_at)
        if due_dt is None or due_dt > now:
            continue

        title = str(obj.get("title") or obj.get("summary") or obj.get("definition") or obj.get("claim_statement") or obj_id)

        item = QueueItem(
            obj_id=obj_id,
            obj_type=obj_type,
            title=title,
            due_at=due_at,
            path=path,
        )

        if obj_type in {"fact", "skill"}:
            daily.append(item)
        elif obj_type == "claim":
            weekly.append(item)

    daily.sort(key=lambda x: (x.due_at, x.obj_type, x.obj_id, x.path.as_posix()))
    weekly.sort(key=lambda x: (x.due_at, x.obj_id, x.path.as_posix()))
    return daily, weekly, notes


def _write_queue(path: Path, title: str, items: list[QueueItem], generated_at: str) -> None:
    lines = [f"# {title}", "", f"Generated at: {generated_at}", ""]
    if not items:
        lines.append("_No due items._")
    else:
        lines.append("| id | summary | due_at | path |")
        lines.append("|---|---|---|---|")
        for item in items:
            rel_path = item.path.as_posix()
            lines.append(
                f"| `{item.obj_id}` | {item.title} | `{item.due_at}` | [{rel_path}]({rel_path}) |"
            )
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def run_gen_queue(objects_dir: Path, review_dir: Path) -> int:
    now = datetime.now(timezone.utc)
    daily_items, weekly_items, notes = _collect_items(objects_dir, now)

    review_dir.mkdir(parents=True, exist_ok=True)
    daily_path = review_dir / "daily_queue.md"
    weekly_path = review_dir / "weekly_queue.md"

    generated_at = now.strftime(ISO_FMT)
    _write_queue(daily_path, "PKOS Daily Queue (fact + skill)", daily_items, generated_at)
    _write_queue(weekly_path, "PKOS Weekly Queue (claim)", weekly_items, generated_at)

    print(f"daily queue: {daily_path.as_posix()} ({len(daily_items)} item(s))")
    print(f"weekly queue: {weekly_path.as_posix()} ({len(weekly_items)} item(s))")
    if notes:
        print("notes:")
        for n in notes:
            print(f" - {n}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate PKOS SRS queues")
    parser.add_argument("--objects", default="objects", help="Objects root directory")
    parser.add_argument("--review", default="review", help="Review output directory")
    args = parser.parse_args()

    return run_gen_queue(Path(args.objects), Path(args.review))


if __name__ == "__main__":
    raise SystemExit(main())
