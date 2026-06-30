from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any

from tools.common.object_store import build_object_index

WEEK_RE = re.compile(r"^(\d{4}-W\d{2})\.md$")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _export_private_index(objects_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    idx, issues = build_object_index(objects_dir)
    items: list[dict[str, Any]] = []
    path_base = objects_dir.parent
    for rec in sorted(idx.values(), key=lambda r: (r.object_type, r.status, r.object_id)):
        d = rec.data
        tags = d.get("tags") if isinstance(d.get("tags"), list) else []
        try:
            display_path = rec.path.relative_to(path_base).as_posix()
        except ValueError:
            display_path = rec.path.as_posix()
        item = {
            "id": rec.object_id,
            "type": rec.object_type,
            "status": rec.status,
            "title": str(d.get("title") or ""),
            "summary": str(d.get("summary") or ""),
            "content": str(d.get("content") or ""),
            "tags": [str(t) for t in tags],
            "created_at": str(d.get("created_at") or ""),
            "updated_at": str(d.get("updated_at") or ""),
            "path": display_path,
        }

        optional_blocks = [
            "definition",
            "canonical_example",
            "claim_statement",
            "counter_examples",
            "verification_sources",
            "common_mistakes",
            "practice_log",
            "assumptions",
            "evidence",
            "counter_arguments",
            "scope",
            "invalidation_conditions",
            "source",
            "anchors",
        ]
        for key in optional_blocks:
            if key in d and d.get(key) not in (None, "", []):
                item[key] = d.get(key)

        items.append(item)
    return items, {"object_issues": [i.format() for i in issues]}


def _parse_queue_file(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    entries: list[dict[str, str]] = []
    for line in lines:
        if not line.startswith("| `"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 5:
            continue
        entries.append(
            {
                "id": parts[1].strip("`"),
                "title": parts[2],
                "due_at": parts[3].strip("`"),
                "path": parts[4].split("](")[-1].rstrip(") "),
            }
        )
    entries.sort(key=lambda e: (e.get("due_at", ""), e.get("id", "")))
    return entries


def _export_private_queues(review_dir: Path) -> dict[str, Any]:
    return {
        "daily": _parse_queue_file(review_dir / "daily_queue.md"),
        "weekly": _parse_queue_file(review_dir / "weekly_queue.md"),
        "sort_policy": "due_at,id",
    }


def _extract_digest_refs(path: Path) -> list[str]:
    refs: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if "|" not in line or "`" not in line:
            continue
        for token in re.findall(r"`([^`]+)`", line):
            if token and "." in token:
                refs.add(token)
    return sorted(refs)


def _export_private_digests(digests_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    path_base = digests_dir.parent
    for p in sorted(digests_dir.glob("*.md"), key=lambda x: x.name):
        m = WEEK_RE.match(p.name)
        if not m:
            continue
        try:
            display_path = p.relative_to(path_base).as_posix()
        except ValueError:
            display_path = p.as_posix()
        lines = p.read_text(encoding="utf-8").splitlines()
        title = lines[0].lstrip("# ").strip() if lines else p.stem
        entry_count = sum(1 for ln in lines if ln.startswith("| `"))
        rows.append(
            {
                "week": m.group(1),
                "title": title,
                "path": display_path,
                "entry_count": entry_count,
                "references": _extract_digest_refs(p),
            }
        )
    return rows


def run_export_site_data(
    objects_dir: Path,
    review_dir: Path,
    digests_dir: Path,
    private_out: Path,
    runtime_out: Path | None = None,
) -> int:
    private_index, meta = _export_private_index(objects_dir)
    private_queues = _export_private_queues(review_dir)
    private_digests = _export_private_digests(digests_dir)

    outputs = [private_out]
    if runtime_out and runtime_out != private_out:
        outputs.append(runtime_out)

    for out in outputs:
        _write_json(out / "index.json", private_index)
        _write_json(out / "queues.json", private_queues)
        _write_json(out / "digests.json", private_digests)

    for out in outputs:
        print(f"exported: {(out / 'index.json').as_posix()}")
        print(f"exported: {(out / 'queues.json').as_posix()}")
        print(f"exported: {(out / 'digests.json').as_posix()}")
    if meta["object_issues"]:
        print("warnings:")
        for issue in meta["object_issues"]:
            print(f" - {issue}")
    return 0


def _apply_profile(args: argparse.Namespace) -> None:
    if args.profile == "demo":
        args.objects_dir = "demo/objects"
        args.review_dir = "demo/review"
        args.digests_dir = "demo/digests"


def main() -> int:
    parser = argparse.ArgumentParser(description="Export private site data")
    parser.add_argument(
        "--profile",
        choices=["current", "demo"],
        default="current",
        help="Export current authority files or the bundled demo dataset",
    )
    parser.add_argument("--objects-dir", default="objects")
    parser.add_argument("--review-dir", default="review")
    parser.add_argument("--digests-dir", default="digests")
    parser.add_argument("--private-out", default="site-private/_pkos")
    parser.add_argument("--runtime-out", default="runtime/site-private/_pkos")
    args = parser.parse_args()
    _apply_profile(args)
    return run_export_site_data(
        Path(args.objects_dir),
        Path(args.review_dir),
        Path(args.digests_dir),
        Path(args.private_out),
        Path(args.runtime_out),
    )


if __name__ == "__main__":
    raise SystemExit(main())
