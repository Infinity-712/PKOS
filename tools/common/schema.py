from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tools.common.yaml_io import DataIssue, load_yaml


@dataclass
class SchemaRegistry:
    by_type: dict[str, dict[str, Any]]


def load_schema_registry(schema_dir: Path) -> tuple[SchemaRegistry | None, list[DataIssue]]:
    issues: list[DataIssue] = []
    by_type: dict[str, dict[str, Any]] = {}

    for path in sorted(schema_dir.glob("*.yaml")):
        data, errs = load_yaml(path)
        issues.extend(errs)
        if not isinstance(data, dict):
            continue

        type_value = str(data.get("type_value", "")).strip()
        if not type_value:
            issues.append(DataIssue(path, "type_value", "missing schema type_value"))
            continue
        by_type[type_value] = data

    if not by_type:
        issues.append(DataIssue(schema_dir, "$", "no valid schema loaded"))
        return None, issues

    return SchemaRegistry(by_type=by_type), issues


def _is_non_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return True


def _contains_token(item: Any, tokens: list[str]) -> bool:
    low_tokens = [t.lower() for t in tokens]
    if isinstance(item, str):
        text = item.lower()
        return any(t in text for t in low_tokens)
    if isinstance(item, dict):
        for v in item.values():
            if isinstance(v, str) and any(t in v.lower() for t in low_tokens):
                return True
        for k in ("strong", "is_strong"):
            if isinstance(item.get(k), bool) and item[k]:
                return True
    return False


def validate_object(data: dict[str, Any], schema: dict[str, Any], context: dict[str, Any]) -> list[DataIssue]:
    path = Path(context["path"])
    issues: list[DataIssue] = []

    required_fields = schema.get("required_fields", [])
    for field in required_fields:
        if field not in data:
            issues.append(DataIssue(path, str(field), "missing required field"))

    non_empty_fields = schema.get("non_empty_fields", [])
    for field in non_empty_fields:
        if field in data and not _is_non_empty(data.get(field)):
            issues.append(DataIssue(path, str(field), "must be non-empty"))

    enum_fields = schema.get("enum_fields", {})
    if isinstance(enum_fields, dict):
        for field, allowed in enum_fields.items():
            if field not in data:
                continue
            if data.get(field) not in allowed:
                issues.append(DataIssue(path, str(field), f"must be one of {allowed}"))

    for rule in schema.get("field_rules", []):
        issues.extend(_apply_rule(data, path, rule))

    if data.get("status") == "trusted":
        for rule in schema.get("trusted_rules", []):
            issues.extend(_apply_rule(data, path, rule))

    return issues


def _apply_rule(data: dict[str, Any], path: Path, rule: dict[str, Any]) -> list[DataIssue]:
    issues: list[DataIssue] = []
    kind = rule.get("rule")

    if kind == "min_items":
        field = str(rule.get("field"))
        min_items = int(rule.get("min", 1))
        value = data.get(field)
        if not isinstance(value, list) or len(value) < min_items:
            issues.append(DataIssue(path, field, f"requires at least {min_items} item(s)"))

    elif kind == "any_non_empty":
        fields = rule.get("fields", [])
        if not any(_is_non_empty(data.get(str(f))) for f in fields):
            issues.append(DataIssue(path, "|".join(str(f) for f in fields), "at least one field must be non-empty"))

    elif kind == "contains_success_and_failure":
        field = str(rule.get("field"))
        value = data.get(field)
        if not isinstance(value, list):
            issues.append(DataIssue(path, field, "must be a list"))
            return issues

        success_tokens = rule.get("success_tokens", ["success", "成功", "pass", "done"])
        failure_tokens = rule.get("failure_tokens", ["failure", "失败", "fail", "error", "miss"])

        seen_success = any(_contains_token(item, success_tokens) for item in value)
        seen_failure = any(_contains_token(item, failure_tokens) for item in value)
        if not seen_success or not seen_failure:
            issues.append(DataIssue(path, field, "requires >=1 success and >=1 failure entry"))

    elif kind == "contains_strong_opposition":
        field = str(rule.get("field"))
        value = data.get(field)
        if not isinstance(value, list) or len(value) == 0:
            issues.append(DataIssue(path, field, "must be non-empty list"))
            return issues
        tokens = rule.get("tokens", ["强反对", "strong", "steelman", "high"])
        if not any(_contains_token(item, tokens) for item in value):
            issues.append(DataIssue(path, field, "requires at least one strong opposition entry"))

    elif kind == "non_empty":
        field = str(rule.get("field"))
        if not _is_non_empty(data.get(field)):
            issues.append(DataIssue(path, field, "must be non-empty"))

    return issues
