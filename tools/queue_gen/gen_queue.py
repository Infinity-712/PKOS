"""Generate minimal PKOS SRS queues."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tools.common.object_store import iter_object_files
from tools.common.yaml_io import load_yaml, save_yaml

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
    display_path: str


def _parse_iso(value: str) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.strptime(value, ISO_FMT).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _ensure_srs(path: Path, obj: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    changed = False
    srs = obj.get("srs")
    if not isinstance(srs, dict):
        srs = dict(DEFAULT_SRS)
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
        save_yaml(path, obj)
    return obj, changed


def _collect_items(objects_root: Path, now: datetime) -> tuple[list[QueueItem], list[QueueItem], list[str]]:
    daily: list[QueueItem] = []
    weekly: list[QueueItem] = []
    notes: list[str] = []
    path_base = objects_root.parent.resolve()

    for path in iter_object_files(objects_root):
        obj, errs = load_yaml(path)
        if errs or not isinstance(obj, dict):
            notes.append(f"skip invalid yaml: {path.as_posix()}")
            continue

        obj_type = str(obj.get("type", "")).strip()
        obj_id = str(obj.get("id", path.stem)).strip() or path.stem

        if obj_type not in {"fact", "skill", "claim"}:
            # creative and unknown types are intentionally excluded from default SRS queues
            continue

        obj, changed = _ensure_srs(path, obj)
        if changed:
            notes.append(f"srs defaulted: {path.as_posix()}")

        due_at = str(obj.get("srs", {}).get("due_at", ""))
        due_dt = _parse_iso(due_at)
        if due_dt is None or due_dt > now:
            continue

        title = str(obj.get("title") or obj.get("summary") or obj.get("definition") or obj.get("claim_statement") or obj_id)
        try:
            display_path = path.resolve().relative_to(path_base).as_posix()
        except ValueError:
            display_path = path.as_posix()
        item = QueueItem(obj_id=obj_id, obj_type=obj_type, title=title, due_at=due_at, path=path, display_path=display_path)

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
            lines.append(f"| `{item.obj_id}` | {item.title} | `{item.due_at}` | [{item.display_path}]({item.display_path}) |")
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
        for note in notes:
            print(f" - {note}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate PKOS SRS queues")
    parser.add_argument("--objects", default="objects", help="Objects root directory")
    parser.add_argument("--review", default="review", help="Review output directory")
    args = parser.parse_args()
    return run_gen_queue(Path(args.objects), Path(args.review))


if __name__ == "__main__":
    raise SystemExit(main())
