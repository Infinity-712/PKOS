"""PKOS object validator (schema-driven)."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from tools.common.schema import load_schema_registry, validate_object
from tools.common.yaml_io import DataIssue, load_yaml


def _iter_yaml_files(target: Path):
    if target.is_file() and target.suffix.lower() in {".yaml", ".yml"}:
        yield target
        return
    for path in sorted(target.rglob("*.y*ml")):
        if path.is_file():
            yield path


def run_validation(target: Path, schema_dir: Path = Path("tools/schema")) -> int:
    registry, schema_issues = load_schema_registry(schema_dir)
    if schema_issues:
        print(f"SCHEMA LOAD FAILED: {len(schema_issues)} issue(s)")
        for issue in schema_issues:
            print(f" - {issue.format()}")
        return 2
    assert registry is not None

    files = list(_iter_yaml_files(target))
    if not files:
        print(f"WARNING: no YAML files found under {target.as_posix()}")
        return 0

    all_issues: list[DataIssue] = []
    valid_count = 0

    for path in files:
        data, errs = load_yaml(path)
        if errs:
            all_issues.extend(errs)
            continue
        assert isinstance(data, dict)

        obj_type = str(data.get("type", "")).strip()
        schema = registry.by_type.get(obj_type)
        if schema is None:
            # use a fallback schema (any one) so enum/type errors are still schema-driven
            schema = next(iter(registry.by_type.values()))

        issues = validate_object(data, schema, context={"path": path.as_posix()})
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
    parser.add_argument("--schema-dir", default="tools/schema", help="Schema directory")
    args = parser.parse_args()
    return run_validation(Path(args.path), Path(args.schema_dir))


if __name__ == "__main__":
    raise SystemExit(main())
