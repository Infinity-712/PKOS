from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tools.flow_hub.append_logs import (
    BODY_VALUES,
    CONTEXT_VALUES,
    ENERGY_VALUES,
    MODE_VALUES,
    MOOD_VALUES,
    RISK_VALUES,
    SCHEMA_VERSION,
)

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class StateListError(ValueError):
    pass


def _read_state_snapshots(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise StateListError(f"malformed state JSONL at line {line_no}: {exc.msg}") from exc
        if not isinstance(item, dict):
            raise StateListError(f"malformed state JSONL at line {line_no}: expected object")
        if item.get("type") != "state_snapshot":
            raise StateListError(f"malformed state JSONL at line {line_no}: expected state_snapshot")
        rows.append(item)
    return rows


def _validate_filter(name: str, value: str | None, allowed: set[str]) -> str | None:
    if value is None:
        return None
    if value not in allowed:
        raise StateListError(f"invalid {name}: {value}")
    return value


def _validate_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    if limit < 1 or limit > MAX_LIMIT:
        raise StateListError(f"limit must be between 1 and {MAX_LIMIT}")
    return limit


def _normalize_risk(value: Any) -> dict[str, str]:
    risk = value if isinstance(value, dict) else {}
    return {
        "short_video": str(risk.get("short_video") or "unknown") if str(risk.get("short_video") or "unknown") in RISK_VALUES else "unknown",
        "rumination": str(risk.get("rumination") or "unknown") if str(risk.get("rumination") or "unknown") in RISK_VALUES else "unknown",
        "overload": str(risk.get("overload") or "unknown") if str(risk.get("overload") or "unknown") in RISK_VALUES else "unknown",
    }


def _normalize_snapshot(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(item.get("id") or ""),
        "source": str(item.get("source") or ""),
        "energy": str(item.get("energy") or "unknown") if str(item.get("energy") or "unknown") in ENERGY_VALUES else "unknown",
        "mood": str(item.get("mood") or "unknown") if str(item.get("mood") or "unknown") in MOOD_VALUES else "unknown",
        "body": str(item.get("body") or "unknown") if str(item.get("body") or "unknown") in BODY_VALUES else "unknown",
        "context": str(item.get("context") or "unknown") if str(item.get("context") or "unknown") in CONTEXT_VALUES else "unknown",
        "mode": str(item.get("mode") or "unknown") if str(item.get("mode") or "unknown") in MODE_VALUES else "unknown",
        "risk": _normalize_risk(item.get("risk")),
        "note": item.get("note") if isinstance(item.get("note"), str) else None,
        "created_at": str(item.get("created_at") or ""),
    }


def _matches(item: dict[str, Any], energy: str | None, mood: str | None, mode: str | None) -> bool:
    if energy and item.get("energy") != energy:
        return False
    if mood and item.get("mood") != mood:
        return False
    if mode and item.get("mode") != mode:
        return False
    return True


def build_state_list_view(
    state_path: Path,
    energy: str | None = None,
    mood: str | None = None,
    mode: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    energy = _validate_filter("energy", energy, ENERGY_VALUES)
    mood = _validate_filter("mood", mood, MOOD_VALUES)
    mode = _validate_filter("mode", mode, MODE_VALUES)
    normalized_limit = _validate_limit(limit)

    snapshots = [_normalize_snapshot(item) for item in _read_state_snapshots(state_path)]
    snapshots.sort(key=lambda item: (str(item.get("created_at") or ""), str(item.get("id") or "")), reverse=True)

    current = snapshots[0] if snapshots else None
    filtered = [item for item in snapshots if _matches(item, energy, mood, mode)]
    limited = filtered[:normalized_limit]
    return {
        "schema_version": SCHEMA_VERSION,
        "current": current,
        "items": limited,
        "count": len(limited),
        "filters": {
            "energy": energy,
            "mood": mood,
            "mode": mode,
            "limit": normalized_limit,
        },
    }
