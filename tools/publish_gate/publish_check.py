"""PKOS publish gate checker.

Usage:
  python -m tools.publish_gate.publish_check
  python -m tools.publish_gate.publish_check --blog-dir blog/drafts
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REQUIRED_FRONTMATTER_KEYS = [
    "references",
    "assumptions",
    "invalidation_conditions",
    "last_updated",
    "revision_log_template",
]


@dataclass
class Issue:
    file: Path
    field: str
    message: str

    def fmt(self) -> str:
        return f"{self.file.as_posix()} :: {self.field} :: {self.message}"


def _parse_scalar(text: str) -> Any:
    v = text.strip()
    if v in {"", "null", "~"}:
        return "" if v == "" else None
    if v in {"true", "True"}:
        return True
    if v in {"false", "False"}:
        return False
    if v == "[]":
        return []
    if v == "{}":
        return {}
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    try:
        if "." in v:
            return float(v)
        return int(v)
    except Exception:
        return v


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


def _load_yaml(path: Path) -> dict[str, Any] | None:
    try:
        return _simple_yaml_load(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _extract_frontmatter(md_text: str) -> tuple[dict[str, Any] | None, str | None]:
    if not md_text.startswith("---\n"):
        return None, "missing YAML frontmatter"

    parts = md_text.split("\n---\n", 1)
    if len(parts) != 2:
        return None, "invalid frontmatter delimiter"

    fm_text = parts[0][4:]  # drop first ---\n
    data = _simple_yaml_load(fm_text)
    if not isinstance(data, dict):
        return None, "invalid frontmatter YAML"
    return data, None


def _build_object_index(objects_root: Path) -> dict[str, tuple[str, Path]]:
    index: dict[str, tuple[str, Path]] = {}
    for p in sorted(objects_root.rglob("*.y*ml")):
        obj = _load_yaml(p)
        if not isinstance(obj, dict):
            continue
        obj_id = str(obj.get("id", "")).strip()
        status = str(obj.get("status", "")).strip()
        if obj_id:
            index[obj_id] = (status, p)
    return index


def _validate_post(path: Path, obj_index: dict[str, tuple[str, Path]]) -> list[Issue]:
    issues: list[Issue] = []
    text = path.read_text(encoding="utf-8")
    fm, err = _extract_frontmatter(text)
    if err:
        return [Issue(path, "frontmatter", err)]

    assert fm is not None
    for key in REQUIRED_FRONTMATTER_KEYS:
        if key not in fm:
            issues.append(Issue(path, key, "required in frontmatter"))

    refs = fm.get("references")
    if not isinstance(refs, list) or len(refs) == 0:
        issues.append(Issue(path, "references", "must be non-empty list of object ids"))
        return issues

    for ref in refs:
        ref_id = str(ref).strip()
        if not ref_id:
            issues.append(Issue(path, "references", "contains empty id"))
            continue

        if ref_id not in obj_index:
            issues.append(Issue(path, f"references[{ref_id}]", "referenced object not found"))
            continue

        status, obj_path = obj_index[ref_id]
        if status != "trusted":
            issues.append(
                Issue(path, f"references[{ref_id}]", f"status={status} (must be trusted), object={obj_path.as_posix()}")
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

    obj_index = _build_object_index(objects_dir)
    all_issues: list[Issue] = []

    for post in posts:
        all_issues.extend(_validate_post(post, obj_index))

    if all_issues:
        print(f"PUBLISH CHECK FAILED: {len(all_issues)} issue(s) across {len(posts)} post(s)")
        for issue in all_issues:
            print(f" - {issue.fmt()}")
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
