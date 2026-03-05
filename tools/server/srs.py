from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


def _as_utc_iso(ts: str | None) -> str:
    if ts:
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    return dt.replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _parse_due(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(timezone.utc)


def update_srs(current: dict[str, Any] | None, score: int, ts: str | None) -> dict[str, Any]:
    now_iso = _as_utc_iso(ts)
    now = _parse_due(now_iso)
    s = dict(current or {})
    interval = int(s.get('interval_days') or 1)
    ease = float(s.get('ease') or 2.5)

    if score <= 1:  # Again
        interval = 1
        ease = max(1.3, ease - 0.25)
    elif score == 2:  # Hard
        interval = max(1, round(interval * 1.2))
        ease = max(1.3, ease - 0.15)
    elif score == 3:  # Good
        interval = max(1, round(interval * ease))
        ease = max(1.3, ease - 0.02)
    elif score == 4:  # Easy
        interval = max(1, round(interval * (ease + 0.15)))
        ease = ease + 0.05
    else:  # Perfect
        interval = max(1, round(interval * (ease + 0.30)))
        ease = ease + 0.08

    due = (now + timedelta(days=interval)).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    return {
        'due_at': due,
        'interval_days': int(interval),
        'ease': round(ease, 2),
        'last_reviewed_at': now_iso,
    }
