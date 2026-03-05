from __future__ import annotations

from fastapi import APIRouter
from pathlib import Path

from tools.server.config import load_config

router = APIRouter(prefix='/api/review', tags=['review'])


def _parse_queue_file(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.startswith('| `'):
            continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts) < 5:
            continue
        out.append({
            'id': parts[1].strip('`'),
            'title': parts[2],
            'due_at': parts[3].strip('`'),
            'path': parts[4].split('](')[-1].rstrip(') '),
        })
    out.sort(key=lambda x: (x.get('due_at', ''), x.get('id', '')))
    return out


@router.get('/queues')
def get_queues():
    cfg = load_config()
    root = (cfg.repo_root / cfg.review_dir).resolve()
    return {
        'daily': _parse_queue_file(root / 'daily_queue.md'),
        'weekly': _parse_queue_file(root / 'weekly_queue.md'),
        'sort_policy': 'due_at,id',
    }
