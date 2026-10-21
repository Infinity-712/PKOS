from __future__ import annotations

from typing import Any


BODY_FIELDS = ("content", "definition", "explanation", "notes", "body", "text")
SECTION_FIELDS = (
    "counter_examples",
    "verification_sources",
    "easiest_mistakes",
    "common_mistakes",
    "practice_log",
    "assumptions",
    "evidence",
    "counter_arguments",
    "scope",
    "invalidation_conditions",
    "failure_conditions",
    "source",
    "anchors",
    "tags",
)


def render_object(data: dict[str, Any], *, object_content_sha256: str) -> dict[str, Any]:
    body_field, body = _body(data)
    sections = []
    for field in SECTION_FIELDS:
        if field == body_field:
            continue
        value = data.get(field)
        if not _has_value(value):
            continue
        sections.append(
            {
                "id": field,
                "title": _title(field),
                "kind": _kind(value),
                "items": _items(value),
            }
        )
    return {
        "body": body,
        "sections": sections,
        "metadata": {
            "id": str(data.get("id") or ""),
            "type": str(data.get("type") or ""),
            "status": str(data.get("status") or ""),
            "title": str(data.get("title") or data.get("id") or ""),
            "summary": str(data.get("summary") or ""),
            "bodyField": body_field,
        },
        "objectContentSha256": object_content_sha256,
    }


def _body(data: dict[str, Any]) -> tuple[str | None, str]:
    for field in BODY_FIELDS:
        value = data.get(field)
        if _has_value(value):
            return field, _stringify(value)
    return None, ""


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def _kind(value: Any) -> str:
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return "text"


def _items(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [{"key": key, "value": child} for key, child in value.items()]
    return [value]


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(_stringify(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(f"{key}: {_stringify(child)}" for key, child in value.items())
    return str(value)


def _title(field: str) -> str:
    return field.replace("_", " ").title()
