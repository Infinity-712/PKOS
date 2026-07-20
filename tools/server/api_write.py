from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix='/api/review', tags=['write'])

LEGACY_WRITEBACK_DISABLED = {
    'error': 'legacy_writeback_disabled',
    'message': 'Legacy FastAPI writeback is retired. Use the PKOS Agent Server on port 8790.',
}


@router.post('/ratings:batch')
def ratings_batch():
    return JSONResponse(status_code=410, content=LEGACY_WRITEBACK_DISABLED)
