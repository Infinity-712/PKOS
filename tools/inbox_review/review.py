from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "0.5-alpha"
REVIEW_ACTION_TYPE = "inbox_review_action"
ALLOWED_STATUSES = {"unprocessed", "archived", "converted"}
DEFAULT_STATUS = "unprocessed"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_id(ts: str) -> str:
    compact = ts.replace("-", "").replace(":", "")
    return f"inbox_review_{compact}_{uuid.uuid4().hex[:8]}"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
    return rows


def _append_jsonl(path: Path, item: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _base_status(item: dict[str, Any]) -> str:
    status = str(item.get("status") or DEFAULT_STATUS)
    return status if status in ALLOWED_STATUSES else DEFAULT_STATUS


def _latest_status_by_id(actions: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for action in actions:
        if action.get("type") != REVIEW_ACTION_TYPE or action.get("action") != "mark_status":
            continue
        inbox_id = str(action.get("inbox_id") or "").strip()
        status = str(action.get("status") or "").strip()
        if not inbox_id or status not in ALLOWED_STATUSES:
            continue
        latest[inbox_id] = action
    return latest


def _summarize_item(item: dict[str, Any], status_action: dict[str, Any] | None) -> dict[str, Any]:
    item_id = str(item.get("id") or "")
    effective_status = str(status_action.get("status")) if status_action else _base_status(item)
    tags = item.get("tags") if isinstance(item.get("tags"), list) else []
    return {
        "id": item_id,
        "effective_status": effective_status,
        "initial_status": _base_status(item),
        "source": str(item.get("source") or ""),
        "capture_type": str(item.get("capture_type") or ""),
        "created_at": str(item.get("created_at") or ""),
        "content": str(item.get("content") or ""),
        "tags": [str(tag) for tag in tags],
        "review_action_id": str(status_action.get("id") or "") if status_action else "",
        "reviewed_at": str(status_action.get("created_at") or "") if status_action else "",
        "review_reason": str(status_action.get("reason") or "") if status_action else "",
    }


def _matches_filters(item: dict[str, Any], status: str | None, source: str | None, tag: str | None) -> bool:
    if status and item.get("effective_status") != status:
        return False
    if source and item.get("source") != source:
        return False
    if tag and tag not in item.get("tags", []):
        return False
    return True


def build_review_view(
    inbox_path: Path,
    actions_path: Path,
    status: str | None = None,
    source: str | None = None,
    tag: str | None = None,
    limit: int | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    if status and status not in ALLOWED_STATUSES:
        raise ValueError(f"invalid status: {status}")
    if limit is not None and limit < 1:
        raise ValueError("limit must be greater than zero")

    inbox_items = _read_jsonl(inbox_path)
    actions = _read_jsonl(actions_path)
    latest_status = _latest_status_by_id(actions)
    summaries = [
        _summarize_item(item, latest_status.get(str(item.get("id") or "")))
        for item in inbox_items
        if str(item.get("id") or "").strip()
    ]
    summaries.sort(key=lambda item: (str(item.get("created_at") or ""), str(item.get("id") or "")))
    filtered = [item for item in summaries if _matches_filters(item, status, source, tag)]
    if limit is not None:
        filtered = filtered[:limit]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "filters": {
            "status": status,
            "source": source,
            "tag": tag,
            "limit": limit,
        },
        "count": len(filtered),
        "items": filtered,
    }


def write_current_view(runtime_path: Path, view: dict[str, Any]) -> None:
    _write_json(runtime_path, view)


def run_list(
    inbox_path: Path,
    actions_path: Path,
    runtime_path: Path,
    status: str | None = None,
    source: str | None = None,
    tag: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    view = build_review_view(inbox_path, actions_path, status, source, tag, limit)
    write_current_view(runtime_path, view)
    return view


def build_action(inbox_id: str, status: str, reason: str, source: str = "manual", created_at: str | None = None) -> dict[str, Any]:
    inbox_id = inbox_id.strip()
    reason = reason.strip()
    if not inbox_id:
        raise ValueError("inbox id must not be empty")
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"invalid status: {status}")
    if not reason:
        raise ValueError("reason must not be empty")
    ts = created_at or utc_now()
    return {
        "schema_version": SCHEMA_VERSION,
        "type": REVIEW_ACTION_TYPE,
        "id": _new_id(ts),
        "created_at": ts,
        "inbox_id": inbox_id,
        "action": "mark_status",
        "status": status,
        "reason": reason,
        "source": source,
    }


def run_mark(
    inbox_path: Path,
    actions_path: Path,
    runtime_path: Path,
    inbox_id: str,
    status: str,
    reason: str,
) -> dict[str, Any]:
    inbox_items = _read_jsonl(inbox_path)
    if not any(str(item.get("id") or "") == inbox_id for item in inbox_items):
        raise KeyError(f"inbox id not found: {inbox_id}")

    action = build_action(inbox_id, status, reason)
    _append_jsonl(actions_path, action)
    view = build_review_view(inbox_path, actions_path)
    write_current_view(runtime_path, view)
    effective = next((item for item in view["items"] if item.get("id") == inbox_id), None)
    return {
        "ok": True,
        "action": action,
        "item": effective,
        "runtime_path": runtime_path.as_posix(),
        "action_log_path": actions_path.as_posix(),
    }


def content_excerpt(content: str, max_chars: int = 80) -> str:
    text = " ".join(str(content or "").split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3] + "..."
