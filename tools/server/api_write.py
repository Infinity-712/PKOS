from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from tools.common.object_store import build_object_index
from tools.common.yaml_io import save_yaml
from tools.server.config import load_config
from tools.server.git_ops import commit_files, ensure_repo
from tools.server.srs import update_srs

router = APIRouter(prefix='/api/review', tags=['write'])


class RatingItem(BaseModel):
    id: str
    score: int = Field(ge=1, le=5)
    ts: str | None = None


class RatingBatch(BaseModel):
    items: list[RatingItem]


def _check_write_auth(request: Request, token: str | None, cfg_token: str) -> None:
    host = request.client.host if request.client else ''
    if host not in {'127.0.0.1', '::1', 'localhost'}:
        raise HTTPException(status_code=403, detail='localhost only')
    if cfg_token and token != cfg_token:
        raise HTTPException(status_code=401, detail='invalid token')


def _is_under(path: Path, root: Path) -> bool:
    p = path.resolve()
    r = root.resolve()
    return r in p.parents or p == r


@router.post('/ratings:batch')
def ratings_batch(payload: RatingBatch, request: Request, x_pkos_token: str | None = Header(default=None)):
    cfg = load_config()
    _check_write_auth(request, x_pkos_token, cfg.write_token)

    repo_root = cfg.repo_root.resolve()
    objects_root = (repo_root / cfg.objects_dir).resolve()
    logs_root = (repo_root / cfg.review_dir / 'logs').resolve()
    logs_root.mkdir(parents=True, exist_ok=True)

    idx, _issues = build_object_index(objects_root)

    now = datetime.now(timezone.utc)
    log_file = logs_root / f"{now.date().isoformat()}.jsonl"
    changed: list[Path] = []
    failures: list[dict[str, str]] = []

    with log_file.open('a', encoding='utf-8') as f:
        for item in payload.items:
            rec = idx.get(item.id)
            if not rec:
                failures.append({'id': item.id, 'error': 'object not found'})
                continue
            if rec.object_type not in {'fact', 'skill', 'claim'}:
                failures.append({'id': item.id, 'error': f'type not writable: {rec.object_type}'})
                continue

            rec.data['srs'] = update_srs(rec.data.get('srs') if isinstance(rec.data.get('srs'), dict) else {}, item.score, item.ts)
            err = save_yaml(rec.path, rec.data)
            if err:
                failures.append({'id': item.id, 'error': err[0].message})
                continue
            if rec.path not in changed:
                changed.append(rec.path)

            entry = {
                'id': item.id,
                'score': item.score,
                'ts': datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z') if item.ts is None else item.ts,
                'source': 'api/ratings:batch',
                'version': 'v0.4',
            }
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')

    if log_file.exists() and log_file.stat().st_size > 0:
        changed.append(log_file)

    for p in changed:
        if not (_is_under(p, objects_root) or _is_under(p, logs_root)):
            raise HTTPException(status_code=400, detail=f'path outside whitelist: {p}')

    commit_hash = ''
    if changed:
        ensure_repo(repo_root)
        rels = [p.resolve().relative_to(repo_root) for p in changed]
        commit_hash = commit_files(repo_root, rels, f'review: ratings batch (n={len(payload.items)})')

    return {
        'ok': True,
        'commit_hash': commit_hash,
        'changed_files': [str(p.resolve().relative_to(repo_root).as_posix()) for p in changed],
        'failures': failures,
    }
