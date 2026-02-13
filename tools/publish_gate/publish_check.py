"""PKOS publish gate checker."""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.common.object_store import build_object_index
from tools.common.yaml_io import DataIssue, extract_markdown_frontmatter

REQUIRED_FRONTMATTER_KEYS = [
    "references",
    "assumptions",
    "invalidation_conditions",
    "last_updated",
    "revision_log_template",
]


def _validate_post(path: Path, obj_index) -> list[DataIssue]:
    fm, _body, errs = extract_markdown_frontmatter(path)
    if errs:
        return errs
    assert isinstance(fm, dict)

    issues: list[DataIssue] = []
    for key in REQUIRED_FRONTMATTER_KEYS:
        if key not in fm:
            issues.append(DataIssue(path, key, "required in frontmatter"))

    refs = fm.get("references")
    if not isinstance(refs, list) or len(refs) == 0:
        issues.append(DataIssue(path, "references", "must be non-empty list of object ids"))
        return issues

    for ref in refs:
        ref_id = str(ref).strip()
        if not ref_id:
            issues.append(DataIssue(path, "references", "contains empty id"))
            continue

        record = obj_index.get(ref_id)
        if record is None:
            issues.append(DataIssue(path, f"references[{ref_id}]", "referenced object not found"))
            continue

        if record.status != "trusted":
            issues.append(
                DataIssue(
                    path,
                    f"references[{ref_id}]",
                    f"status={record.status} (must be trusted), object={record.path.as_posix()}",
                )
            )

    return issues


def run_publish_check(blog_dir: Path, objects_dir: Path) -> int:
    if not blog_dir.exists():
        print(f"ERROR: blog dir not found: {blog_dir.as_posix()}")
        return 2

    posts = sorted(blog_dir.rglob("*.md"))
    if not posts:
        print(f"WARNING: no markdown posts found in {blog_dir.as_posix()}")
        return 0

    obj_index, object_issues = build_object_index(objects_dir)
    all_issues: list[DataIssue] = [*object_issues]

    for post in posts:
        all_issues.extend(_validate_post(post, obj_index))

    if all_issues:
        print(f"PUBLISH CHECK FAILED: {len(all_issues)} issue(s) across {len(posts)} post(s)")
        for issue in all_issues:
            print(f" - {issue.format()}")
        return 1

    print(f"PUBLISH CHECK PASSED: {len(posts)} post(s) checked")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="PKOS publish gate checker")
    parser.add_argument("--blog-dir", default="blog/drafts", help="Blog directory to check")
    parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    args = parser.parse_args()
    return run_publish_check(Path(args.blog_dir), Path(args.objects_dir))


if __name__ == "__main__":
    raise SystemExit(main())
