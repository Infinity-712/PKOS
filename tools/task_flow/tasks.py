from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "0.7-alpha"
TASK_ITEM_TYPE = "task_item"
TASK_ACTION_TYPE = "task_action"

PRIORITIES = {"low", "normal", "high"}
STATUSES = {"open", "in_progress", "blocked", "done", "cancelled"}
ACTION_TYPES = {"status_changed", "note_added"}
STATUS_BUCKETS = {"open": 0, "in_progress": 1, "blocked": 2, "done": 3, "cancelled": 4}
TRANSITIONS = {
    "open": {"in_progress", "blocked", "done", "cancelled"},
    "in_progress": {"open", "blocked", "done", "cancelled"},
    "blocked": {"open", "in_progress", "done", "cancelled"},
    "done": {"open"},
    "cancelled": {"open"},
}


class TaskFlowError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    tags: list[str] = []
    for raw in value.split(","):
        tag = raw.strip()
        if not tag:
            continue
        if len(tag) > 64:
            raise TaskFlowError("invalid_tag", "tag must be at most 64 characters")
        if tag not in tags:
            tags.append(tag)
    if len(tags) > 20:
        raise TaskFlowError("invalid_tags", "tags must contain at most 20 items")
    return tags


def normalize_due_at(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise TaskFlowError("invalid_due_at", "dueAt must be a strict ISO 8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise TaskFlowError("invalid_due_at", "dueAt must include a timezone")
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_task_item(
    title: str,
    description: str | None,
    source: str,
    tags: list[str],
    priority: str,
    due_at: str | None,
    created_by: str,
    request_id: str | None,
    created_at: str | None = None,
) -> dict[str, Any]:
    title = title.strip()
    description = (description or "").strip()
    source = source.strip() or "manual"
    created_by = created_by.strip() or "human"
    request_id = (request_id or "").strip() or None
    if not title:
        raise TaskFlowError("invalid_title", "title must not be empty")
    if len(title) > 200:
        raise TaskFlowError("invalid_title", "title must be at most 200 characters")
    if len(description) > 4000:
        raise TaskFlowError("invalid_description", "description must be at most 4000 characters")
    if priority not in PRIORITIES:
        raise TaskFlowError("invalid_priority", f"invalid priority: {priority}")
    if len(source) > 64 or len(created_by) > 128:
        raise TaskFlowError("invalid_actor", "source and created_by must be bounded strings")

    ts = created_at or utc_now()
    payload = {
        "operation": "task-create",
        "title": title,
        "description": description or None,
        "source": source,
        "tags": tags,
        "priority": priority,
        "due_at": due_at,
        "created_by": created_by,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "type": TASK_ITEM_TYPE,
        "id": _new_id("task", ts),
        "title": title,
        "description": description or None,
        "source": source,
        "tags": tags,
        "priority": priority,
        "status": "open",
        "due_at": due_at,
        "created_at": ts,
        "created_by": created_by,
        "request_id": request_id,
        "payload_sha256": stable_hash(payload),
    }


def build_status_action(
    task_id: str,
    from_status: str,
    to_status: str,
    reason: str,
    created_by: str,
    request_id: str | None,
    created_at: str | None = None,
) -> dict[str, Any]:
    task_id = task_id.strip()
    reason = reason.strip()
    created_by = created_by.strip() or "human"
    request_id = (request_id or "").strip() or None
    if not task_id:
        raise TaskFlowError("invalid_task_id", "task id must not be empty")
    if from_status not in STATUSES or to_status not in STATUSES:
        raise TaskFlowError("invalid_status", "invalid task status")
    if not reason:
        raise TaskFlowError("invalid_reason", "reason must not be empty")
    if len(reason) > 4000:
        raise TaskFlowError("invalid_reason", "reason must be at most 4000 characters")
    ts = created_at or utc_now()
    payload = {
        "operation": "task-transition",
        "task_id": task_id,
        "target_status": to_status,
        "reason": reason,
        "created_by": created_by,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "type": TASK_ACTION_TYPE,
        "id": _new_id("task_action", ts),
        "task_id": task_id,
        "action_type": "status_changed",
        "from_status": from_status,
        "to_status": to_status,
        "reason": reason,
        "created_at": ts,
        "created_by": created_by,
        "request_id": request_id,
        "payload_sha256": stable_hash(payload),
    }


def run_create(
    items_path: Path,
    actions_path: Path,
    runtime_path: Path,
    title: str,
    description: str | None,
    source: str,
    tags: list[str],
    priority: str,
    due_at: str | None,
    created_by: str,
    request_id: str | None,
) -> dict[str, Any]:
    item = build_task_item(title, description, source, tags, priority, due_at, created_by, request_id)
    existing_items = _read_items(items_path)
    existing_actions = _read_actions(actions_path)
    existing = _find_request(existing_items, request_id)
    if existing:
        _assert_same_payload(existing, item)
        view = rebuild_current_view(items_path, actions_path, runtime_path)
        return {"ok": True, "status": "replayed", "task": _task_from_view(view, existing["id"]), "item": existing}
    if _find_request(existing_actions, request_id):
        _raise_idempotency_conflict()
    _append_jsonl(items_path, item)
    view = rebuild_current_view(items_path, actions_path, runtime_path)
    return {"ok": True, "status": "created", "task": _task_from_view(view, item["id"]), "item": item}


def run_transition(
    items_path: Path,
    actions_path: Path,
    runtime_path: Path,
    task_id: str,
    target_status: str,
    reason: str,
    created_by: str,
    request_id: str | None,
) -> dict[str, Any]:
    if target_status not in STATUSES:
        raise TaskFlowError("invalid_status", f"invalid status: {target_status}")
    if _find_request(_read_items(items_path), request_id):
        _raise_idempotency_conflict()
    existing_action = _find_request(_read_actions(actions_path), request_id)
    if existing_action:
        if existing_action.get("action_type") != "status_changed":
            _raise_idempotency_conflict()
        candidate = build_status_action(task_id, str(existing_action.get("from_status") or ""), target_status, reason, created_by, request_id)
        _assert_same_payload(existing_action, candidate)
        view = rebuild_current_view(items_path, actions_path, runtime_path)
        return {"ok": True, "status": "replayed", "task": _task_from_view(view, task_id), "action": existing_action}

    view = build_current_view(items_path, actions_path)
    task = _task_from_view(view, task_id)
    if not task:
        raise TaskFlowError("task_not_found", f"task not found: {task_id}")
    from_status = str(task.get("status") or "")
    if from_status == target_status:
        write_current_view(runtime_path, view)
        return {"ok": True, "status": "no_state_change", "task": task, "action": None}
    if target_status not in TRANSITIONS.get(from_status, set()):
        raise TaskFlowError("invalid_transition", f"cannot transition from {from_status} to {target_status}")
    action = build_status_action(task_id, from_status, target_status, reason, created_by, request_id)
    _append_jsonl(actions_path, action)
    updated = rebuild_current_view(items_path, actions_path, runtime_path)
    return {"ok": True, "status": "changed", "task": _task_from_view(updated, task_id), "action": action}


def run_list(
    items_path: Path,
    actions_path: Path,
    runtime_path: Path,
    status: str | None = None,
    priority: str | None = None,
    tag: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    if status and status not in STATUSES:
        raise TaskFlowError("invalid_status", f"invalid status: {status}")
    if priority and priority not in PRIORITIES:
        raise TaskFlowError("invalid_priority", f"invalid priority: {priority}")
    if limit is not None and (limit < 1 or limit > 200):
        raise TaskFlowError("invalid_limit", "limit must be between 1 and 200")
    view = rebuild_current_view(items_path, actions_path, runtime_path)
    items = [
        item
        for item in view["items"]
        if (not status or item.get("status") == status)
        and (not priority or item.get("priority") == priority)
        and (not tag or tag in item.get("tags", []))
    ]
    if limit is not None:
        items = items[:limit]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": view["generated_at"],
        "filters": {"status": status, "priority": priority, "tag": tag, "limit": limit},
        "count": len(items),
        "items": items,
        "source": view["source"],
    }


def rebuild_current_view(items_path: Path, actions_path: Path, runtime_path: Path, generated_at: str | None = None) -> dict[str, Any]:
    view = build_current_view(items_path, actions_path, generated_at)
    write_current_view(runtime_path, view)
    return view


def build_current_view(items_path: Path, actions_path: Path, generated_at: str | None = None) -> dict[str, Any]:
    task_items = _read_items(items_path)
    task_actions = _read_actions(actions_path)
    tasks: dict[str, dict[str, Any]] = {}
    for item in task_items:
        _validate_item(item)
        task_id = str(item["id"])
        if task_id in tasks:
            raise TaskFlowError("duplicate_task_id", f"duplicate task id: {task_id}")
        tasks[task_id] = {
            "id": task_id,
            "title": str(item.get("title") or ""),
            "description": item.get("description") if isinstance(item.get("description"), str) else None,
            "source": str(item.get("source") or ""),
            "tags": [str(tag) for tag in item.get("tags", []) if isinstance(tag, str)],
            "priority": str(item.get("priority") or "normal"),
            "due_at": item.get("due_at") if isinstance(item.get("due_at"), str) else None,
            "created_at": str(item.get("created_at") or ""),
            "created_by": str(item.get("created_by") or ""),
            "status": str(item.get("status") or "open"),
            "latest_action_id": None,
            "latest_action_at": None,
            "latest_reason": None,
            "notes_count": 0,
            "latest_note_at": None,
        }
    for action in task_actions:
        _validate_action(action)
        task_id = str(action.get("task_id") or "")
        task = tasks.get(task_id)
        if not task:
            raise TaskFlowError("unknown_task_action", f"action references missing task: {task_id}")
        action_type = str(action.get("action_type") or "")
        if action_type == "status_changed":
            from_status = str(action.get("from_status") or "")
            to_status = str(action.get("to_status") or "")
            if task["status"] != from_status:
                raise TaskFlowError("status_mismatch", f"action from_status mismatch for task: {task_id}")
            if to_status not in TRANSITIONS.get(from_status, set()):
                raise TaskFlowError("invalid_transition", f"cannot transition from {from_status} to {to_status}")
            task["status"] = to_status
            task["latest_reason"] = str(action.get("reason") or "")
            task["latest_action_id"] = str(action.get("id") or "")
            task["latest_action_at"] = str(action.get("created_at") or "")
        elif action_type == "note_added":
            task["notes_count"] = int(task.get("notes_count") or 0) + 1
            task["latest_note_at"] = str(action.get("created_at") or "")
            task["latest_action_id"] = str(action.get("id") or "")
            task["latest_action_at"] = str(action.get("created_at") or "")
    items = sorted(tasks.values(), key=_sort_key)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "source": {
            "items_path": items_path.as_posix(),
            "actions_path": actions_path.as_posix(),
            "items_count": len(task_items),
            "actions_count": len(task_actions),
            "items_sha256": file_sha256(items_path),
            "actions_sha256": file_sha256(actions_path),
        },
        "count": len(items),
        "items": items,
    }


def build_task_summary(items_path: Path, actions_path: Path, generated_at: str | None = None) -> dict[str, Any]:
    view = build_current_view(items_path, actions_path, generated_at)
    now_dt = _parse_utc(view["generated_at"]) or datetime.now(timezone.utc)
    counts = {status: 0 for status in STATUS_BUCKETS}
    overdue_count = 0
    next_due_at: str | None = None
    for item in view["items"]:
        status = str(item.get("status") or "open")
        counts[status] = counts.get(status, 0) + 1
        due_at = item.get("due_at")
        if isinstance(due_at, str) and status not in {"done", "cancelled"}:
            due_dt = _parse_utc(due_at)
            if due_dt and due_dt < now_dt:
                overdue_count += 1
            if next_due_at is None or due_at < next_due_at:
                next_due_at = due_at
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": view["generated_at"],
        "source": {
            "authority": "tasks/items.jsonl + tasks/actions.jsonl",
            "items_count": view["source"]["items_count"],
            "actions_count": view["source"]["actions_count"],
            "items_sha256": view["source"]["items_sha256"],
            "actions_sha256": view["source"]["actions_sha256"],
        },
        "counts": {
            "open": counts.get("open", 0),
            "in_progress": counts.get("in_progress", 0),
            "blocked": counts.get("blocked", 0),
            "done": counts.get("done", 0),
            "cancelled": counts.get("cancelled", 0),
            "overdue": overdue_count,
        },
        "next_due_at": next_due_at,
        "stale": False,
    }


def write_current_view(runtime_path: Path, view: dict[str, Any]) -> None:
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_path.write_text(json.dumps(view, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def file_sha256(path: Path) -> str:
    if not path.exists():
        return hashlib.sha256(b"").hexdigest()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(_sort_value(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _read_items(path: Path) -> list[dict[str, Any]]:
    return _read_jsonl_strict(path, "malformed_item_log")


def _read_actions(path: Path) -> list[dict[str, Any]]:
    return _read_jsonl_strict(path, "malformed_action_log")


def _read_jsonl_strict(path: Path, error_code: str) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise TaskFlowError(error_code, f"invalid JSON at {path.as_posix()}:{line_no}") from exc
        if not isinstance(item, dict):
            raise TaskFlowError(error_code, f"non-object JSON at {path.as_posix()}:{line_no}")
        rows.append(item)
    return rows


def _append_jsonl(path: Path, item: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def _find_request(rows: list[dict[str, Any]], request_id: str | None) -> dict[str, Any] | None:
    if not request_id:
        return None
    for row in rows:
        if row.get("request_id") == request_id:
            return row
    return None


def _assert_same_payload(existing: dict[str, Any], candidate: dict[str, Any]) -> None:
    if existing.get("payload_sha256") != candidate.get("payload_sha256"):
        _raise_idempotency_conflict()


def _raise_idempotency_conflict() -> None:
    raise TaskFlowError("idempotency_conflict", "requestId was already used with a different task payload")


def _task_from_view(view: dict[str, Any], task_id: str) -> dict[str, Any] | None:
    return next((item for item in view.get("items", []) if item.get("id") == task_id), None)


def _validate_item(item: dict[str, Any]) -> None:
    if item.get("type") != TASK_ITEM_TYPE:
        raise TaskFlowError("invalid_task_item", "task item type is invalid")
    if not str(item.get("id") or "").strip():
        raise TaskFlowError("invalid_task_item", "task item id is required")
    if not str(item.get("title") or "").strip():
        raise TaskFlowError("invalid_task_item", "task item title is required")
    if item.get("priority") not in PRIORITIES:
        raise TaskFlowError("invalid_priority", "task item priority is invalid")
    if item.get("status") != "open":
        raise TaskFlowError("invalid_task_item", "task item initial status must be open")
    if item.get("due_at") is not None:
        normalize_due_at(str(item.get("due_at")))


def _validate_action(action: dict[str, Any]) -> None:
    if action.get("type") != TASK_ACTION_TYPE:
        raise TaskFlowError("invalid_task_action", "task action type is invalid")
    action_type = action.get("action_type")
    if action_type not in ACTION_TYPES:
        raise TaskFlowError("invalid_task_action", "task action_type is invalid")
    if not str(action.get("task_id") or "").strip():
        raise TaskFlowError("invalid_task_action", "task action task_id is required")
    if action_type == "status_changed":
        if action.get("from_status") not in STATUSES or action.get("to_status") not in STATUSES:
            raise TaskFlowError("invalid_status", "task action status is invalid")
        if not str(action.get("reason") or "").strip():
            raise TaskFlowError("invalid_reason", "status action reason is required")
    if action_type == "note_added" and not str(action.get("note") or "").strip():
        raise TaskFlowError("invalid_note", "note action note is required")


def _sort_key(item: dict[str, Any]) -> tuple[int, str, str, str]:
    due = item.get("due_at") if isinstance(item.get("due_at"), str) else "9999-12-31T23:59:59Z"
    return (STATUS_BUCKETS.get(str(item.get("status") or ""), 99), due, str(item.get("created_at") or ""), str(item.get("id") or ""))


def _parse_utc(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _new_id(prefix: str, ts: str) -> str:
    compact = ts.replace("-", "").replace(":", "")
    return f"{prefix}_{compact}_{uuid.uuid4().hex[:8]}"


def _sort_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _sort_value(value[key]) for key in sorted(value) if value[key] is not None}
    return value
