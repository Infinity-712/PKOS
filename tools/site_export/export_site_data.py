from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any

from tools.common.object_store import build_object_index
from tools.common.yaml_io import extract_markdown_frontmatter

WEEK_RE = re.compile(r"^(\d{4}-W\d{2})\.md$")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _slug_from_path(path: Path) -> str:
    return path.stem


def _export_private_index(objects_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    idx, issues = build_object_index(objects_dir)
    items: list[dict[str, Any]] = []
    for rec in sorted(idx.values(), key=lambda r: (r.object_type, r.status, r.object_id)):
        d = rec.data
        tags = d.get("tags") if isinstance(d.get("tags"), list) else []
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
            "path": rec.path.as_posix(),
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
    for p in sorted(digests_dir.glob("*.md"), key=lambda x: x.name):
        m = WEEK_RE.match(p.name)
        if not m:
            continue
        lines = p.read_text(encoding="utf-8").splitlines()
        title = lines[0].lstrip("# ").strip() if lines else p.stem
        entry_count = sum(1 for ln in lines if ln.startswith("| `"))
        rows.append(
            {
                "week": m.group(1),
                "title": title,
                "path": p.as_posix(),
                "entry_count": entry_count,
                "references": _extract_digest_refs(p),
            }
        )
    return rows


def _export_public_blog_index(blog_dir: Path) -> list[dict[str, str]]:
    posts = sorted(blog_dir.rglob("*.md")) if blog_dir.exists() else []
    rows: list[dict[str, str]] = []
    for p in posts:
        fm, _body, errs = extract_markdown_frontmatter(p)
        if errs or not isinstance(fm, dict):
            continue
        tags = fm.get("tags") if isinstance(fm.get("tags"), list) else []
        channel = str(fm.get("channel") or "knowledge")
        rows.append(
            {
                "slug": _slug_from_path(p),
                "title": str(fm.get("title") or p.stem),
                "summary": str(fm.get("summary") or ""),
                "date": str(fm.get("last_updated") or fm.get("date") or ""),
                "status": str(fm.get("status") or ""),
                "created_at": str(fm.get("created_at") or ""),
                "updated_at": str(fm.get("updated_at") or fm.get("last_updated") or ""),
                "tags": [str(t) for t in tags],
                "channel": channel,
                "path": p.as_posix(),
            }
        )
    rows.sort(key=lambda r: (r.get("channel", ""), r.get("date", ""), r.get("slug", "")))
    return rows


def run_export_site_data(
    objects_dir: Path,
    review_dir: Path,
    digests_dir: Path,
    blog_dir: Path,
    private_out: Path,
    public_out: Path,
) -> int:
    private_index, meta = _export_private_index(objects_dir)
    private_queues = _export_private_queues(review_dir)
    private_digests = _export_private_digests(digests_dir)
    public_blog = _export_public_blog_index(blog_dir)

    _write_json(private_out / "index.json", private_index)
    _write_json(private_out / "queues.json", private_queues)
    _write_json(private_out / "digests.json", private_digests)
    _write_json(public_out / "blog_index.json", public_blog)

    print(f"exported: {(private_out / 'index.json').as_posix()}")
    print(f"exported: {(private_out / 'queues.json').as_posix()}")
    print(f"exported: {(private_out / 'digests.json').as_posix()}")
    print(f"exported: {(public_out / 'blog_index.json').as_posix()}")
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
        args.blog_dir = "demo/blog"


def main() -> int:
    parser = argparse.ArgumentParser(description="Export site data for private/public static views")
    parser.add_argument(
        "--profile",
        choices=["current", "demo"],
        default="current",
        help="Export current authority files or the bundled demo dataset",
    )
    parser.add_argument("--objects-dir", default="objects")
    parser.add_argument("--review-dir", default="review")
    parser.add_argument("--digests-dir", default="digests")
    parser.add_argument("--blog-dir", default="blog/published")
    parser.add_argument("--private-out", default="site-private/_pkos")
    parser.add_argument("--public-out", default="site-public/_pkos")
    args = parser.parse_args()
    _apply_profile(args)
    return run_export_site_data(
        Path(args.objects_dir),
        Path(args.review_dir),
        Path(args.digests_dir),
        Path(args.blog_dir),
        Path(args.private_out),
        Path(args.public_out),
    )


if __name__ == "__main__":
    raise SystemExit(main())
