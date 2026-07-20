from __future__ import annotations

import argparse
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from tools.server.api_digests import router as digests_router
from tools.server.api_objects import router as objects_router
from tools.server.api_review import router as review_router
from tools.server.api_write import router as write_router
from tools.server.config import load_config


def create_app() -> FastAPI:
    cfg = load_config()
    app = FastAPI(title='PKOS Legacy FastAPI', version='legacy-read-only')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.allow_origins),
        allow_methods=['GET', 'POST'],
        allow_headers=['*'],
    )

    @app.get('/api/health')
    def health():
        return {
            'status': 'ok',
            'service': 'pkos-legacy-fastapi',
            'legacy': True,
            'readOnly': True,
            'authorityWriteEnabled': False,
            'replacement': 'pkos-agent-server',
            'version': 'legacy-read-only',
            'time': datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
        }

    @app.post('/api/chat')
    def chat_placeholder():
        return JSONResponse(
            status_code=410,
            content={
                'error': 'legacy_chat_retired',
                'message': 'Chat is available only through the PKOS Agent Server on port 8790.',
            },
        )

    app.include_router(objects_router)
    app.include_router(review_router)
    app.include_router(digests_router)
    app.include_router(write_router)
    return app


app = create_app()


def main() -> int:
    parser = argparse.ArgumentParser(description='Run legacy PKOS FastAPI server [legacy read-only]')
    parser.add_argument('--port', type=int, default=None)
    args = parser.parse_args()

    cfg = load_config()
    port = args.port or cfg.port
    print(
        'WARNING: tools.pkos serve starts pkos-legacy-fastapi [legacy read-only]. '
        'Authority writeback and chat are retired; use pkos-agent-server on port 8790.',
        flush=True,
    )
    uvicorn.run('tools.server.main:app', host='127.0.0.1', port=port, reload=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
