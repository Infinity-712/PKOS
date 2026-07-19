from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from tools.task_flow.tasks import TaskFlowError, build_current_view as build_task_current_view

SCHEMA_VERSION = "0.7-beta"
REMINDER_ITEM_TYPE = "reminder_item"
REMINDER_ACTION_TYPE = "reminder_action"

STATUSES = {"scheduled", "acknowledged", "cancelled"}
ACTION_TYPES = {"acknowledged", "cancelled", "rescheduled"}


class ReminderFlowError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_remind_at(value: str | None) -> str:
    if value is None or not value.strip():
        raise ReminderFlowError("invalid_remind_at", "remindAt must not be empty")
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReminderFlowError("invalid_remind_at", "remindAt must be a strict ISO 8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ReminderFlowError("invalid_remind_at", "remindAt must include a timezone")
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def build_reminder_item(
    title: str,
    description: str | None,
    remind_at: str,
    task_id: str | None,
    source: str,
    created_by: str,
    request_id: str | None,
    created_at: str | None = None,
) -> dict[str, Any]:
    title = title.strip()
    description = (description or "").strip()
    task_id = (task_id or "").strip() or None
    source = source.strip() or "manual"
    created_by = created_by.strip() or "human"
    request_id = (request_id or "").strip() or None
    if not title:
        raise ReminderFlowError("invalid_title", "title must not be empty")
    if len(title) > 200:
        raise ReminderFlowError("invalid_title", "title must be at most 200 characters")
    if len(description) > 4000:
        raise ReminderFlowError("invalid_description", "description must be at most 4000 characters")
    if len(source) > 64 or len(created_by) > 128:
        raise ReminderFlowError("invalid_actor", "source and created_by must be bounded strings")
    ts = created_at or utc_now()
    payload = {
        "operation": "reminder-create",
        "title": title,
        "description": description or None,
        "remind_at": remind_at,
        "task_id": task_id,
        "source": source,
        "created_by": created_by,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "type": REMINDER_ITEM_TYPE,
        "id": _new_id("reminder", ts),
        "title": title,
        "description": description or None,
        "remind_at": remind_at,
        "task_id": task_id,
        "source": source,
        "status": "scheduled",
        "created_at": ts,
        "created_by": created_by,
        "request_id": request_id,
        "payload_sha256": stable_hash(payload),
    }


def build_reminder_action(
    reminder_id: str,
    action_type: str,
    reason: str,
    created_by: str,
    request_id: str | None,
    remind_at: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    reminder_id = reminder_id.strip()
    reason = reason.strip()
    created_by = created_by.strip() or "human"
    request_id = (request_id or "").strip() or None
    if not reminder_id:
        raise ReminderFlowError("invalid_reminder_id", "reminder id must not be empty")
    if action_type not in ACTION_TYPES:
        raise ReminderFlowError("invalid_action_type", f"invalid reminder action: {action_type}")
    if not reason:
        raise ReminderFlowError("invalid_reason", "reason must not be empty")
    if len(reason) > 4000:
        raise ReminderFlowError("invalid_reason", "reason must be at most 4000 characters")
    if action_type == "rescheduled" and not remind_at:
        raise ReminderFlowError("invalid_remind_at", "rescheduled action requires remindAt")
    ts = created_at or utc_now()
    payload = {
        "operation": f"reminder-{action_type}",
        "reminder_id": reminder_id,
        "action_type": action_type,
        "reason": reason,
        "created_by": created_by,
        "remind_at": remind_at,
    }
    item = {
        "schema_version": SCHEMA_VERSION,
        "type": REMINDER_ACTION_TYPE,
        "id": _new_id("reminder_action", ts),
        "reminder_id": reminder_id,
        "action_type": action_type,
        "reason": reason,
        "created_at": ts,
        "created_by": created_by,
        "request_id": request_id,
        "payload_sha256": stable_hash(payload),
    }
    if remind_at is not None:
        item["remind_at"] = remind_at
    return item


def run_create(
    items_path: Path,
    actions_path: Path,
    current_path: Path,
    due_path: Path,
    task_items_path: Path,
    task_actions_path: Path,
    title: str,
    description: str | None,
    remind_at: str,
    task_id: str | None,
    source: str,
    created_by: str,
    request_id: str | None,
) -> dict[str, Any]:
    if task_id:
        _assert_task_exists(task_items_path, task_actions_path, task_id)
    item = build_reminder_item(title, description, remind_at, task_id, source, created_by, request_id)
    existing_items = _read_items(items_path)
    existing_actions = _read_actions(actions_path)
    existing = _find_request(existing_items, request_id)
    if existing:
        _assert_same_payload(existing, item)
        current = rebuild_current_view(items_path, actions_path, current_path)
        due = rebuild_due_view(items_path, actions_path, due_path)
        return {"ok": True, "status": "replayed", "reminder": _reminder_from_view(current, existing["id"]), "item": existing, "due": due}
    if _find_request(existing_actions, request_id):
        _raise_idempotency_conflict()
    _append_jsonl(items_path, item)
    current = rebuild_current_view(items_path, actions_path, current_path)
    due = rebuild_due_view(items_path, actions_path, due_path)
    return {"ok": True, "status": "created", "reminder": _reminder_from_view(current, item["id"]), "item": item, "due": due}


def run_action(
    items_path: Path,
    actions_path: Path,
    current_path: Path,
    due_path: Path,
    reminder_id: str,
    action_type: str,
    reason: str,
    created_by: str,
    request_id: str | None,
    remind_at: str | None = None,
) -> dict[str, Any]:
    if _find_request(_read_items(items_path), request_id):
        _raise_idempotency_conflict()
    existing_action = _find_request(_read_actions(actions_path), request_id)
    if existing_action:
        candidate = build_reminder_action(reminder_id, action_type, reason, created_by, request_id, remind_at)
        _assert_same_payload(existing_action, candidate)
        current = rebuild_current_view(items_path, actions_path, current_path)
        due = rebuild_due_view(items_path, actions_path, due_path)
        return {"ok": True, "status": "replayed", "reminder": _reminder_from_view(current, reminder_id), "action": existing_action, "due": due}

    current = build_current_view(items_path, actions_path)
    reminder = _reminder_from_view(current, reminder_id)
    if not reminder:
        raise ReminderFlowError("reminder_not_found", f"reminder not found: {reminder_id}")
    status = str(reminder.get("status") or "")
    if action_type == "acknowledged" and status == "acknowledged":
        write_current_view(current_path, current)
        due = rebuild_due_view(items_path, actions_path, due_path)
        return {"ok": True, "status": "no_state_change", "reminder": reminder, "action": None, "due": due}
    if action_type == "cancelled" and status == "cancelled":
        write_current_view(current_path, current)
        due = rebuild_due_view(items_path, actions_path, due_path)
        return {"ok": True, "status": "no_state_change", "reminder": reminder, "action": None, "due": due}
    if action_type in {"acknowledged", "cancelled"} and status != "scheduled":
        raise ReminderFlowError("invalid_transition", f"cannot {action_type} reminder from {status}")
    if action_type == "rescheduled" and status not in STATUSES:
        raise ReminderFlowError("invalid_transition", f"cannot reschedule reminder from {status}")
    action = build_reminder_action(reminder_id, action_type, reason, created_by, request_id, remind_at)
    _append_jsonl(actions_path, action)
    updated = rebuild_current_view(items_path, actions_path, current_path)
    due = rebuild_due_view(items_path, actions_path, due_path)
    return {"ok": True, "status": "changed", "reminder": _reminder_from_view(updated, reminder_id), "action": action, "due": due}


def run_list(
    items_path: Path,
    actions_path: Path,
    current_path: Path,
    due_path: Path,
    status: str | None = None,
    task_id: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    if status and status not in STATUSES:
        raise ReminderFlowError("invalid_status", f"invalid status: {status}")
    if limit is not None and (limit < 1 or limit > 200):
        raise ReminderFlowError("invalid_limit", "limit must be between 1 and 200")
    view = rebuild_current_view(items_path, actions_path, current_path)
    rebuild_due_view(items_path, actions_path, due_path)
    reminders = [
        item
        for item in view["reminders"]
        if (not status or item.get("status") == status) and (not task_id or item.get("task_id") == task_id)
    ]
    if limit is not None:
        reminders = reminders[:limit]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": view["generated_at"],
        "filters": {"status": status, "task_id": task_id, "limit": limit},
        "count": len(reminders),
        "reminders": reminders,
        "source": view["source"],
    }


def run_get(items_path: Path, actions_path: Path, current_path: Path, due_path: Path, reminder_id: str) -> dict[str, Any]:
    view = rebuild_current_view(items_path, actions_path, current_path)
    rebuild_due_view(items_path, actions_path, due_path)
    reminder = _reminder_from_view(view, reminder_id)
    if not reminder:
        raise ReminderFlowError("reminder_not_found", f"reminder not found: {reminder_id}")
    return {"ok": True, "reminder": reminder, "generated_at": view["generated_at"], "source": view["source"]}


def rebuild_current_view(items_path: Path, actions_path: Path, current_path: Path, generated_at: str | None = None) -> dict[str, Any]:
    view = build_current_view(items_path, actions_path, generated_at)
    write_current_view(current_path, view)
    return view


def build_current_view(items_path: Path, actions_path: Path, generated_at: str | None = None) -> dict[str, Any]:
    reminder_items = _read_items(items_path)
    reminder_actions = _read_actions(actions_path)
    reminders: dict[str, dict[str, Any]] = {}
    for item in reminder_items:
        _validate_item(item)
        reminder_id = str(item["id"])
        if reminder_id in reminders:
            raise ReminderFlowError("duplicate_reminder_id", f"duplicate reminder id: {reminder_id}")
        reminders[reminder_id] = {
            "id": reminder_id,
            "title": str(item.get("title") or ""),
            "description": item.get("description") if isinstance(item.get("description"), str) else None,
            "remind_at": str(item.get("remind_at") or ""),
            "task_id": item.get("task_id") if isinstance(item.get("task_id"), str) else None,
            "source": str(item.get("source") or ""),
            "created_at": str(item.get("created_at") or ""),
            "created_by": str(item.get("created_by") or ""),
            "status": "scheduled",
            "latest_action_id": None,
            "latest_action_at": None,
            "latest_reason": None,
        }
    for action in reminder_actions:
        _validate_action(action)
        reminder_id = str(action.get("reminder_id") or "")
        reminder = reminders.get(reminder_id)
        if not reminder:
            raise ReminderFlowError("unknown_reminder_action", f"action references missing reminder: {reminder_id}")
        action_type = str(action.get("action_type") or "")
        if action_type == "acknowledged":
            if reminder["status"] != "scheduled":
                raise ReminderFlowError("invalid_transition", f"cannot acknowledge reminder from {reminder['status']}")
            reminder["status"] = "acknowledged"
        elif action_type == "cancelled":
            if reminder["status"] != "scheduled":
                raise ReminderFlowError("invalid_transition", f"cannot cancel reminder from {reminder['status']}")
            reminder["status"] = "cancelled"
        elif action_type == "rescheduled":
            reminder["status"] = "scheduled"
            reminder["remind_at"] = str(action.get("remind_at") or "")
        reminder["latest_action_id"] = str(action.get("id") or "")
        reminder["latest_action_at"] = str(action.get("created_at") or "")
        reminder["latest_reason"] = str(action.get("reason") or "")
    items = sorted(reminders.values(), key=_sort_key)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "source": {
            "items_path": items_path.as_posix(),
            "actions_path": actions_path.as_posix(),
            "items_count": len(reminder_items),
            "actions_count": len(reminder_actions),
            "items_sha256": file_sha256(items_path),
            "actions_sha256": file_sha256(actions_path),
        },
        "count": len(items),
        "reminders": items,
    }


def rebuild_due_view(
    items_path: Path,
    actions_path: Path,
    due_path: Path,
    evaluated_at: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    view = build_due_view(items_path, actions_path, evaluated_at, limit)
    write_due_view(due_path, view)
    return view


def build_due_view(items_path: Path, actions_path: Path, evaluated_at: str | None = None, limit: int = 100) -> dict[str, Any]:
    current = build_current_view(items_path, actions_path, evaluated_at)
    evaluated = normalize_remind_at(evaluated_at or utc_now())
    evaluated_dt = parse_utc(evaluated) or datetime.now(timezone.utc)
    upcoming_until = evaluated_dt + timedelta(hours=24)
    due: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []
    for item in current["reminders"]:
        if item.get("status") != "scheduled":
            continue
        remind_at = str(item.get("remind_at") or "")
        remind_dt = parse_utc(remind_at)
        if not remind_dt:
            continue
        summary = _due_summary(item, evaluated_dt)
        if remind_dt <= evaluated_dt:
            due.append(summary)
        elif remind_dt <= upcoming_until and len(upcoming) < limit:
            upcoming.append(summary)
    due = sorted(due, key=_sort_key)[:limit]
    upcoming = sorted(upcoming, key=_sort_key)[:limit]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now(),
        "evaluated_at": evaluated,
        "due": due,
        "upcoming": upcoming,
        "source": current["source"],
    }


def build_reminder_summary(items_path: Path, actions_path: Path, evaluated_at: str | None = None) -> dict[str, Any]:
    current = build_current_view(items_path, actions_path, evaluated_at)
    due = build_due_view(items_path, actions_path, evaluated_at)
    counts = {status: 0 for status in STATUSES}
    next_reminder_at: str | None = None
    for item in current["reminders"]:
        status = str(item.get("status") or "scheduled")
        counts[status] = counts.get(status, 0) + 1
        remind_at = item.get("remind_at")
        if status == "scheduled" and isinstance(remind_at, str):
            if next_reminder_at is None or remind_at < next_reminder_at:
                next_reminder_at = remind_at
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": current["generated_at"],
        "source": {
            "authority": "reminders/items.jsonl + reminders/actions.jsonl",
            "items_count": current["source"]["items_count"],
            "actions_count": current["source"]["actions_count"],
            "items_sha256": current["source"]["items_sha256"],
            "actions_sha256": current["source"]["actions_sha256"],
        },
        "counts": {
            "scheduled": counts.get("scheduled", 0),
            "acknowledged": counts.get("acknowledged", 0),
            "cancelled": counts.get("cancelled", 0),
            "due": len(due["due"]),
            "upcoming": len(due["upcoming"]),
        },
        "next_reminder_at": next_reminder_at,
        "stale": False,
    }


def write_current_view(path: Path, view: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(view, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_due_view(path: Path, view: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(view, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def file_sha256(path: Path) -> str:
    if not path.exists():
        return hashlib.sha256(b"").hexdigest()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(_sort_value(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _read_items(path: Path) -> list[dict[str, Any]]:
    return _read_jsonl_strict(path, "malformed_reminder_item_log")


def _read_actions(path: Path) -> list[dict[str, Any]]:
    return _read_jsonl_strict(path, "malformed_reminder_action_log")


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
            raise ReminderFlowError(error_code, f"invalid JSON at {path.as_posix()}:{line_no}") from exc
        if not isinstance(item, dict):
            raise ReminderFlowError(error_code, f"non-object JSON at {path.as_posix()}:{line_no}")
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
    raise ReminderFlowError("idempotency_conflict", "requestId was already used with a different reminder payload")


def _assert_task_exists(task_items_path: Path, task_actions_path: Path, task_id: str) -> None:
    try:
        view = build_task_current_view(task_items_path, task_actions_path)
    except TaskFlowError as exc:
        raise ReminderFlowError(exc.code, exc.message) from exc
    if not any(item.get("id") == task_id for item in view.get("items", [])):
        raise ReminderFlowError("task_not_found", f"task not found: {task_id}")


def _reminder_from_view(view: dict[str, Any], reminder_id: str) -> dict[str, Any] | None:
    return next((item for item in view.get("reminders", []) if item.get("id") == reminder_id), None)


def _validate_item(item: dict[str, Any]) -> None:
    if item.get("type") != REMINDER_ITEM_TYPE:
        raise ReminderFlowError("invalid_reminder_item", "reminder item type is invalid")
    if not str(item.get("id") or "").strip():
        raise ReminderFlowError("invalid_reminder_item", "reminder item id is required")
    if not str(item.get("title") or "").strip():
        raise ReminderFlowError("invalid_title", "reminder title is required")
    normalize_remind_at(str(item.get("remind_at") or ""))


def _validate_action(action: dict[str, Any]) -> None:
    if action.get("type") != REMINDER_ACTION_TYPE:
        raise ReminderFlowError("invalid_reminder_action", "reminder action type is invalid")
    action_type = action.get("action_type")
    if action_type not in ACTION_TYPES:
        raise ReminderFlowError("invalid_reminder_action", "reminder action_type is invalid")
    if not str(action.get("reminder_id") or "").strip():
        raise ReminderFlowError("invalid_reminder_action", "reminder action reminder_id is required")
    if not str(action.get("reason") or "").strip():
        raise ReminderFlowError("invalid_reason", "reminder action reason is required")
    if action_type == "rescheduled":
        normalize_remind_at(str(action.get("remind_at") or ""))


def _due_summary(item: dict[str, Any], evaluated_dt: datetime) -> dict[str, Any]:
    remind_at = str(item.get("remind_at") or "")
    remind_dt = parse_utc(remind_at)
    due_state = "upcoming"
    if remind_dt and remind_dt <= evaluated_dt:
        due_state = "due" if remind_dt == evaluated_dt else "overdue"
    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "remind_at": remind_at,
        "task_id": item.get("task_id"),
        "status": item.get("status"),
        "due_state": due_state,
        "created_at": item.get("created_at"),
    }


def _sort_key(item: dict[str, Any]) -> tuple[str, str, str]:
    return (str(item.get("remind_at") or ""), str(item.get("created_at") or ""), str(item.get("id") or ""))


def _new_id(prefix: str, ts: str) -> str:
    compact = ts.replace("-", "").replace(":", "")
    return f"{prefix}_{compact}_{uuid.uuid4().hex[:8]}"


def _sort_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _sort_value(value[key]) for key in sorted(value) if value[key] is not None}
    return value
