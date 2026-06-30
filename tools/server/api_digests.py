from __future__ import annotations

import re
from pathlib import Path
from fastapi import APIRouter, HTTPException

from tools.server.config import load_config

router = APIRouter(prefix='/api/digests', tags=['digests'])
WEEK_RE = re.compile(r'^(\d{4}-W\d{2})\.md$')


def _list_rows(root: Path) -> list[dict[str, str | int]]:
    rows = []
    for p in sorted(root.glob('*.md'), key=lambda x: x.name):
        m = WEEK_RE.match(p.name)
        if not m:
            continue
        lines = p.read_text(encoding='utf-8').splitlines()
        title = lines[0].lstrip('# ').strip() if lines else p.stem
        rows.append({'week': m.group(1), 'title': title, 'path': p.as_posix(), 'entry_count': sum(1 for ln in lines if ln.startswith('| `'))})
    return rows


@router.get('')
@router.get('/')
def list_digests():
    cfg = load_config()
    rows = _list_rows((cfg.repo_root / cfg.digests_dir).resolve())
    return {'items': rows, 'count': len(rows)}


@router.get('/{week}')
def get_digest(week: str):
    cfg = load_config()
    p = (cfg.repo_root / cfg.digests_dir / f'{week}.md').resolve()
    if not p.exists():
        raise HTTPException(status_code=404, detail='digest not found')
    return {'week': week, 'path': p.as_posix(), 'content': p.read_text(encoding='utf-8')}
