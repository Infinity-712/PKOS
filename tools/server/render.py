from __future__ import annotations

from typing import Any


def render_object(data: dict[str, Any]) -> dict[str, Any]:
    body = ''
    for key in ('content', 'definition', 'explanation', 'notes', 'text', 'body'):
        v = data.get(key)
        if isinstance(v, str) and v.strip():
            body = v.strip()
            break

    sections = []
    mapping = [
        ('counter_examples', 'counter_examples'),
        ('verification_sources', 'verification_sources'),
        ('common_mistakes', 'common_mistakes'),
        ('practice_log', 'practice_log'),
        ('assumptions', 'assumptions'),
        ('evidence', 'evidence'),
        ('counter_arguments', 'counter_arguments'),
        ('scope', 'scope'),
        ('invalidation_conditions', 'invalidation_conditions'),
        ('source', 'source'),
        ('anchors', 'anchors'),
    ]
    for key, title in mapping:
        raw = data.get(key)
        if raw in (None, '', []):
            continue
        items = raw if isinstance(raw, list) else [raw]
        sections.append({'key': key, 'title': title, 'items': [str(x) for x in items if str(x)]})

    return {
        'id': str(data.get('id') or ''),
        'title': str(data.get('title') or ''),
        'summary': str(data.get('summary') or ''),
        'body': body,
        'sections': sections,
    }
