from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

ALGORITHM_ID = "sm2-subset"
ALGORITHM_VERSION = 1
MIN_EASE_FACTOR = 1.3

RATING_LABELS: dict[int, str] = {
    1: "Again",
    2: "Hard",
    3: "Good",
    4: "Easy",
    5: "Perfect",
}


def normalize_reviewed_at(value: str) -> str:
    return _as_utc_iso(_parse_datetime(value))


def normalize_state(value: dict[str, Any] | None) -> dict[str, Any]:
    state = value if isinstance(value, dict) else {}
    interval = _positive_int(state.get("intervalDays", state.get("interval_days")), 1)
    ease = _float_value(state.get("easeFactor", state.get("ease")), 2.5)
    repetitions = max(0, _int_value(state.get("repetitions"), 0))
    due_at = _string_value(state.get("dueAt", state.get("due_at")), "1970-01-01T00:00:00Z")
    last_reviewed_at = _string_value(state.get("lastReviewedAt", state.get("last_reviewed_at")), "")
    return {
        "repetitions": repetitions,
        "intervalDays": interval,
        "easeFactor": round(max(MIN_EASE_FACTOR, ease), 2),
        "dueAt": normalize_reviewed_at(due_at) if due_at else "1970-01-01T00:00:00Z",
        "lastReviewedAt": normalize_reviewed_at(last_reviewed_at) if last_reviewed_at else "",
    }


def apply_rating(previous_state: dict[str, Any] | None, rating: int, reviewed_at: str) -> dict[str, Any]:
    if rating not in RATING_LABELS:
        raise ValueError("rating must be an integer from 1 to 5")

    previous = normalize_state(previous_state)
    reviewed = _parse_datetime(reviewed_at)
    interval = int(previous["intervalDays"])
    ease = float(previous["easeFactor"])
    repetitions = int(previous["repetitions"])

    if rating <= 1:
        next_interval = 1
        next_ease = max(MIN_EASE_FACTOR, ease - 0.25)
        next_repetitions = 0
    elif rating == 2:
        next_interval = max(1, round(interval * 1.2))
        next_ease = max(MIN_EASE_FACTOR, ease - 0.15)
        next_repetitions = repetitions + 1
    elif rating == 3:
        next_interval = max(1, round(interval * ease))
        next_ease = max(MIN_EASE_FACTOR, ease - 0.02)
        next_repetitions = repetitions + 1
    elif rating == 4:
        next_interval = max(1, round(interval * (ease + 0.15)))
        next_ease = max(MIN_EASE_FACTOR, ease + 0.05)
        next_repetitions = repetitions + 1
    else:
        next_interval = max(1, round(interval * (ease + 0.30)))
        next_ease = max(MIN_EASE_FACTOR, ease + 0.08)
        next_repetitions = repetitions + 1

    return {
        "repetitions": next_repetitions,
        "intervalDays": next_interval,
        "easeFactor": round(next_ease, 2),
        "dueAt": _as_utc_iso(reviewed + timedelta(days=next_interval)),
        "lastReviewedAt": _as_utc_iso(reviewed),
    }


def _parse_datetime(value: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError("timestamp must not be empty")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def _as_utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _int_value(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _positive_int(value: Any, default: int) -> int:
    return max(1, _int_value(value, default))


def _float_value(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _string_value(value: Any, default: str) -> str:
    if value is None:
        return default
    return str(value).strip() or default

