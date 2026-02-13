"""PKOS object validator.

Usage:
  python -m tools.validators.validate
  python -m tools.validators.validate --path tools/validators/fixtures
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

ALLOWED_TYPES = {"fact", "skill", "claim"}
ALLOWED_STATUS = {"raw", "parsed", "challenged", "trusted", "deprecated"}
COMMON_REQUIRED_FIELDS = ["id", "type", "status", "source", "anchors", "created_at", "updated_at"]


@dataclass
class ValidationIssue:
    path: Path
    field: str
    message: str

    def format(self) -> str:
        return f"{self.path.as_posix()} :: {self.field} :: {self.message}"


def _parse_scalar(text: str) -> Any:
    value = text.strip()
    if value in {"", "null", "~"}:
        return "" if value == "" else None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def _simple_yaml_load(text: str) -> dict[str, Any] | None:
    """Minimal YAML loader for PKOS fixtures/templates.

    Supports mapping, nested mapping, and list values with 2-space indentation.
    """

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

        if ":" not in line:
            return None

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()

        if not isinstance(container, dict):
            return None

        if value == "":
            # Lookahead to decide dict vs list.
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
        text = path.read_text(encoding="utf-8")
    except Exception:
        return None
    return _simple_yaml_load(text)


def _is_non_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return True


def _contains_strong_opposition(item: Any) -> bool:
    tokens = ("强反对", "strong", "steelman", "high")
    if isinstance(item, str):
        text = item.lower()
        return any(t in text for t in tokens)
    if isinstance(item, dict):
        for key in ("strength", "level", "type", "tag", "label"):
            val = item.get(key)
            if isinstance(val, str) and any(t in val.lower() for t in tokens):
                return True
        for key in ("strong", "is_strong"):
            val = item.get(key)
            if isinstance(val, bool) and val:
                return True
    return False


def _classify_practice(item: Any) -> str | None:
    if isinstance(item, str):
        low = item.lower()
        if any(x in low for x in ("成功", "success", "pass", "done")):
            return "success"
        if any(x in low for x in ("失败", "fail", "error", "miss")):
            return "failure"
        return None

    if isinstance(item, dict):
        for key in ("result", "status", "outcome", "type"):
            val = item.get(key)
            if isinstance(val, str):
                low = val.lower()
                if any(x in low for x in ("成功", "success", "pass", "done")):
                    return "success"
                if any(x in low for x in ("失败", "fail", "error", "miss")):
                    return "failure"
        if isinstance(item.get("success"), bool):
            return "success" if item["success"] else "failure"
    return None


def validate_object(path: Path, obj: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    for field in COMMON_REQUIRED_FIELDS:
        if field not in obj:
            issues.append(ValidationIssue(path, field, "missing required field"))
        elif field in {"id", "type", "status", "created_at", "updated_at"} and not _is_non_empty(obj.get(field)):
            issues.append(ValidationIssue(path, field, "must be non-empty"))

    obj_type = obj.get("type")
    if obj_type not in ALLOWED_TYPES:
        issues.append(ValidationIssue(path, "type", f"must be one of {sorted(ALLOWED_TYPES)}"))

    status = obj.get("status")
    if status not in ALLOWED_STATUS:
        issues.append(ValidationIssue(path, "status", f"must be one of {sorted(ALLOWED_STATUS)}"))

    source = obj.get("source")
    if "source" in obj and isinstance(source, list) and len(source) == 0:
        issues.append(ValidationIssue(path, "source", "must contain at least one source item"))

    if status == "trusted" and obj_type == "fact":
        verification_sources = obj.get("verification_sources")
        if not isinstance(verification_sources, list) or len(verification_sources) < 1:
            issues.append(ValidationIssue(path, "verification_sources", "trusted fact requires >=1 verification source"))
        if not _is_non_empty(obj.get("counter_examples")) and not _is_non_empty(obj.get("easiest_mistakes")):
            issues.append(ValidationIssue(path, "counter_examples|easiest_mistakes", "trusted fact requires counter_examples (or equivalent)"))

    if status == "trusted" and obj_type == "skill":
        practice_log = obj.get("practice_log")
        if not isinstance(practice_log, list) or len(practice_log) == 0:
            issues.append(ValidationIssue(path, "practice_log", "trusted skill requires non-empty practice_log"))
        else:
            seen_success = False
            seen_failure = False
            for item in practice_log:
                cls = _classify_practice(item)
                if cls == "success":
                    seen_success = True
                elif cls == "failure":
                    seen_failure = True
            if not seen_success or not seen_failure:
                issues.append(ValidationIssue(path, "practice_log", "trusted skill requires >=1 success and >=1 failure entry"))

    if status == "trusted" and obj_type == "claim":
        counter_arguments = obj.get("counter_arguments")
        if not isinstance(counter_arguments, list) or len(counter_arguments) == 0:
            issues.append(ValidationIssue(path, "counter_arguments", "trusted claim requires non-empty counter_arguments"))
        elif not any(_contains_strong_opposition(item) for item in counter_arguments):
            issues.append(ValidationIssue(path, "counter_arguments", "trusted claim requires >=1 strong opposition"))

        if not _is_non_empty(obj.get("scope")):
            issues.append(ValidationIssue(path, "scope", "trusted claim requires non-empty scope"))

        if not _is_non_empty(obj.get("invalidation_conditions")) and not _is_non_empty(obj.get("failure_conditions")):
            issues.append(ValidationIssue(path, "invalidation_conditions|failure_conditions", "trusted claim requires explicit invalidation/failure conditions"))

    return issues


def iter_yaml_files(root: Path) -> Iterable[Path]:
    if root.is_file() and root.suffix.lower() in {".yaml", ".yml"}:
        yield root
        return
    for path in sorted(root.rglob("*.y*ml")):
        if path.is_file():
            yield path


def run_validation(target: Path) -> int:
    files = list(iter_yaml_files(target))
    if not files:
        print(f"WARNING: no YAML files found under {target.as_posix()}")
        return 0

    all_issues: list[ValidationIssue] = []
    valid_count = 0

    for path in files:
        obj = _load_yaml(path)
        if obj is None:
            all_issues.append(ValidationIssue(path, "file", "invalid YAML or unsupported YAML features"))
            continue
        issues = validate_object(path, obj)
        if issues:
            all_issues.extend(issues)
        else:
            valid_count += 1

    if all_issues:
        print(f"VALIDATION FAILED: {len(all_issues)} issue(s) across {len(files)} file(s)")
        for issue in all_issues:
            print(f" - {issue.format()}")
        return 1

    print(f"VALIDATION PASSED: {valid_count}/{len(files)} file(s) valid")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate PKOS YAML objects")
    parser.add_argument("--path", default="objects", help="Path to validate (default: objects)")
    args = parser.parse_args()
    return run_validation(Path(args.path))


if __name__ == "__main__":
    raise SystemExit(main())
