from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from tools.common.object_store import build_object_index
from tools.server.config import load_config
from tools.server.render import render_object

router = APIRouter(prefix='/api', tags=['objects'])


def _load_index():
    cfg = load_config()
    idx, _issues = build_object_index((cfg.repo_root / cfg.objects_dir).resolve())
    return idx


@router.get('/objects')
def list_objects(
    type: str | None = None,
    status: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
):
    idx = _load_index()
    rows = []
    for rec in idx.values():
        d = rec.data
        if type and rec.object_type != type:
            continue
        if status and rec.status != status:
            continue
        tags = d.get('tags') if isinstance(d.get('tags'), list) else []
        if tag and tag not in [str(t) for t in tags]:
            continue
        text = f"{rec.object_id} {d.get('title','')} {d.get('summary','')}"
        if q and q.lower() not in text.lower():
            continue
        rows.append({
            'id': rec.object_id,
            'type': rec.object_type,
            'status': rec.status,
            'title': str(d.get('title') or ''),
            'summary': str(d.get('summary') or ''),
            'content': str(d.get('content') or ''),
            'updated_at': str(d.get('updated_at') or ''),
            'tags': [str(t) for t in tags],
            'path': rec.path.as_posix(),
        })
    rows.sort(key=lambda x: (x['type'], x['id']))
    return {'items': rows[:limit], 'count': len(rows)}


@router.get('/objects/{object_id}')
def get_object(object_id: str):
    idx = _load_index()
    rec = idx.get(object_id)
    if not rec:
        raise HTTPException(status_code=404, detail='object not found')
    d = dict(rec.data)
    d['_path'] = rec.path.as_posix()
    return d


@router.get('/objects/{object_id}/rendered')
def get_object_rendered(object_id: str):
    idx = _load_index()
    rec = idx.get(object_id)
    if not rec:
        raise HTTPException(status_code=404, detail='object not found')
    result = render_object(rec.data)
    result['type'] = rec.object_type
    result['status'] = rec.status
    result['updated_at'] = str(rec.data.get('updated_at') or '')
    result['tags'] = [str(x) for x in (rec.data.get('tags') if isinstance(rec.data.get('tags'), list) else [])]
    return result
