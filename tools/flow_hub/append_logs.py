from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "0.5-alpha"

CAPTURE_TYPES = {"note", "task", "thought", "emotion", "recovery", "writing", "knowledge", "state", "other"}
INBOX_SOURCES = {"manual", "moonlolo", "web", "app", "import"}
INBOX_STATUSES = {"unprocessed", "converted", "archived"}

ENERGY_VALUES = {"unknown", "very_low", "low", "medium", "high", "overloaded"}
MOOD_VALUES = {"unknown", "calm", "anxious", "low", "excited", "numb", "irritated", "overloaded"}
BODY_VALUES = {"unknown", "normal", "sleepy", "tired", "chest_tight", "headache", "hungry", "sick"}
CONTEXT_VALUES = {"unknown", "dorm", "classroom", "library", "outside", "home", "before_sleep", "travel", "other"}
MODE_VALUES = {"unknown", "study", "writing", "recovery", "social", "quiet", "life", "project", "other"}
RISK_VALUES = {"unknown", "low", "medium", "high"}
STATE_SOURCES = {"manual", "moonlolo", "web", "app"}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_id(prefix: str, ts: str) -> str:
    compact = ts.replace("-", "").replace(":", "")
    return f"{prefix}_{compact}_{uuid.uuid4().hex[:8]}"


def _append_jsonl(path: Path, item: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def parse_metadata(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"metadata-json must be a JSON object: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("metadata-json must be a JSON object")
    return data


def build_inbox_item(
    capture_type: str,
    content: str,
    source: str = "manual",
    status: str = "unprocessed",
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    content = content.strip()
    if not content:
        raise ValueError("content must not be empty")
    if capture_type not in CAPTURE_TYPES:
        raise ValueError(f"unknown capture_type: {capture_type}")
    if source not in INBOX_SOURCES:
        raise ValueError(f"unknown source: {source}")
    if status not in INBOX_STATUSES:
        raise ValueError(f"unknown status: {status}")

    ts = created_at or utc_now()
    return {
        "schema_version": SCHEMA_VERSION,
        "id": _new_id("inbox", ts),
        "type": "inbox_item",
        "capture_type": capture_type,
        "content": content,
        "source": source,
        "status": status,
        "tags": tags or [],
        "metadata": metadata or {},
        "created_at": ts,
    }


def build_state_snapshot(
    energy: str,
    mood: str,
    body: str,
    context: str = "unknown",
    mode: str = "unknown",
    risk_short_video: str = "unknown",
    risk_rumination: str = "unknown",
    risk_overload: str = "unknown",
    source: str = "manual",
    note: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    checks = [
        ("energy", energy, ENERGY_VALUES),
        ("mood", mood, MOOD_VALUES),
        ("body", body, BODY_VALUES),
        ("context", context, CONTEXT_VALUES),
        ("mode", mode, MODE_VALUES),
        ("risk_short_video", risk_short_video, RISK_VALUES),
        ("risk_rumination", risk_rumination, RISK_VALUES),
        ("risk_overload", risk_overload, RISK_VALUES),
        ("source", source, STATE_SOURCES),
    ]
    for name, value, allowed in checks:
        if value not in allowed:
            raise ValueError(f"unknown {name}: {value}")

    ts = created_at or utc_now()
    return {
        "schema_version": SCHEMA_VERSION,
        "id": _new_id("state", ts),
        "type": "state_snapshot",
        "source": source,
        "energy": energy,
        "mood": mood,
        "body": body,
        "context": context,
        "mode": mode,
        "risk": {
            "short_video": risk_short_video,
            "rumination": risk_rumination,
            "overload": risk_overload,
        },
        "note": note,
        "created_at": ts,
    }


def run_inbox_append(
    inbox_path: Path,
    capture_type: str,
    content: str,
    source: str = "manual",
    status: str = "unprocessed",
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    item = build_inbox_item(capture_type, content, source, status, tags, metadata)
    _append_jsonl(inbox_path, item)
    print(f"appended: {item['id']} -> {inbox_path.as_posix()}")
    return 0


def run_state_append(
    state_path: Path,
    energy: str,
    mood: str,
    body: str,
    context: str = "unknown",
    mode: str = "unknown",
    risk_short_video: str = "unknown",
    risk_rumination: str = "unknown",
    risk_overload: str = "unknown",
    source: str = "manual",
    note: str | None = None,
) -> int:
    item = build_state_snapshot(
        energy,
        mood,
        body,
        context,
        mode,
        risk_short_video,
        risk_rumination,
        risk_overload,
        source,
        note,
    )
    _append_jsonl(state_path, item)
    print(f"appended: {item['id']} -> {state_path.as_posix()}")
    return 0


def main_inbox_append() -> int:
    parser = argparse.ArgumentParser(description="Append an Inbox item")
    parser.add_argument("--capture-type", required=True, choices=sorted(CAPTURE_TYPES))
    parser.add_argument("--content", required=True)
    parser.add_argument("--source", default="manual", choices=sorted(INBOX_SOURCES))
    parser.add_argument("--status", default="unprocessed", choices=sorted(INBOX_STATUSES))
    parser.add_argument("--tags", default="")
    parser.add_argument("--metadata-json", default=None)
    parser.add_argument("--inbox-path", default="inbox/items.jsonl")
    args = parser.parse_args()
    try:
        return run_inbox_append(
            Path(args.inbox_path),
            args.capture_type,
            args.content,
            args.source,
            args.status,
            parse_tags(args.tags),
            parse_metadata(args.metadata_json),
        )
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 2


def main_state_append() -> int:
    parser = argparse.ArgumentParser(description="Append a Current State snapshot")
    parser.add_argument("--energy", required=True, choices=sorted(ENERGY_VALUES))
    parser.add_argument("--mood", required=True, choices=sorted(MOOD_VALUES))
    parser.add_argument("--body", required=True, choices=sorted(BODY_VALUES))
    parser.add_argument("--context", default="unknown", choices=sorted(CONTEXT_VALUES))
    parser.add_argument("--mode", default="unknown", choices=sorted(MODE_VALUES))
    parser.add_argument("--risk-short-video", default="unknown", choices=sorted(RISK_VALUES))
    parser.add_argument("--risk-rumination", default="unknown", choices=sorted(RISK_VALUES))
    parser.add_argument("--risk-overload", default="unknown", choices=sorted(RISK_VALUES))
    parser.add_argument("--source", default="manual", choices=sorted(STATE_SOURCES))
    parser.add_argument("--note", default=None)
    parser.add_argument("--state-path", default="state/snapshots.jsonl")
    args = parser.parse_args()
    try:
        return run_state_append(
            Path(args.state_path),
            args.energy,
            args.mood,
            args.body,
            args.context,
            args.mode,
            args.risk_short_video,
            args.risk_rumination,
            args.risk_overload,
            args.source,
            args.note,
        )
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 2
